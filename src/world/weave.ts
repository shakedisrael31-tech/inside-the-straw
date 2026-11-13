/**
 * A real weave, after the woven-straw experiment: separate flattened
 * straws, each with its own colour and its own diagonal stripe, passing
 * alternately over and under one another. Every strand is its own piece of
 * geometry with thickness, so the over/under is actual shape with contact
 * shade where a strand dives beneath its neighbour, not a printed pattern.
 *
 * Heights come from warpHeight/weftHeight in sheet.ts, the same functions
 * the walkable surface uses, so feet land on the strand that is on top.
 */
import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3, Sphere, type MeshStandardMaterial } from 'three';
import { Frame, warpHeight, weftHeight, WEAVE_AMP, type Sheet } from './sheet';
import { createPaperMaterial, type PaperShared } from './paperMaterial';

const P = new Vector3(), N = new Vector3(), FR = new Frame();
const PROFILE = [-0.5, -0.36, -0.15, 0.15, 0.36, 0.5];

class Strands {
  pos: number[] = []; coord: number[] = []; pat: number[] = []; out: number[] = []; tan: number[] = []; face: number[] = []; shade: number[] = []; idx: number[] = [];
  count = 0;
  constructor(private sheet: Sheet) {}
  /** One ring of a flattened-tube cross-section: top row then bottom row. */
  ring(u: number, aCentre: number, across: number[], h: number, thick: number, patAlong: number, alongIsU: boolean, lowness: number) {
    const sh = this.sheet;
    for (let side = 0; side < 2; side++) for (let k = 0; k < PROFILE.length; k++) {
      const x = PROFILE[k], lens = thick * Math.sqrt(Math.max(0, 1 - 4 * x * x));
      const uu = alongIsU ? u : u + across[k], aa = alongIsU ? aCentre + across[k] : aCentre;
      sh.posRaw(uu, aa, h + (side ? -lens : lens), P, N);
      const t = sh.frame(uu, FR);
      this.pos.push(P.x, P.y, P.z);
      this.coord.push(sh.s0 + uu, aa);
      this.pat.push(patAlong, across[k] + (side ? 0.6 : 0));
      this.out.push(-N.x, -N.y, -N.z);
      if (alongIsU) this.tan.push(t.t.x, t.t.y, t.t.z); else this.tan.push(t.b.x, t.b.y, t.b.z);
      this.face.push(1);
      // contact shade: darker where this strand is underneath, and along its edges
      this.shade.push((0.6 + 0.4 * lowness) * (0.82 + 0.18 * Math.sqrt(Math.max(0, 1 - 4 * x * x))) * (side ? 0.8 : 1));
    }
    return this.count++;
  }
  /** Join ring r to ring r+1. */
  band(r: number, flip: boolean) {
    const n = PROFILE.length, a = r * 2 * n, b = a + 2 * n;
    for (let k = 0; k < n - 1; k++) {
      const q = (i0: number, i1: number, j0: number, j1: number, f: boolean) => { if (f) this.idx.push(i0, j0, i1, i1, j0, j1); else this.idx.push(i0, i1, j0, i1, j1, j0); };
      q(a + k, a + k + 1, b + k, b + k + 1, flip);                       // top
      q(a + n + k, a + n + k + 1, b + n + k, b + n + k + 1, !flip);      // bottom
    }
  }
  build(): BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aCoord', new Float32BufferAttribute(this.coord, 2));
    g.setAttribute('aPat', new Float32BufferAttribute(this.pat, 2));
    g.setAttribute('aOut', new Float32BufferAttribute(this.out, 3));
    g.setAttribute('aTan', new Float32BufferAttribute(this.tan, 3));
    g.setAttribute('aFace', new Float32BufferAttribute(this.face, 1));
    g.setAttribute('aShade', new Float32BufferAttribute(this.shade, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere(); (g.boundingSphere as Sphere).radius += 8;
    g.userData.s0 = this.sheet.s0; g.userData.s1 = this.sheet.s0 + this.sheet.length;
    return g;
  }
}

/** Build the strands of a weave over `sheet`. Returns one mesh per straw colour. */
export function buildWeave(sheet: Sheet, shared: PaperShared, collapse: boolean, colors: number[] = [0, 3, 1, 2], glow = 0.3): Mesh[] {
  const bw = sheet.def.weaveBand ?? 0.8, L = sheet.length, hwMax = sheet.maxHalfWidth;
  const width = bw * 0.86, thick = bw * 0.05, step = bw / 8, amp = WEAVE_AMP * bw;
  const builders = colors.map(() => new Strands(sheet));
  const mats: MeshStandardMaterial[] = colors.map((c) => createPaperMaterial(shared, {
    // a flattened straw of this width: its stripe keeps the real pitch-to-circumference ratio
    color: c, radius: bw * 2.2, pitch: width * 2 * 0.83, slope: 0.83, collapse, glow, bump: 0.7,
  }));
  const solid = (u: number, a: number) => sheet.sd(Math.min(L, Math.max(0, u)), Math.max(-sheet.halfWidth(u) + 0.12, Math.min(sheet.halfWidth(u) - 0.12, a))) > 0;
  const across = PROFILE.map((x) => x * width);
  const s0 = sheet.s0;
  // warp: strands running along the sheet
  const jMax = Math.floor((hwMax - width * 0.5) / bw + 1e-6);
  for (let j = -jMax; j <= jMax; j++) {
    const b = builders[((j % colors.length) + colors.length) % colors.length], aC = j * bw;
    let prev = -1;
    const over = 0.6 * bw;                         // cut ends stick out a little, like the real thing
    for (let u = -over; u <= L + over + 1e-6; u += step) {
      const uc = Math.min(L, Math.max(0, u));
      if (!solid(uc, aC)) { prev = -1; continue; }
      const h = warpHeight(s0 + u, j, bw);
      const r = b.ring(u, aC, across, h, thick, s0 + u + j * 3.1, true, (h + amp) / (2 * amp));
      if (prev >= 0) b.band(prev, false);
      prev = r;
    }
  }
  // weft: strands running across
  const i0 = Math.ceil((s0 + width * 0.5) / bw - 0.5), i1 = Math.floor((s0 + L - width * 0.5) / bw - 0.5);
  for (let i = i0; i <= i1; i++) {
    const b = builders[(((i * 3 + 1) % colors.length) + colors.length) % colors.length], uC = (i + 0.5) * bw - s0;
    const hw = sheet.halfWidth(uC) + 0.45 * bw;
    let prev = -1;
    for (let a = -hw; a <= hw + 1e-6; a += step) {
      if (!solid(uC, a)) { prev = -1; continue; }
      const h = weftHeight(a, i, bw);
      const r = b.ring(uC, a, across, h, thick, a + i * 2.7, false, (h + amp) / (2 * amp));
      if (prev >= 0) b.band(prev, true);
      prev = r;
    }
  }
  const out: Mesh[] = [];
  builders.forEach((b, k) => { const g = b.build(); if (g) { const m = new Mesh(g, mats[k]); m.customDepthMaterial = mats[k].userData.depth; out.push(m); } });
  return out;
}
