/**
 * Sheet: one continuous piece of paper surface.
 *
 * Every walkable thing in the game - the inside of a straw, a peeled strip,
 * a slide, a woven mat, a cut segment, the gap you jump across - is a
 * Sheet. A sheet has a centre line O(u) with a frame (T forward, N
 * surface-up, B right) and a cross section that is an arc of curvature k(u):
 *
 *   k = 1/R  -> a closed tube of radius R, walked on from the inside
 *   k = 0    -> a flat strip
 *   between  -> a strip in the middle of peeling away from its tube
 *
 * Surface coordinates are (u, a, h): distance along, arc length across,
 * height above the paper. A peel is the same kind of object as the tube it
 * comes from, so the traveller walks from one onto the other with no change
 * of coordinate system.
 *
 * Material transformations that change the shape are part of the sheet:
 *   crushes  - the thin wall pressed inward, narrowing the passage
 *   relief   - woven over/under, lifted tabs, slight imperfection of the tube
 */
import { Vector3 } from 'three';
import { keyed, vnoise, wrapSym, TAU, smoothstep } from '../core/math';

export interface PathPiece { len: number; yaw?: number; pitch?: number; roll?: number }
export interface Hole {
  u: number; a: number; lu: number; la: number; shape?: 'ellipse' | 'rect' | 'wedge'; rag?: number;
  /** wedge: a slit from u (half width la) widening to u1 (half width la1). */
  u1?: number; la1?: number;
  /** Leave the torn-out piece hanging from the far edge of the hole. */
  tab?: boolean;
}
/** The wall pressed inward. Tall ones narrow the passage; low ones are a crease to hop. */
export interface Crush { u: number; a: number; lu: number; la: number; depth: number }
export type Keys = readonly (readonly [number, number])[];

export interface SheetDef {
  id: string;
  kind: 'tube' | 'strip' | 'weave' | 'void';
  path: PathPiece[];
  /** Tube radius, or for strips the radius of the straw they were peeled from. */
  radius: number;
  color: number;
  curv?: Keys;
  halfWidth?: Keys;
  ring?: boolean;
  holes?: Hole[];
  crushes?: Crush[];
  /** Ragged torn end; value = half width of wall that survives (the root of a peel), centred on tearEndA. */
  tearStart?: number; tearStartA?: number;
  tearEnd?: number; tearEndA?: number;
  open?: boolean;
  /** A slide: speed comes from the slope, not from running. */
  slide?: boolean;
  /** Walked on from the outside: the top of a closed straw. Slipping off the side is a fall under gravity. */
  convex?: boolean;
  /** A peeled strip that starts out held up near its parent tube and curls down into place: lift at the far end, metres. */
  unfurlHeight?: number;
  /** This sheet's centre line is the previous sheet's line at a = aShift (a peel leaving from the side wall). */
  aShift?: number;
  /** Start offset from the previous sheet's end, along its N (step up/down) and B (sideways). */
  rise?: number; side?: number;
  /** Extra height field, e.g. tabs of a split end lifting apart. */
  reliefFn?: (u: number, a: number) => number;
  weaveBand?: number;
  /** Drawn as a whole closed straw whose top this strip is (stack segments). */
  straw?: boolean;
}

export interface StartPose { p: Vector3; yaw: number; pitch: number; roll: number }
export interface StartFrame { p: Vector3; t: Vector3; n: Vector3; b: Vector3 }
export class Frame { p = new Vector3(); t = new Vector3(); n = new Vector3(); b = new Vector3(); }

const STEP_TARGET = 0.25;

/** Plain weave of flattened straws, band width bw. Heights of the strand running along (warp) and across (weft). */
export const WEAVE_AMP = 0.085;
export function warpHeight(s: number, j: number, bw: number) { return WEAVE_AMP * bw * (j & 1 ? -1 : 1) * Math.sin((Math.PI * s) / bw); }
export function weftHeight(a: number, i: number, bw: number) { return -WEAVE_AMP * bw * (i & 1 ? -1 : 1) * Math.sin(Math.PI * (a / bw + 0.5)); }
/** Top surface of the weave at (s, a): whichever strand is on top there. This is what feet stand on. */
export function weaveTop(s: number, a: number, bw: number) {
  const i = Math.floor(s / bw), j = Math.floor(a / bw + 0.5);
  return Math.max(warpHeight(s, j, bw), weftHeight(a, i, bw)) + 0.03 * bw;
}
const DEG = Math.PI / 180;
const Y = new Vector3(0, 1, 0);
const _f = new Frame();
const _v = new Vector3();

