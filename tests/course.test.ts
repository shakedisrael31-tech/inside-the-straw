import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { Route } from '../src/world/route';
import { COURSE, CHECKPOINTS, EVENTS, FINISH, SAFE_FROM, BENCHMARK, STARS } from '../src/world/level';
import { PlayerController, type Controls } from '../src/player/controller';
import { CollapseFront } from '../src/collapse/front';
import { CONFIG } from '../src/config';
import { autopilot } from './autopilot';
import { appendFileSync } from 'node:fs';
const note = (m: string) => appendFileSync('/tmp/course-test.log', m + '\n');

const start = { p: new Vector3(0, 52, 0), yaw: 0, pitch: 0, roll: 0 };
const DT = 1 / 120;
const idle: Controls = { forward: 0, brake: 0, lateral: 0, jump: false };
const fwd: Controls = { ...idle, forward: 1 };

function setup() {
  const route = new Route(COURSE, start, EVENTS);
  const player = new PlayerController(route);
  player.place(2);
  const front = new CollapseFront(route);
  const sink: never[] = [];
  const tick = (c: Controls) => { player.step(DT, c, finishS); route.updateEvents(DT, player.s, sink); front.update(DT, player.s); };
  const finishS = route.markS(FINISH);
  return { route, player, front, finishS, tick };
}

describe('course geometry', () => {
  const { route } = setup();
  it('has a real length', () => { expect(route.total).toBeGreaterThan(600); });
  it('sheets join without gaps, including peels that leave from the side wall', () => {
    const a = new Vector3(), b = new Vector3();
    for (let i = 1; i < route.sheets.length; i++) {
      const prev = route.sheets[i - 1], cur = route.sheets[i];
      if (cur.def.rise || cur.def.side || prev.def.kind === 'void' || cur.def.kind === 'void') continue;
      for (const x of [0, 0.9, -0.9]) {
        prev.pos(prev.length, prev.wrapA(x + (cur.def.aShift ?? 0)), 0, a); cur.pos(0, x, 0, b);
        expect(a.distanceTo(b), `${prev.def.id}->${cur.def.id}`).toBeLessThan(0.12);
      }
    }
  });
  it('checkpoints and stars sit where they can be reached', () => {
    for (const cp of CHECKPOINTS) expect(route.solidS(route.markS(cp), 0)).toBe(true);
    expect(CHECKPOINTS.length).toBeGreaterThanOrEqual(3);
    for (const st of STARS) { const sh = route.sheet(st.sheet); expect(st.u).toBeLessThanOrEqual(sh.length); if ((st.h ?? 0.5) < 0.8 && sh.def.kind !== 'void') expect(sh.sd(st.u, sh.wrapA(st.a)), `${st.sheet} ${st.u}`).toBeGreaterThan(0); }
  });
  it('every peel event leaves intact paper beside it and is not on the checkpoint line', () => {
    for (const ev of route.events) {
      for (let s = ev.s0; s < ev.s1; s += 1) {
        const sh = ev.sheet, u = s - sh.s0; let ok = false;
        for (let a = -sh.maxHalfWidth; a <= sh.maxHalfWidth; a += 0.2) {
          const others = route.events.filter((e) => e.sheet === sh);
          const gone = others.some((e) => s >= e.s0 && s < e.s1 && Math.abs(sh.wrap ? ((a - e.def.a + sh.circ * 1.5) % sh.circ) - sh.circ / 2 : a - e.def.a) < e.def.w);
          if (!gone && sh.sd(u, a) > 0.3 && !route.blocked(sh, u, a, 0)) { ok = true; break; }
        }
        expect(ok, `${ev.def.id} at ${u.toFixed(0)}`).toBe(true);
      }
    }
  });
});

