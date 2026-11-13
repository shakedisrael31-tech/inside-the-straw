/**
 * Development diagnostics, not a pass/fail test: plays every checkpoint section many times with
 * deliberately imperfect pilots (short sight, slow decisions, late controls, hesitant running)
 * and reports where and why they fall. Run with:  npm run diagnose
 * A spot that kills most imperfect pilots for the same reason is a design problem, not a challenge.
 */
import { describe, it } from 'vitest';
import { Vector3 } from 'three';
import { Route } from '../src/world/route';
import { COURSE, CHECKPOINTS, EVENTS, FINISH } from '../src/world/level';
import { PlayerController, type Controls } from '../src/player/controller';
import { CollapseFront } from '../src/collapse/front';
import { CONFIG } from '../src/config';
import { makePilot } from './autopilot';
import { writeFileSync } from 'node:fs';

const DT = 1 / 120;
const start = { p: new Vector3(0, 52, 0), yaw: 0, pitch: 0, roll: 0 };
const PILOTS = [
  { name: 'attentive', look: 14, period: 10, delay: 0, pace: 1, early: 0.3 },
  { name: 'late 0.25s', look: 10, period: 30, delay: 30, pace: 1, early: 0.5 },
  { name: 'late 0.4s', look: 9, period: 48, delay: 48, pace: 1, early: 0.3 },
  { name: 'short sight', look: 6, period: 24, delay: 24, pace: 1, early: 0.4 },
  { name: 'hesitant', look: 9, period: 36, delay: 30, pace: 0.75, early: 0.3 },
  { name: 'jumps early', look: 12, period: 20, delay: 18, pace: 1, early: 1.0 },
  { name: 'jumps late', look: 12, period: 20, delay: 18, pace: 1, early: 0.08 },
];

describe.runIf(process.env.DIAGNOSE)('diagnostics', () => {
  it('where and why imperfect pilots fall, by section', () => {
    const out: string[] = [];
    for (let sec = 0; sec <= CHECKPOINTS.length; sec++) {
      for (const P of PILOTS) {
        const route = new Route(COURSE, start, EVENTS), player = new PlayerController(route), front = new CollapseFront(route);
        const finishS = route.markS(FINISH), cps = CHECKPOINTS.map((c) => route.markS(c));
        const from = sec === 0 ? 2 : cps[sec - 1], to = sec < cps.length ? cps[sec] + 0.5 : finishS;
        const pilot = makePilot({ look: P.look, period: P.period, warned: true, early: P.early }), queue: Controls[] = [];
        const tally = new Map<string, number>();
        let deaths = 0, t = 0;
        const restart = () => { player.place(from); route.resetEvents(from); if (sec >= CONFIG.collapse.startsAtCheckpoint) { front.activate(from - CONFIG.collapse.startDistance); front.respawn(from); } queue.length = 0; };
        restart();
        while (player.s < to && player.mode !== 'done' && t < 240 && deaths < 12) {
          const c = pilot(route, player); c.forward *= P.pace;
          queue.push(c);
          // steering and pace arrive late; the jump is pressed on sight of the edge, early or late by the pilot's habit
          const use = { ...(queue.length > P.delay ? queue.shift()! : { forward: P.pace, brake: 0, lateral: 0, jump: false }), jump: c.jump };
          player.step(DT, use, finishS); route.updateEvents(DT, player.s, []); front.update(DT, player.s);
          if (player.mode === 'fall' && player.fallT > 0.9) {
            deaths++;
            const key = `${player.fallCause} @ ${player.sheet.def.id} u=${(Math.round(player.u / 2) * 2)} a=${player.a.toFixed(1)}`;
            tally.set(key, (tally.get(key) ?? 0) + 1);
            restart();
          }
          t += DT;
        }
        const done = player.s >= to || player.mode === 'done';
        out.push(`section ${sec} (${sec === 0 ? 'start' : CHECKPOINTS[sec - 1].sheet}) ${P.name.padEnd(12)} ${done ? 'through' : 'STUCK  '} t=${t.toFixed(0).padStart(3)}s falls=${String(deaths).padStart(2)}  ${[...tally].map(([k, n]) => `${n}x ${k}`).join(' | ')}`);
      }
      out.push('');
    }
    writeFileSync('/tmp/diagnose.log', out.join('\n'));
  });
});