export class Sheet {
  readonly def: SheetDef;
  readonly length: number;
  readonly wrap: boolean;
  readonly circ: number;
  readonly radius: number;
  /** Stripe helix: one full turn every `pitch` metres of travel. */
  readonly pitch: number;
  readonly slope: number;
  readonly hasRelief: boolean;
  /** Route distance at u = 0, +1/-1 direction of s along u, and lateral offset of this sheet's a = 0 in route terms. */
  s0 = 0; sDir = 1; aBase = 0;
  /** Pattern coordinate across the sheet = aOff + aDir * a (lets a hanging tab carry on its parent's stripes). */
  aOff = 0; aDir = 1;
  /** Strands laid across another sheet swap the two event coordinates; patS0 gives each straw its own stripe phase. */
  coordSwap = false; patS0: number | null = null;
  /** 1 = an unfurling strip still held up, 0 = settled. Driven by the route's events. */
  lift = 0;
  index = 0;
  endPose!: StartPose;
  private n: number; private step: number;
  private P: Float32Array; private T: Float32Array; private N: Float32Array; private B: Float32Array;
  private curvKeys: Keys;
  private hwKeys: Keys;
  readonly maxHalfWidth: number;

  constructor(def: SheetDef, start: StartPose | StartFrame) {
    this.def = def;
    this.radius = def.radius;
    this.length = def.path.reduce((s, p) => s + p.len, 0);
    this.wrap = def.kind === 'tube' || !!def.ring;
    this.circ = TAU * def.radius;
    // a real paper straw: the stripe climbs at roughly 50 degrees, one turn in about five radii
    this.pitch = 5.2 * def.radius;
    this.slope = this.pitch / this.circ;
    this.curvKeys = def.curv ?? [[0, this.wrap ? 1 / def.radius : 0]];
    this.hwKeys = def.halfWidth ?? [[0, this.wrap ? this.circ / 2 : 1.2]];
    this.maxHalfWidth = this.wrap ? this.circ / 2 : Math.max(...this.hwKeys.map((k) => k[1]));
    this.hasRelief = def.kind === 'tube' || def.kind === 'weave' || !!def.crushes?.length || !!def.reliefFn || !!def.unfurlHeight;

    const n = (this.n = Math.ceil(this.length / STEP_TARGET) + 1);
    this.step = this.length / (n - 1);
    this.P = new Float32Array(n * 3); this.T = new Float32Array(n * 3);
    this.N = new Float32Array(n * 3); this.B = new Float32Array(n * 3);
    if ('yaw' in start) this.integrateLevel(start); else this.integrateLocal(start);
  }

  /** World-level frames: N stays as upright as heading and roll allow. Used for the course. */
  private integrateLevel(start: StartPose) {
    const STEP = this.step;
    const p = start.p.clone();
    let yaw = start.yaw, pitch = start.pitch, roll = start.roll;
    const t = new Vector3(), b = new Vector3(), nn = new Vector3(), b2 = new Vector3(), n2 = new Vector3();
    let piece = 0, pieceU = 0;
    const startRoll: number[] = []; let r = roll;
    for (const pc of this.def.path) { startRoll.push(r); if (pc.roll !== undefined) r = pc.roll * DEG; }
    for (let i = 0; i < this.n; i++) {
      const u = Math.min(i * STEP, this.length);
      while (piece < this.def.path.length - 1 && u - pieceU > this.def.path[piece].len) { pieceU += this.def.path[piece].len; piece++; }
      const pc = this.def.path[piece];
      if (pc.roll !== undefined) {
        const k = Math.min(1, (u - pieceU) / pc.len);
        roll = startRoll[piece] + (pc.roll * DEG - startRoll[piece]) * (k * k * (3 - 2 * k));
      }
      t.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      b.crossVectors(t, Y).normalize();
      nn.crossVectors(b, t);
      n2.copy(nn).multiplyScalar(Math.cos(roll)).addScaledVector(b, Math.sin(roll));
      b2.copy(b).multiplyScalar(Math.cos(roll)).addScaledVector(nn, -Math.sin(roll));
      p.toArray(this.P, i * 3); t.toArray(this.T, i * 3); n2.toArray(this.N, i * 3); b2.toArray(this.B, i * 3);
      const ds = i < this.n - 1 ? STEP : 0;
      p.addScaledVector(t, ds);
      yaw += ((pc.yaw ?? 0) * DEG / pc.len) * ds;
      pitch += ((pc.pitch ?? 0) * DEG / pc.len) * ds;
    }
    this.endPose = { p, yaw, pitch, roll };
  }