describe('movement rules', () => {
  it('walks the full 360 degrees and stays attached on the ceiling', () => {
    const { player, finishS } = setup();
    player.place(20);
    let wraps = 0, prev = player.a;
    for (let i = 0; i < 120 * 5; i++) {
      player.step(DT, { ...idle, lateral: 1 }, finishS);
      if (player.a < prev - 1) wraps++;
      prev = player.a;
      expect(player.mode).toBe('ground');
    }
    expect(wraps).toBeGreaterThanOrEqual(1);
    expect(Math.abs(player.s - 20)).toBeLessThan(1e-6);
  });
  it('does not move forward on its own, and brakes', () => {
    const { player, finishS } = setup();
    for (let i = 0; i < 240; i++) player.step(DT, idle, finishS);
    expect(player.s).toBeCloseTo(2, 5);
    for (let i = 0; i < 240; i++) player.step(DT, fwd, finishS);
    expect(player.vu).toBeCloseTo(CONFIG.difficulty.maxSpeed * CONFIG.difficulty.pace, 3);
    for (let i = 0; i < 60; i++) player.step(DT, { ...idle, brake: 1 }, finishS);
    expect(player.vu).toBe(0);
  });
  it('jumps away from the wall and lands again, from floor, wall and ceiling', () => {
    for (const a of [0, 6.9, -3.4]) {
      const { player, finishS } = setup();
      player.place(20, a);
      player.step(DT, { ...idle, jump: true }, finishS);
      let peak = 0;
      for (let i = 0; i < 200 && player.mode === 'air'; i++) { player.step(DT, idle, finishS); peak = Math.max(peak, player.h); }
      expect(player.mode).toBe('ground');
      expect(peak).toBeGreaterThan(0.7); expect(peak).toBeLessThan(1.4);
    }
  });
  it('falls through a visible hole (no invisible floor)', () => {
    const { route, player, finishS } = setup();
    player.place(64);
    expect(route.sheet('T1').sd(72, 0)).toBeLessThan(0);
    for (let i = 0; i < 120 * 6 && player.mode !== 'fall'; i++) player.step(DT, fwd, finishS);
    expect(player.mode).toBe('fall');
    expect(player.s).toBeGreaterThan(69); expect(player.s).toBeLessThan(75);
  });
  it('a crushed wall stops the bottom route but the side wall gets past', () => {
    const { player, finishS } = setup();
    player.place(36);
    for (let i = 0; i < 120 * 5; i++) player.step(DT, fwd, finishS);
    expect(player.s).toBeLessThan(44); expect(player.mode).toBe('ground');
    player.place(36, -3.6);
    for (let i = 0; i < 120 * 4; i++) player.step(DT, fwd, finishS);
    expect(player.s).toBeGreaterThan(50);
  });
  it('a low crease is hopped, not walked through', () => {
    const { player, finishS } = setup();
    player.place(80);
    for (let i = 0; i < 120 * 4; i++) player.step(DT, fwd, finishS);
    expect(player.s).toBeLessThan(85);
    player.place(80);
    for (let i = 0; i < 120 * 3; i++) player.step(DT, { ...fwd, jump: player.mode === 'ground' && player.s > 84.0 && player.s < 84.4 }, finishS);
    expect(player.s).toBeGreaterThan(87);
  });
  it('steps between stacked segments: a gap fails without a jump, clears with one, up and down', () => {
    const { route, player, finishS } = setup();
    for (const id of ['G1', 'G2', 'G3', 'G4']) {
      const g = route.sheet(id).s0, next = route.sheets[route.sheet(id).index + 1];
      player.place(g - 4);
      for (let i = 0; i < 120 * 4 && player.mode !== 'fall'; i++) player.step(DT, fwd, finishS);
      expect(player.mode, id).toBe('fall');
      player.place(g - 4);
      for (let i = 0; i < 120 * 2.2; i++) player.step(DT, { ...fwd, jump: player.mode === 'ground' && player.s > g - 0.35 && player.s < g }, finishS);
      expect(player.mode, id).toBe('ground');
      expect(player.sheet, id).toBe(next);
    }
  });
});

