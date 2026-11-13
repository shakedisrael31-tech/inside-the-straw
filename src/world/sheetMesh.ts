/**
 * Turns a Sheet into renderable paper: an inner face, an outer face a thin
 * wall thickness away, and a rim wherever the paper is cut or torn, so
 * every opening shows the thickness of the straw wall.
 *
 * The outline of the paper comes from marching squares over Sheet.sd(),
 * the same field collision uses. Where the sheet has relief (a crushed
 * wall, woven over/under, lifted tabs) normals are taken from the deformed
 * surface and the folds are shaded a little darker.
 */
import { BufferGeometry, Float32BufferAttribute, Vector3, Sphere } from 'three';
import { Frame, type Sheet } from './sheet';

export interface MeshOpts { du: number; da: number; thickness: number; chunk: number }
export const COURSE_MESH: MeshOpts = { du: 0.4, da: 0.29, thickness: 0.035, chunk: 16 };
export const WEAVE_MESH: MeshOpts = { du: 0.2, da: 0.2, thickness: 0.05, chunk: 16 };
export const DECOR_MESH: MeshOpts = { du: 1.1, da: 0.6, thickness: 0.03, chunk: 1e6 };
export const FAR_MESH: MeshOpts = { du: 2.2, da: 1.0, thickness: 0.03, chunk: 1e6 };

const P = new Vector3(), N = new Vector3(), A0 = new Vector3(), B0 = new Vector3(), A1 = new Vector3(), B1 = new Vector3();
const E1 = new Vector3(), E2 = new Vector3(), G = new Vector3(), C = new Vector3(), NA = new Vector3(), NB = new Vector3();
const PU = new Vector3(), PA = new Vector3(), FN = new Vector3();
const FR = new Frame();

