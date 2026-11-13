/**
 * Route: the chain of sheets that makes up the course, addressed by one
 * number, `s` = metres of route progress. Checkpoints, the unravelling
 * front, local peel events and the camera all work in route progress.
 *
 * The route is also the single authority on "is there paper here right
 * now?": static cut-outs (Sheet.sd), the unravelling front, and authored
 * peel events are all answered by solid(), and the shader draws from the
 * same numbers.
 */
import { Vector3 } from 'three';
import { Sheet, type SheetDef, type StartPose, Frame } from './sheet';
import { TAU, wrapSym } from '../core/math';
import { CONFIG } from '../config';
import type { Mark, PeelEventDef } from './level';

/** How far past the front line a given helical band has already let go. Mirrored in the shader. */
export function collapseLead(s: number, a: number, slope: number, pitch: number): number {
  const hc = (s - slope * a) / pitch;
  return 0.9 + 0.9 * Math.sin(hc * TAU + 1.3);
}

/**
 * An authored transformation: a strip of wall (or a strand of weave) that
 * lifts at its seam as a warning, then peels away along its length.
 * Driven only by player progress and elapsed game time, so it plays out the
 * same on every attempt.
 */
export class PeelEvent {
  readonly sheet: Sheet;
  readonly s0: number; readonly s1: number;
  /** An unfurl event lowers a whole strip into place instead of removing wall. */
  readonly unfurl: boolean;
  /** Seconds since triggered; < 0 means it has not started. */
  t = -1;
  constructor(readonly def: PeelEventDef, sheet: Sheet) {
    this.sheet = sheet; this.unfurl = !!def.unfurl;
    this.s0 = sheet.s0 + (this.unfurl ? 0 : def.u0); this.s1 = sheet.s0 + (this.unfurl ? sheet.length : def.u1);
  }
  get warn() { return this.def.warn ?? CONFIG.events.warnSeconds; }
  get triggerS() { return this.s0 - (this.def.trigger ?? CONFIG.events.triggerDistance); }
  /** 0..1 during the warning: the seam lifts and flutters. */
  get lift() { return this.t < 0 || this.unfurl ? 0 : Math.min(1, this.t / this.warn); }
  /** Route position the peel has reached; everything in the strip before it is open air. */
  get frontS() { return this.unfurl || this.t < this.warn ? this.s0 : Math.min(this.s1, this.s0 + (this.t - this.warn) * (this.def.speed ?? CONFIG.events.peelSpeed)); }
  get done() { return this.unfurl ? this.t >= (this.def.unfurl ?? 0) : this.frontS >= this.s1; }
  peeled(u: number, a: number): boolean {
    if (this.unfurl) return false;
    const s = this.sheet.s0 + u;
    if (s < this.s0 || s >= this.frontS) return false;
    const da = this.sheet.wrap ? wrapSym(a - this.def.a, this.sheet.circ) : a - this.def.a;
    return Math.abs(da) < this.def.w;
  }
  /** Keep the strip it controls in step with the clock. */
  apply() {
    if (!this.unfurl) return;
    const k = this.t < 0 ? 0 : Math.min(1, this.t / (this.def.unfurl || 1));
    this.sheet.lift = 1 - k * k * (3 - 2 * k);
  }
}

const _f = new Frame(), _n = new Vector3(), _b = new Vector3();

export class Route {
  readonly sheets: Sheet[] = [];
  readonly events: PeelEvent[] = [];
  readonly total: number;
  /** Route progress of the unravelling front. Everything behind it is gone. */
  front = -1e6;
  private byId = new Map<string, Sheet>();
  private sheetEvents = new Map<Sheet, PeelEvent[]>();