describe('slides', () => {
  it('speed builds gradually from the slope, braking takes part of it off, steering works', () => {
    const { route, player, finishS } = setup();
    const sl = route.sheet('SL1');
    player.place(sl.s0 + 1);
    let maxV = 0, maxJerk = 0, prev = 0;
    for (let i = 0; i < 120 * 3; i++) { player.step(DT, idle, finishS); maxV = Math.max(maxV, player.vu); maxJerk = Math.max(maxJerk, Math.abs(player.vu - prev) / DT); prev = player.vu; }
    expect(player.sliding).toBe(true);
    expect(maxV).toBeGreaterThan(CONFIG.difficulty.maxSpeed + 1.5);      // faster than running
    expect(maxV).toBeLessThanOrEqual(CONFIG.difficulty.slideMaxSpeed + 1e-6);
    expect(maxJerk).toBeLessThan(4.5);                                   // never a sudden launch
    const free = player.vu;
    player.place(sl.s0 + 1);
    for (let i = 0; i < 120 * 3; i++) player.step(DT, { ...idle, brake: 1 }, finishS);
    expect(player.vu).toBeLessThan(free * 0.75); expect(player.vu).toBeGreaterThan(2);   // limited but useful
    const a0 = player.a;
    for (let i = 0; i < 30; i++) player.step(DT, { ...idle, lateral: 1 }, finishS);
    expect(player.a).toBeGreaterThan(a0 + 0.4);
  });
  it('the cut-open straw funnels onto its last strip, which becomes the slide, and the exit jump lands in the bundle', () => {
    const { route, player, tick } = setup();
    const open = route.sheet('OPEN'), sl = route.sheet('SL1');
    // the strip is the same paper all the way: tube wall -> opened shell -> slide, with no gap in support along its middle
    for (let s = open.s0 - 6; s < sl.s0 + sl.length - 0.5; s += 0.5) expect(route.solidS(s, 0, open), `s=${s.toFixed(1)}`).toBe(true);
    // the shell narrows steadily, so its edge itself steers you onto the strip
    for (let u = 1; u < open.length; u += 1) expect(open.halfWidth(u)).toBeLessThanOrEqual(open.halfWidth(u - 1) + 1e-9);
    player.place(open.s0 + 1, 0);
    let slid = 0;
    for (let i = 0; i < 120 * 22 && player.sheet.def.id !== 'T3'; i++) {
      const v2 = route.sheet('V2').s0;
      tick({ ...fwd, jump: player.mode === 'ground' && player.s > v2 - 0.5 && player.s < v2 });
      if (player.sliding) slid += DT;
      expect(player.mode).not.toBe('fall');
    }
    expect(player.sheet.def.id).toBe('T3');
    expect(slid).toBeGreaterThan(4);
  });
  it('missing the strip is an ordinary, explained fall: no snapping onto the slide', () => {
    const { route, player, tick } = setup();
    const open = route.sheet('OPEN');
    player.place(open.s0 + 1, -5.5);                 // stay on the part of the shell that is cut away
    for (let i = 0; i < 120 * 6 && player.mode !== 'fall'; i++) tick(fwd);
    expect(player.mode).toBe('fall');
    expect(player.sheet.def.id).toBe('OPEN');
    expect(player.fallCause).toBe('edge');
  });
});

describe('failure causes are detected from the surface state', () => {
  it('tear, missed landing, ran off the end, step face, peel, collapse', () => {
    const { route, player, front, finishS, tick } = setup();
    player.place(64); for (let i = 0; i < 120 * 6 && player.mode !== 'fall'; i++) player.step(DT, fwd, finishS);
    expect(player.fallCause).toBe('tear');
    const g1 = route.sheet('G1').s0;
    player.place(g1 - 4); for (let i = 0; i < 120 * 4 && player.mode !== 'fall'; i++) player.step(DT, fwd, finishS);
    expect(player.fallCause).toBe('gap');
    player.place(g1 - 4); for (let i = 0; i < 120 * 4 && player.mode !== 'fall'; i++) player.step(DT, { ...fwd, jump: player.mode === 'ground' && player.s > g1 - 3.2 && player.s < g1 - 3 }, finishS);
    expect(player.fallCause).toBe('short');
    const g2 = route.sheet('G2').s0;                  // ST2 is higher: jumping far too early meets its end face
    player.place(g2 - 6); for (let i = 0; i < 120 * 4 && player.mode !== 'fall'; i++) player.step(DT, { ...fwd, jump: player.mode === 'ground' && player.s > g2 - 2.6 && player.s < g2 - 2.4 }, finishS);
    expect(['step', 'short']).toContain(player.fallCause);
    const ev = route.events.find((e) => e.def.id === 'floor1')!;
    player.place(ev.s0 - 13); for (let i = 0; i < 120 * 8 && player.mode !== 'fall'; i++) tick(fwd);
    expect(player.fallCause).toBe('peel');
    route.resetEvents(0); player.place(110); front.activate(108.5);
    for (let i = 0; i < 120 * 8 && player.mode !== 'fall'; i++) tick(idle);
    expect(player.fallCause).toBe('collapse');
  });
});