  /** Local frames: yaw about N, pitch about B. Used for decoration that curls freely. */
  private integrateLocal(start: StartFrame) {
    const STEP = this.step;
    const p = start.p.clone(), t = start.t.clone(), nn = start.n.clone(), b = start.b.clone();
    let piece = 0, pieceU = 0;
    for (let i = 0; i < this.n; i++) {
      const u = Math.min(i * STEP, this.length);
      while (piece < this.def.path.length - 1 && u - pieceU > this.def.path[piece].len) { pieceU += this.def.path[piece].len; piece++; }
      const pc = this.def.path[piece];
      p.toArray(this.P, i * 3); t.toArray(this.T, i * 3); nn.toArray(this.N, i * 3); b.toArray(this.B, i * 3);
      const ds = i < this.n - 1 ? STEP : 0;
      p.addScaledVector(t, ds);
      const dy = ((pc.yaw ?? 0) * DEG / pc.len) * ds, dp = ((pc.pitch ?? 0) * DEG / pc.len) * ds;
      if (dp) { t.applyAxisAngle(b, dp); nn.applyAxisAngle(b, dp); }
      if (dy) { t.applyAxisAngle(nn, dy); b.applyAxisAngle(nn, dy); }
      t.normalize(); b.crossVectors(t, nn).normalize(); nn.crossVectors(b, t).normalize();
    }
    this.endPose = { p, yaw: 0, pitch: 0, roll: 0 };
  }

  frame(u: number, out: Frame): Frame {
    const x = Math.max(0, Math.min(this.length, u)) / this.step;
    const i = Math.min(this.n - 2, Math.floor(x)), f = x - i, a = i * 3, b = a + 3;
    const { P, T, N, B } = this;
    out.p.set(P[a] + (P[b] - P[a]) * f, P[a + 1] + (P[b + 1] - P[a + 1]) * f, P[a + 2] + (P[b + 2] - P[a + 2]) * f);
    out.t.set(T[a] + (T[b] - T[a]) * f, T[a + 1] + (T[b + 1] - T[a + 1]) * f, T[a + 2] + (T[b + 2] - T[a + 2]) * f).normalize();
    out.n.set(N[a] + (N[b] - N[a]) * f, N[a + 1] + (N[b + 1] - N[a + 1]) * f, N[a + 2] + (N[b + 2] - N[a + 2]) * f).normalize();
    out.b.set(B[a] + (B[b] - B[a]) * f, B[a + 1] + (B[b + 1] - B[a + 1]) * f, B[a + 2] + (B[b + 2] - B[a + 2]) * f).normalize();
    if (u < 0) out.p.addScaledVector(out.t, u); else if (u > this.length) out.p.addScaledVector(out.t, u - this.length);
    return out;
  }

  /** Downhill steepness at u: sine of the descent angle (positive = going down). */
  descent(u: number) { return -this.frame(u, _f).t.y; }

  curvature(u: number) { return keyed(this.curvKeys, u); }
  halfWidth(u: number) { return this.wrap ? this.circ / 2 : keyed(this.hwKeys, u); }
  wrapA(a: number) { return this.wrap ? wrapSym(a, this.circ) : a; }