  constructor(defs: SheetDef[], start: StartPose, events: PeelEventDef[] = []) {
    let pose = start, s = 0, aBase = 0, prev: Sheet | null = null;
    defs.forEach((def, i) => {
      if (prev && (def.aShift || def.rise || def.side)) {
        // start from a point on the previous sheet's end cross-section, turned to stand on it
        const p = new Vector3(), sh = def.aShift ?? 0;
        prev.frame(prev.length, _f);
        const k = prev.curvature(prev.length), phi = k * sh;
        p.copy(_f.p);
        if (Math.abs(k) > 1e-4) p.addScaledVector(_f.b, Math.sin(phi) / k).addScaledVector(_f.n, (1 - Math.cos(phi)) / k); else p.addScaledVector(_f.b, sh);
        _n.copy(_f.n).multiplyScalar(Math.cos(phi)).addScaledVector(_f.b, -Math.sin(phi));
        _b.copy(_f.b).multiplyScalar(Math.cos(phi)).addScaledVector(_f.n, Math.sin(phi));
        p.addScaledVector(_n, def.rise ?? 0).addScaledVector(_b, def.side ?? 0);
        pose = { p, yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll - phi };
        aBase += sh + (def.side ?? 0);
      }
      const sheet = new Sheet(def, pose);
      sheet.index = i; sheet.s0 = s; sheet.aBase = aBase; s += sheet.length; pose = sheet.endPose;
      this.sheets.push(sheet); this.byId.set(def.id, sheet); prev = sheet;
    });
    this.total = s;
    for (const e of events) {
      const sh = this.sheet(e.sheet), ev = new PeelEvent(e, sh);
      this.events.push(ev);
      if (!this.sheetEvents.has(sh)) this.sheetEvents.set(sh, []);
      this.sheetEvents.get(sh)!.push(ev);
    }
  }

  sheet(id: string): Sheet { const s = this.byId.get(id); if (!s) throw new Error('No sheet ' + id); return s; }
  markS(m: Mark): number { return this.sheet(m.sheet).s0 + m.u; }

  /** Sheet containing route progress s (clamped to the ends). */
  at(s: number): Sheet {
    const sh = this.sheets;
    let lo = 0, hi = sh.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sh[mid].s0 <= s) lo = mid; else hi = mid - 1; }
    return sh[lo];
  }

  /** Convert a lateral coordinate measured on sheet `from` to sheet `to`. */
  mapA(a: number, from: Sheet, to: Sheet): number { return to.wrapA(a + from.aBase - to.aBase); }

  /** World position at route progress s. `a` is measured on sheet `ref` (default: the sheet at s). */
  pos(s: number, a: number, h: number, out: Vector3, outNormal?: Vector3, ref?: Sheet): Vector3 {
    const sh = this.at(s);
    return sh.pos(s - sh.s0, ref ? this.mapA(a, ref, sh) : sh.wrapA(a), h, out, outNormal);
  }

  collapsed(sh: Sheet, u: number, a: number): boolean {
    const s = sh.s0 + u;
    return this.front - s - collapseLead(s, a, sh.slope, sh.pitch) > 0;
  }

  /** Is there paper to stand on here, right now? */
  solid(sh: Sheet, u: number, a: number): boolean {
    if (sh.sd(u, a) <= 0 || this.collapsed(sh, u, a)) return false;
    const evs = this.sheetEvents.get(sh);
    if (evs) for (let i = 0; i < evs.length; i++) if (evs[i].t >= 0 && evs[i].peeled(u, a)) return false;
    return true;
  }
  solidS(s: number, a: number, ref?: Sheet): boolean {
    const sh = this.at(s);
    return this.solid(sh, s - sh.s0, ref ? this.mapA(a, ref, sh) : sh.wrapA(a));
  }

  /** Has an authored peel event opened the paper here? */
  peeledAt(sh: Sheet, u: number, a: number): boolean {
    const evs = this.sheetEvents.get(sh);
    if (evs) for (let i = 0; i < evs.length; i++) if (evs[i].t >= 0 && evs[i].peeled(u, a)) return true;
    return false;
  }

  /** A crushed wall too steep to walk up at this height. */
  blocked(sh: Sheet, u: number, a: number, h: number): boolean {
    return !!sh.def.crushes && h < sh.crushAt(u, a) - 0.12;
  }

  /** Advance authored events. Returns events that just started warning (1) or just started peeling (2). */
  updateEvents(dt: number, playerS: number, out: { ev: PeelEvent; phase: 1 | 2 }[]) {
    for (const ev of this.events) {
      if (ev.t < 0) { if (playerS >= ev.triggerS) { ev.t = 0; out.push({ ev, phase: 1 }); } continue; }
      const before = ev.t; ev.t += dt; ev.apply();
      if (ev.unfurl) continue;
      if (before < ev.warn && ev.t >= ev.warn) out.push({ ev, phase: 2 });
    }
  }

  /** Checkpoint restore: every event the traveller has not yet passed goes back to untouched paper. */
  resetEvents(fromS: number) { for (const ev of this.events) { if (ev.s1 > fromS || fromS <= 0) ev.t = -1; ev.apply(); } }
}