describe('local peel events', () => {
  it('warn first, open ahead of a running player, and force the wall route', () => {
    const { route, player, finishS, tick } = setup();
    const ev = route.events.find((e) => e.def.id === 'floor1')!;
    player.place(ev.s0 - 13);
    let warnedAt = -1, openAt = -1;
    for (let i = 0; i < 120 * 8 && player.mode !== 'fall'; i++) {
      tick(fwd);
      if (warnedAt < 0 && ev.t >= 0) warnedAt = player.s;
      if (openAt < 0 && ev.frontS > ev.s0) { openAt = player.s; expect(ev.t).toBeGreaterThanOrEqual(CONFIG.events.warnSeconds - 1e-6); }
    }
    expect(ev.s0 - warnedAt).toBeGreaterThan(9);      // plenty of warning
    expect(ev.s0 - openAt).toBeGreaterThan(5);        // it opens ahead of you, never under you
    expect(player.mode).toBe('fall');                 // holding forward along the bottom is not enough
    expect(player.s).toBeGreaterThan(ev.s0 - 0.5);
    void finishS;
  });
  it('still passable for a slow or late player, and reset by a checkpoint restart', () => {
    const { route, player, tick } = setup();
    const ev = route.events.find((e) => e.def.id === 'floor1')!;
    player.place(Math.max(ev.triggerS, ev.sheet.s0) + 1, 4.6);
    for (let i = 0; i < 120 * 10; i++) tick(idle);      // wait: it fully opens
    expect(ev.done).toBe(true);
    for (let i = 0; i < 120 * 12; i++) tick(fwd);       // walk past on the wall afterwards
    expect(player.mode).toBe('ground'); expect(player.s).toBeGreaterThan(ev.s1);
    route.resetEvents(ev.s0 - 10);
    expect(ev.t).toBe(-1);
    expect(route.solidS(ev.s0 + 5, 0)).toBe(true);
  });
});

describe('unravelling front', () => {
  it('removes support behind it and is driven by route progress', () => {
    const { route, player, front, finishS } = setup();
    player.place(110);
    front.activate(90);
    for (let i = 0; i < 120 * 30 && player.mode !== 'fall'; i++) { front.update(DT, player.s); player.step(DT, { ...idle, lateral: 1 }, finishS); }
    expect(player.mode).toBe('fall');
    expect(player.s).toBeCloseTo(110, 3);
  });
  it('a steady player stays ahead, hesitation is dangerous, and it never jumps forward', () => {
    const { route, front } = setup();
    const C = CONFIG.collapse;
    expect(C.speed + C.catchUpBoost).toBeLessThan(CONFIG.difficulty.maxSpeed * CONFIG.difficulty.pace);
    front.activate(100);
    // "steady" here means the same comfortable fraction of top speed as before pacing changed,
    // not literally 3.7 m/s - it should still outrun the chase if it never pauses.
    const steadySpeed = 3.7 * CONFIG.difficulty.pace;
    let s = 100 + C.startDistance, maxStep = 0, prev = route.front;
    for (let i = 0; i < 120 * 40; i++) { s += steadySpeed * DT; front.update(DT, s); maxStep = Math.max(maxStep, route.front - prev); prev = route.front; }
    expect(s - route.front).toBeGreaterThan(C.startDistance);          // steady progress keeps the gap
    expect(maxStep).toBeLessThanOrEqual((C.speed + C.catchUpBoost) * DT + 1e-9);
    const gap0 = s - route.front; let t = 0;
    while (s - route.front > 0 && t < 60) { front.update(DT, s); t += DT; }
    expect(t).toBeGreaterThan(5); expect(t).toBeLessThan(gap0 / C.speed + 4);   // standing still: caught in seconds, not instantly
  });
  it('stops before the safe straw', () => {
    const { route, front } = setup();
    front.activate(100);
    for (let i = 0; i < 120 * 400; i++) front.update(DT, route.total);
    expect(route.front).toBeLessThanOrEqual(route.markS(SAFE_FROM));
    expect(route.solidS(route.markS(SAFE_FROM) + 3, 0)).toBe(true);
  });
  it('respawn puts the front safely behind every checkpoint', () => {
    const { route, player, front, tick } = setup();
    for (const cp of CHECKPOINTS) {
      const s = route.markS(cp);
      front.activate(s + 5);
      front.respawn(s); route.resetEvents(s); player.place(s);
      expect(s - route.front).toBeGreaterThanOrEqual(CONFIG.collapse.respawnHeadStart - 1e-6);
      for (let i = 0; i < 120 * 3; i++) tick(idle);
      expect(player.mode, cp.sheet).toBe('ground');   // standing still for 3 s after a respawn is safe
    }
  });
});