class Builder {
  pos: number[] = []; nrm: number[] = []; coord: number[] = []; out: number[] = []; tan: number[] = []; face: number[] = []; shade: number[] = []; idx: number[] = [];
  count = 0;
  constructor(private sheet: Sheet, private t: number) {}
  /** layer 0 = walked-on face, 1 = far face. */
  vert(u: number, a: number, layer: number): number {
    const sh = this.sheet;
    sh.pos(u, a, layer ? -this.t : 0, P, N);
    let shade = 1;
    if (sh.hasRelief) {
      // normal of the deformed surface, by finite differences
      const e = 0.07;
      sh.pos(u, a, 0, A0); sh.pos(u + e, a, 0, PU); sh.pos(u, a + e, 0, PA);
      FN.crossVectors(PA.sub(A0), PU.sub(A0)).normalize();
      shade = 1 - Math.min(0.34, (1 - FN.dot(N)) * 1.7);
      const s = layer ? -1 : 1;
      return this.raw(P, FN.x * s, FN.y * s, FN.z * s, u, a, N, layer, shade);
    }
    return this.raw(P, layer ? -N.x : N.x, layer ? -N.y : N.y, layer ? -N.z : N.z, u, a, N, layer, shade);
  }
  raw(p: Vector3, nx: number, ny: number, nz: number, u: number, a: number, surfN: Vector3, face: number, shade = 1): number {
    const sh = this.sheet;
    this.pos.push(p.x, p.y, p.z); this.nrm.push(nx, ny, nz);
    const t = sh.frame(u, FR).t;
    this.coord.push(sh.s0 + sh.sDir * u, sh.aOff + sh.aDir * a); this.out.push(-surfN.x, -surfN.y, -surfN.z); this.tan.push(t.x * sh.sDir, t.y * sh.sDir, t.z * sh.sDir); this.face.push(face); this.shade.push(shade);
    return this.count++;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  /** Rim quad across the wall thickness between two points on the cut line. */
  rim(ua: number, aa: number, ub: number, ab: number, solidU: number, solidA: number) {
    const sh = this.sheet;
    sh.pos(ua, aa, 0, A0, NA); sh.pos(ub, ab, 0, B0, NB); sh.pos(ua, aa, -this.t, A1); sh.pos(ub, ab, -this.t, B1);
    sh.pos(solidU, solidA, 0, C);
    E1.subVectors(B0, A0); E2.subVectors(B1, A0); G.crossVectors(E1, E2).normalize();
    const flip = G.dot(C.sub(A0)) > 0;
    if (flip) G.negate();
    const i0 = this.raw(A0, G.x, G.y, G.z, ua, aa, NA, 2), i1 = this.raw(B0, G.x, G.y, G.z, ub, ab, NB, 2);
    const i2 = this.raw(B1, G.x, G.y, G.z, ub, ab, NB, 2), i3 = this.raw(A1, G.x, G.y, G.z, ua, aa, NA, 2);
    if (flip) { this.tri(i0, i2, i1); this.tri(i0, i3, i2); } else { this.tri(i0, i1, i2); this.tri(i0, i2, i3); }
  }
  build(): BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aCoord', new Float32BufferAttribute(this.coord, 2));
    g.setAttribute('aOut', new Float32BufferAttribute(this.out, 3));
    g.setAttribute('aTan', new Float32BufferAttribute(this.tan, 3));
    g.setAttribute('aPat', new Float32BufferAttribute(this.coord, 2));
    g.setAttribute('aFace', new Float32BufferAttribute(this.face, 1));
    g.setAttribute('aShade', new Float32BufferAttribute(this.shade, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    // unravelled and peeled strips flare outward in the vertex shader; keep them from being culled
    (g.boundingSphere as Sphere).radius += this.sheet.radius * 2 + 6;
    return g;
  }
}

export function buildSheetGeometries(sheet: Sheet, o: MeshOpts, capStart = false, capEnd = false): BufferGeometry[] {
  if (sheet.def.kind === 'void') return [];
  const out: BufferGeometry[] = [];
  const L = sheet.length, t = o.thickness;
  const nChunks = Math.max(1, Math.round(L / o.chunk));
  const nuTotal = Math.max(1, Math.ceil(L / o.du)), du = L / nuTotal;
  const half = sheet.wrap ? sheet.circ / 2 : sheet.maxHalfWidth + o.da;
  const nc = Math.max(2, sheet.wrap ? Math.round(sheet.circ / o.da) : Math.ceil((2 * half) / o.da));
  const da = (2 * half) / nc;
  const W = nc + 1;
  const pu: number[] = [], pa: number[] = [], px: boolean[] = [];

  for (let ch = 0; ch < nChunks; ch++) {
    const i0 = Math.floor((ch * nuTotal) / nChunks), i1 = Math.floor(((ch + 1) * nuTotal) / nChunks), nu = i1 - i0;
    if (nu <= 0) continue;
    const b = new Builder(sheet, t);
    const sd = new Float32Array((nu + 1) * W);
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nc; j++) sd[i * W + j] = sheet.sd(Math.min(L, (i0 + i) * du), -half + j * da);
    const grid = [new Int32Array((nu + 1) * W).fill(-1), new Int32Array((nu + 1) * W).fill(-1)];
    const gv = (i: number, j: number, layer: number) => {
      const k = i * W + j;
      if (grid[layer][k] < 0) grid[layer][k] = b.vert(Math.min(L, (i0 + i) * du), -half + j * da, layer);
      return grid[layer][k];
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nc; j++) {
      const v = [sd[i * W + j], sd[(i + 1) * W + j], sd[(i + 1) * W + j + 1], sd[i * W + j + 1]];
      const inside = (v[0] > 0 ? 1 : 0) + (v[1] > 0 ? 1 : 0) + (v[2] > 0 ? 1 : 0) + (v[3] > 0 ? 1 : 0);
      if (!inside) continue;
      const cu = [(i0 + i) * du, Math.min(L, (i0 + i + 1) * du), Math.min(L, (i0 + i + 1) * du), (i0 + i) * du];
      const ca = [-half + j * da, -half + j * da, -half + (j + 1) * da, -half + (j + 1) * da];
      if (inside === 4) {
        const a = gv(i, j, 0), bb = gv(i + 1, j, 0), c = gv(i + 1, j + 1, 0), d = gv(i, j + 1, 0);
        b.tri(a, d, bb); b.tri(bb, d, c);
        const a2 = gv(i, j, 1), b2 = gv(i + 1, j, 1), c2 = gv(i + 1, j + 1, 1), d2 = gv(i, j + 1, 1);
        b.tri(a2, b2, d2); b.tri(b2, c2, d2);
        if (capStart && i0 + i === 0) b.rim(cu[0], ca[0], cu[3], ca[3], cu[1], ca[1]);
        if (capEnd && i0 + i + 1 === nuTotal) b.rim(cu[1], ca[1], cu[2], ca[2], cu[0], ca[0]);
        continue;
      }
      // clip the cell against the paper outline
      pu.length = pa.length = px.length = 0;
      let su = 0, sa = 0, sn = 0;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) & 3;
        if (v[k] > 0) { pu.push(cu[k]); pa.push(ca[k]); px.push(false); su += cu[k]; sa += ca[k]; sn++; }
        if (v[k] > 0 !== v[k2] > 0) {
          const f = v[k] / (v[k] - v[k2]);
          pu.push(cu[k] + (cu[k2] - cu[k]) * f); pa.push(ca[k] + (ca[k2] - ca[k]) * f); px.push(true);
        }
      }
      const n = pu.length;
      if (n < 3) continue;
      for (let layer = 0; layer < 2; layer++) {
        const base = b.count;
        for (let k = 0; k < n; k++) b.vert(pu[k], pa[k], layer);
        for (let k = 1; k < n - 1; k++) layer ? b.tri(base, base + k, base + k + 1) : b.tri(base, base + k + 1, base + k);
      }
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        if (px[k] && px[k2]) b.rim(pu[k], pa[k], pu[k2], pa[k2], su / sn, sa / sn);
      }
    }
    const g = b.build();
    if (g) { g.userData.s0 = sheet.s0 + i0 * du; g.userData.s1 = sheet.s0 + i1 * du; out.push(g); }
  }
  return out;
}
