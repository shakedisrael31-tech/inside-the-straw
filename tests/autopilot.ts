/** A simple look-ahead bot used to prove the course can be completed with the keyboard-equivalent controls. */
import type { Route } from '../src/world/route';
import type { Sheet } from '../src/world/sheet';
import type { PlayerController, Controls } from '../src/player/controller';
import { wrapSym } from '../src/core/math';

/** Distance of clear running ahead in lane `a` (measured on sheet `ref`). */
function clearAhead(route: Route, ref: Sheet, s: number, a: number, max: number, warned = false): number {
  for (let d = 0; d <= max; d += 0.25) {
    if (s + d >= route.total - 0.3) return max;
    const sh = route.at(s + d), u = s + d - sh.s0, aa = route.mapA(a, ref, sh);
    if (!route.solid(sh, u, aa)) return d;
    if (warned && d > 0.6 && doomed(route, sh, u, aa)) return d;
    if (d > 0 && route.blocked(sh, u, aa, 0)) return d;
  }
  return max;
}
/** A strip whose seam is already lifting: a player can see that it is about to go. */
function doomed(route: Route, sh: Sheet, u: number, a: number): boolean {
  for (const ev of route.events) {
    if (ev.sheet !== sh || ev.unfurl || ev.t < 0) continue;
    const s = sh.s0 + u; if (s < ev.s0 || s >= ev.s1) continue;
    const da = sh.wrap ? wrapSym(a - ev.def.a, sh.circ) : a - ev.def.a;
    if (Math.abs(da) < ev.def.w) return true;
  }
  return false;
}
/** Length of the gap that starts here (to decide if it is jumpable). */
function gapLength(route: Route, ref: Sheet, s: number, a: number): number {
  for (let d = 0; d < 6; d += 0.1) if (route.solidS(s + d, a, ref)) return d;
  return 99;
}

export interface PilotOpts { look?: number; period?: number; /** plans round strips whose seam is lifting */ warned?: boolean; /** presses jump this many metres before the edge */ early?: number }
/**
 * A pilot with its own memory. `look` is how far ahead it can see (metres), `period` how often it
 * reconsiders its lane (in 1/120 s ticks). The defaults are an attentive player; a short look and
 * a long period make a late, hesitant one, which the diagnostics use to find unfair spots.
 */
export function makePilot(opts: PilotOpts = {}) {
  let tick = 0, cachedA = 0, cachedSheet: Sheet | null = null;
  const LOOK = opts.look ?? 14, PERIOD = opts.period ?? 10, W = !!opts.warned, EARLY = opts.early ?? 0.3;
  return function pilot(route: Route, p: PlayerController): Controls {
    const c: Controls = { forward: 1, brake: 0, lateral: 0, jump: false };
    if (p.mode !== 'ground') return c;
    const sh = p.sheet;
    const lane = (a: number, max: number) => Math.min(clearAhead(route, sh, p.s, a, max, W), clearAhead(route, sh, p.s, a + 0.45, max, W), clearAhead(route, sh, p.s, a - 0.45, max, W));
    const here = clearAhead(route, sh, p.s, p.a, 3);
    if (cachedSheet !== sh) { cachedSheet = sh; cachedA = p.a; tick = 0; }
    let bestA = cachedA;
    if (tick++ % PERIOD === 0) {
      const hereFar = lane(p.a, LOOK), span = sh.wrap ? sh.circ / 2 : sh.maxHalfWidth;
      let bestScore = -1e9; bestA = p.a;
      for (let off = -span; off <= span; off += 0.3) {
        const a = sh.wrap ? sh.wrapA(p.a + off) : off, delta = sh.wrap ? off : a - p.a;
        const clr = lane(a, LOOK);
        // staying put is preferred unless another lane is clearly better
        const score = clr * 2 - Math.abs(delta) * 1.2 - (Math.abs(delta) > 0.1 && clr < hereFar + 2.5 ? 100 : 0);
        if (score > bestScore) { bestScore = score; bestA = a; }
      }
      cachedA = bestA;
    }
    const want = sh.wrap ? wrapSym(bestA - p.a, sh.circ) : bestA - p.a;
    if (Math.abs(want) > 0.15) c.lateral = Math.sign(want) * Math.min(1, Math.abs(want) / 0.5);
    if (c.lateral !== 0 && !route.solid(sh, p.u, sh.wrapA(p.a + Math.sign(want) * 0.35))) c.lateral = 0;
    if (here < 1.8 && Math.abs(want) > 0.4) { c.forward = 0; c.brake = here < 1.0 ? 1 : 0; }
    if (here < EARLY + p.vu * 0.02 && Math.abs(want) <= 0.4) {
      const s1 = p.s + here + 0.05, t = route.at(s1);
      const crease = route.solidS(s1, p.a, sh) && !route.blocked(t, s1 - t.s0 + 0.3, route.mapA(p.a, sh, t), 0.7);
      if (crease || gapLength(route, sh, s1, p.a) < 2.9) c.jump = true;
      else { c.forward = 0; c.brake = 1; }
    }
    return c;
  };
}
export const autopilot = makePilot();