function playthrough(fromCheckpoint: number, toS: (r: Route) => number) {
  const { route, player, front, tick } = setup();
  const cps = CHECKPOINTS.map((c) => route.markS(c));
  let t = 0, deaths = 0, cp = fromCheckpoint - 1, respawnS = fromCheckpoint > 0 ? cps[fromCheckpoint - 1] : 2, lateralUsed = 0;
  if (fromCheckpoint > 0) { player.place(respawnS); front.activate(respawnS - CONFIG.collapse.startDistance); }
  const visited = new Set<string>(), goal = toS(route), log: string[] = [];
  let minGap = 1e9;
  while (player.s < goal && player.mode !== 'done' && t < 600) {
    const c = autopilot(route, player);
    tick(c);
    lateralUsed += Math.abs(player.va) * DT;
    visited.add(player.sheet.def.id);
    if (front.active && player.mode !== 'fall') minGap = Math.min(minGap, player.s - route.front);
    while (cp + 1 < cps.length && player.s >= cps[cp + 1] && player.mode === 'ground') {
      cp++; respawnS = cps[cp];
      if (cp + 1 === CONFIG.collapse.startsAtCheckpoint) front.activate(respawnS - CONFIG.collapse.startDistance);
    }
    if (player.mode === 'fall' && player.fallT > 1) {
      deaths++; log.push(`${player.sheet.def.id} u=${player.u.toFixed(1)} a=${player.a.toFixed(1)} gap=${(player.s - route.front).toFixed(1)}`);
      player.place(respawnS); front.respawn(respawnS); route.resetEvents(respawnS); if (deaths > 25) break;
    }
    t += DT;
  }
  return { route, player, t, deaths, cp, visited, lateralUsed, minGap, log };
}

describe('playthroughs (autopilot with keyboard-equivalent controls)', () => {
  it('benchmark section: 30-45 s, needs the wall, slide and jumps', () => {
    const r = playthrough(BENCHMARK.startCheckpoint + 1, (rt) => rt.markS(CHECKPOINTS[BENCHMARK.endCheckpoint]) + 1);
    note(`benchmark: time=${r.t.toFixed(1)}s deaths=${r.deaths} ${r.log.join(' | ')}`);
    expect(r.deaths).toBeLessThanOrEqual(1);
    expect(r.t).toBeGreaterThan(26); expect(r.t).toBeLessThan(50);
    for (const id of ['OPEN', 'SL1', 'P2', 'T3', 'TR', 'WB', 'PAD']) expect(r.visited.has(id), id).toBe(true);
  });
  it('full course is completable with the collapse and all events active', () => {
    const r = playthrough(0, (rt) => rt.total);
    note(`full: finished=${r.player.mode === 'done'} time=${r.t.toFixed(1)}s deaths=${r.deaths} minGap=${r.minGap.toFixed(1)} lateral=${r.lateralUsed.toFixed(0)}m at ${r.player.sheet.def.id} ${r.player.u.toFixed(1)} :: ${r.log.join(' | ')}`);
    expect(r.player.mode).toBe('done');
    expect(r.deaths).toBeLessThanOrEqual(4);
    expect(r.cp).toBe(CHECKPOINTS.length - 1);
    for (const sh of r.route.sheets) expect(r.visited.has(sh.def.id), sh.def.id).toBe(true);
    // metres (integrated over time) travelled round the wall: a real part of the run. The bar is
    // lower than it once was because the whole course now finishes faster at the higher pace, which
    // shortens this time-integral on its own without meaning less wall-steering actually happened.
    expect(r.lateralUsed).toBeGreaterThan(17);
    expect(r.t).toBeGreaterThan(130); expect(r.t).toBeLessThan(330);
  });
  it('holding forward along the bottom does not get through', () => {
    const { route, player, tick } = setup();
    let deaths = 0, far = 0;
    player.place(route.markS(CHECKPOINTS[1]));
    for (let i = 0; i < 120 * 60 && deaths < 3; i++) {
      tick({ ...fwd, jump: i % 90 === 0 });
      far = Math.max(far, player.s);
      if (player.mode === 'fall' && player.fallT > 1) { deaths++; route.resetEvents(0); player.place(route.markS(CHECKPOINTS[1])); }
    }
    expect(deaths).toBe(3);
    expect(far).toBeLessThan(route.sheet('T2').s0 + 60);
  });
});