  /** How far the crushed wall stands in from the true surface here (0 where the wall is untouched). */
  crushAt(u: number, a: number): number {
    const cr = this.def.crushes;
    if (!cr) return 0;
    let r = 0;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i], du = (u - c.u) / c.lu;
      if (du <= -1 || du >= 1) continue;
      const da = (this.wrap ? wrapSym(a - c.a, this.circ) : a - c.a) / c.la, q = du * du + da * da;
      if (q < 1) { const b = (1 - q) * (1 - q); if (c.depth * b > r) r = c.depth * b; }
    }
    return r;
  }

  /** Small additive height field: tube imperfection, woven over/under, lifted tabs. */
  reliefAt(u: number, a: number): number {
    if (!this.hasRelief) return 0;
    const def = this.def;
    let r = 0;
    if (def.kind === 'tube') {
      const th = (a / this.circ) * TAU, fade = smoothstep(0, 1.2, u) * smoothstep(0, 1.2, this.length - u);
      r += fade * 0.03 * vnoise(u * 0.22 + 1.6 * Math.cos(th), 1.6 * Math.sin(th) + this.index * 9.1);
    } else if (def.kind === 'weave') {
      r += weaveTop(this.s0 + u, a, def.weaveBand ?? 0.8);
    }
    if (def.reliefFn) r += def.reliefFn(u, a);
    if (def.unfurlHeight && this.lift > 0) { const x = Math.min(1, Math.max(0, u / this.length)); r += this.lift * def.unfurlHeight * x * x; }
    return r;
  }

  /** World position of surface point (u, a) lifted h along the surface normal. */
  pos(u: number, a: number, h: number, out: Vector3, outNormal?: Vector3): Vector3 {
    if (this.hasRelief) {
      const cr = this.crushAt(u, a);
      h = (h >= 0 ? Math.max(h, cr) : cr + h) + this.reliefAt(u, a);
    }
    return this.posRaw(u, a, h, out, outNormal);
  }

  /** The undeformed surface (no crush, no relief). */
  posRaw(u: number, a: number, h: number, out: Vector3, outNormal?: Vector3): Vector3 {
    const f = this.frame(u, _f), k = this.curvature(u);
    out.copy(f.p);
    if (Math.abs(k) < 1e-4) {
      out.addScaledVector(f.b, a).addScaledVector(f.n, h);
      outNormal?.copy(f.n);
    } else {
      const phi = k * a, s = Math.sin(phi), c = Math.cos(phi);
      _v.copy(f.n).multiplyScalar(c).addScaledVector(f.b, -s);
      out.addScaledVector(f.b, s / k).addScaledVector(f.n, (1 - c) / k).addScaledVector(_v, h);
      outNormal?.copy(_v);
    }
    return out;
  }

  /**
   * Signed distance-like field over the surface: > 0 is paper, <= 0 is air.
   * Both the visible mesh and the collision test are generated from this one
   * function, so a hole you can see is always a hole you can fall through.
   */
  sd(u: number, a: number): number {
    const def = this.def;
    if (def.kind === 'void') return -1;
    if (u < -1e-6 || u > this.length + 1e-6) return -1;
    let d = 1e9;
    if (!this.wrap) d = this.halfWidth(u) - Math.abs(a) + 0.04 * vnoise(u * 1.3, this.index * 7.1 + (a > 0 ? 3 : 0));
    else a = wrapSym(a, this.circ);
    if (def.tearEnd !== undefined) {
      const ac = this.wrap ? wrapSym(a - (def.tearEndA ?? 0), this.circ) : a - (def.tearEndA ?? 0);
      const edge = this.length - u - (0.1 + 0.3 * (0.5 + 0.5 * vnoise(a * 1.4, this.index * 3.7 + 11))) - 0.12 * vnoise(a * 5.1, 2);
      d = Math.min(d, Math.max(edge, def.tearEnd - Math.abs(ac)));
    }
    if (def.tearStart !== undefined) {
      const ac = this.wrap ? wrapSym(a - (def.tearStartA ?? 0), this.circ) : a - (def.tearStartA ?? 0);
      const edge = u - (0.1 + 0.3 * (0.5 + 0.5 * vnoise(a * 1.4, this.index * 5.3 + 23))) - 0.12 * vnoise(a * 5.1, 9);
      d = Math.min(d, Math.max(edge, def.tearStart - Math.abs(ac)));
    }
    if (def.holes) {
      for (let i = 0; i < def.holes.length; i++) {
        const hl = def.holes[i];
        const du = u - hl.u;
        let da = a - hl.a;
        if (this.wrap) da = wrapSym(da, this.circ);
        let dh: number;
        if (hl.shape === 'wedge') {
          const u1 = hl.u1 ?? this.length + 1;
          if (u < hl.u - 1 || u > u1 + 1) continue;
          const w = hl.la + ((hl.la1 ?? hl.la) - hl.la) * Math.min(1, Math.max(0, du / (u1 - hl.u)));
          dh = Math.max(hl.u - u, u - u1, Math.abs(da) - w);
        } else {
          if (Math.abs(du) > hl.lu + 1) continue;
          if (hl.shape === 'rect') dh = Math.max(Math.abs(du) - hl.lu, Math.abs(da) - hl.la);
          else dh = (Math.hypot(du / hl.lu, da / hl.la) - 1) * Math.min(hl.lu, hl.la);
        }
        dh += (hl.rag ?? 0.1) * vnoise(u * 1.9 + i * 13.7, a * 1.9 + this.index * 5.3);
        if (dh < d) d = dh;
      }
    }
    return d;
  }
}
