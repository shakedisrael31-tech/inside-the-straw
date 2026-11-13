/**
 * The world outside the course. Instead of scattered props it is composed
 * of three landmarks, each grown from one of the physical experiments and
 * each tied to the stretch of course that passes through it:
 *
 *   the bundle        staggered straws lashed side by side, split ends and
 *                     peels at their tips; the course runs through one of them
 *   the woven sheet   a broad weave that rises and sags like cloth; the
 *                     woven bridge is a corner of it
 *   the stack         cut segments piled in crossing layers; the stepping
 *                     segments are its top course
 *
 * Everything is built with the same Sheet machinery and paper material as
 * the course itself.
 */
import {
  BackSide, BufferAttribute, Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Vector3,
} from 'three';
import { CONFIG } from '../config';
import { rng, TAU } from '../core/math';
import { Sheet, Frame, type SheetDef, type StartFrame } from './sheet';
import { buildSheetGeometries, DECOR_MESH, FAR_MESH, type MeshOpts } from './sheetMesh';
import { createPaperMaterial, type PaperShared } from './paperMaterial';
import type { Route } from './route';
import { buildWeave } from './weave';

const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
let decorSeed = 1;
const ORIGIN = (): StartFrame => ({ p: new Vector3(), t: new Vector3(0, 0, 1), n: new Vector3(0, 1, 0), b: new Vector3(-1, 0, 0) });

function addSheet(group: Group, shared: PaperShared, def: SheetDef, start: StartFrame, shadows: boolean, opts: MeshOpts = DECOR_MESH) {
  const sh = new Sheet(def, start);
  sh.s0 = (decorSeed++ * 7.31) % 50; sh.index = decorSeed;
  const mat = createPaperMaterial(shared, { color: def.color, radius: def.radius, pitch: sh.pitch, slope: sh.slope, collapse: false, glow: 0.1, bump: 0.6 });
  for (const g of buildSheetGeometries(sh, opts, true, true)) {
    const m = new Mesh(g, mat); m.castShadow = shadows; m.receiveShadow = true; group.add(m);
  }
  return sh;
}

/** A strip peeled back from the wall of a straw: where along, where around (degrees from the bottom line), and how it curls. */
export interface PeelSpec { at: number; deg: number; len: number; hw: number; curl: number; veer: number }

/**
 * A straw along local +Z, axis through the origin.
 * `feet` splits the far end into splayed tabs (the split-end experiment).
 * `peels` lifts strips out of its wall (the peeled-bundle experiment): each leaves a visible slit where it came
 * from, stays attached at one end, keeps the straw's stripes, and curls to a free end.
 */
export function makeStraw(shared: PaperShared, len: number, R: number, color: number, feet = 0, shadows = false, opts: MeshOpts = DECOR_MESH, splay = 1, peels: PeelSpec[] = []): Group {
  const g = new Group();
  const tube = addSheet(g, shared, {
    id: 'd', kind: 'tube', radius: R, color, path: [{ len }],
    holes: peels.map((p) => ({ u: p.at - p.len / 2, a: (p.deg * Math.PI / 180) * R, lu: p.len / 2, la: p.hw, shape: 'rect' as const, rag: 0.04 })),
  }, { p: new Vector3(0, -R, 0), t: Z.clone(), n: new Vector3(0, 1, 0), b: new Vector3(-1, 0, 0) }, shadows, opts);
  const pt = new Vector3(), nrm = new Vector3();
  for (const p of peels) {
    const a = (p.deg * Math.PI / 180) * R;
    tube.posRaw(p.at, a, 0, pt, nrm);
    const t = Z.clone().negate(), b = new Vector3().crossVectors(t, nrm).normalize();
    const L = p.len * 1.08;
    const strip = new Sheet({
      id: 'peel', kind: 'strip', radius: R, color,
      path: [{ len: L * 0.3, pitch: -p.curl * 0.2, yaw: p.veer * 0.2 }, { len: L * 0.4, pitch: -p.curl * 0.35, yaw: p.veer * 0.5 }, { len: L * 0.3, pitch: -p.curl * 0.45, yaw: p.veer * 0.3 }],
      curv: [[0, 1 / R], [L, 0.55 / R]], halfWidth: [[0, p.hw * 0.96], [L * 0.85, p.hw * 0.9], [L, p.hw * 0.55]],
    }, { p: pt.clone(), t, n: nrm.clone(), b });
    strip.index = decorSeed++; strip.s0 = tube.s0 + p.at; strip.sDir = -1; strip.aOff = a; strip.aDir = -1;
    const mat = createPaperMaterial(shared, { color, radius: R, pitch: tube.pitch, slope: tube.slope, collapse: false, glow: 0.1, bump: 0.6 });
    for (const geo of buildSheetGeometries(strip, { ...DECOR_MESH, du: 0.5, da: 0.35 }, false, true)) { const m = new Mesh(geo, mat); m.castShadow = shadows; m.receiveShadow = true; g.add(m); }
  }
  for (let i = 0; i < feet; i++) {
    const th = (i / feet) * TAU + 0.3;
    const n = new Vector3(0, 1, 0).applyAxisAngle(Z, th), b = new Vector3(-1, 0, 0).applyAxisAngle(Z, th);
    const L = R * (2.6 + 0.8 * Math.sin(i * 2.1));
    addSheet(g, shared, {
      id: 'f', kind: 'strip', radius: R, color, path: [{ len: L * 0.45, pitch: -62 * splay }, { len: L * 0.55, pitch: (-22 + 8 * Math.sin(i * 5)) * splay }],
      curv: [[0, 1 / R], [L * 0.6, 0.05]], halfWidth: [[0, (Math.PI * R) / feet * 0.9], [L, (Math.PI * R) / feet * 0.62]],
    }, { p: n.clone().multiplyScalar(-R).setZ(len), t: Z.clone(), n, b }, shadows);
  }
  return g;
}

/** Place a group so its local +Z runs along `t` with local +Y along `n`. */
function orient(g: Group, p: Vector3, t: Vector3, n: Vector3) {
  const x = new Vector3().crossVectors(n, t).normalize(), y = new Vector3().crossVectors(t, x).normalize();
  g.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, t.clone().normalize()));
  g.position.copy(p);
}

export function buildDecor(shared: PaperShared, route: Route): Group {
  const root = new Group();
  const r = rng(20261), C = CONFIG.colors;
  decorSeed = 1;
  const f = new Frame();

  const pts: Vector3[] = [];
  for (let s = 0; s <= route.total; s += 4) { const sh = route.at(s); const v = new Vector3(); sh.pos(s - sh.s0, 0, sh.wrap ? sh.radius : 0, v); pts.push(v); }
  const clearance = (x: number, z: number) => { let d = 1e9; for (const p of pts) d = Math.min(d, Math.hypot(p.x - x, p.z - z)); return d; };
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  // ── sky, tabletop, loose sheets of paper ─────────────────────
  const skyGeo = new SphereGeometry(1000, 24, 16);
  const top = new Color(C.skyTop), hor = new Color(C.skyHorizon), cols = new Float32Array(skyGeo.attributes.position.count * 3), tmp = new Color();
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const y = skyGeo.attributes.position.getY(i) / 1000;
    tmp.copy(hor).lerp(top, Math.min(1, Math.max(0, y * 1.6 + 0.05)) ** 0.8); tmp.toArray(cols, i * 3);
  }
  skyGeo.setAttribute('color', new BufferAttribute(cols, 3));
  const sky = new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.position.set(cx, 0, cz); sky.renderOrder = -10; root.add(sky);
  const desk = new Mesh(new PlaneGeometry(2600, 2600), new MeshStandardMaterial({ color: '#b98f5c', roughness: 1 }));
  desk.rotation.x = -Math.PI / 2; desk.position.set(cx, -0.6, cz); desk.receiveShadow = true; root.add(desk);
  const tones = ['#fbf6ea', '#f3ead6', '#fdfaf2'];
  for (let i = 0; i < 14; i++) {
    const w = 170 + r() * 180, sheet = new Mesh(new PlaneGeometry(w, w * 1.41), new MeshStandardMaterial({ color: tones[i % 3], roughness: 1 }));
    sheet.rotation.x = -Math.PI / 2; sheet.rotation.z = (r() - 0.5) * 1.4;
    sheet.position.set(minX + (maxX - minX) * r() + (r() - 0.5) * 140, -0.5 + i * 0.035, minZ + (maxZ - minZ) * (i / 13) + (r() - 0.5) * 50);
    sheet.receiveShadow = true; root.add(sheet);
  }

  const stand = (x: number, z: number, h: number, R: number, color: number, feet: number, shadows = false) => {
    const g = makeStraw(shared, h, R, color, feet, shadows);
    g.rotation.x = Math.PI / 2; g.rotation.z = r() * TAU; g.position.set(x, h + 0.2, z);
    g.rotateOnWorldAxis(X, (r() - 0.5) * 0.06); root.add(g); return g;
  };
  // a few broad supports under the closed straws, far enough apart to read as structure rather than fence posts
  for (const id of ['T1', 'T2', 'T5', 'T6']) {
    const sh = route.sheet(id);
    for (let u = sh.length * 0.22; u < sh.length; u += sh.length * 0.56) {
      const v = new Vector3(); sh.pos(u, 0, 0, v);
      stand(v.x, v.z, v.y - 0.5, 1.5, (sh.def.color + 2) % 4, 8, true);
    }
  }

  // ── landmark 1: the bundle ───────────────────────────────────
  // Source: the narrow bundle with staggered ends and strips peeling from different straws.
  // Three neighbours lie against the blue straw the course runs through; each is a distinct cylinder,
  // their ends are staggered, and strips peel from two of them with free curling ends.
  {
    const t3 = route.sheet('T3'); t3.frame(0, f);
    const R = t3.radius, axis = f.p.clone().addScaledVector(f.n, R), T = f.t.clone(), N = f.n.clone(), B = f.b.clone();
    // angle from straight down, how far before the mouth it starts, length, colour, peels
    const members: [number, number, number, number, PeelSpec[]][] = [
      [-92, 13, 50, 0, [{ at: 26, deg: -75, len: 15, hw: 1.5, curl: 150, veer: -70 }]],
      [92, -7, 52, 1, [{ at: 34, deg: 75, len: 17, hw: 1.4, curl: 190, veer: 60 }, { at: 51, deg: 112, len: 9, hw: 1.2, curl: 240, veer: -30 }]],
      [0, 20, 64, 3, []],
    ];
    members.forEach(([deg, back, len, color, peels], i) => {
      const a = (deg * Math.PI) / 180;
      const off = N.clone().multiplyScalar(-Math.cos(a)).addScaledVector(B, Math.sin(a));
      const g = makeStraw(shared, len, R, color, 0, true, { ...DECOR_MESH, du: 0.8, da: 0.4 }, 1, peels);
      // turn each straw so its own "bottom line" faces the course straw: peel angles are then relative to the bundle
      orient(g, axis.clone().addScaledVector(off, 2 * R + 0.1).addScaledVector(T, -back), T, off.clone().negate());
      void i; root.add(g);
    });
    // the trestle the bundle rests on: two pairs of splay-footed straws
    for (const u of [2, 40]) for (const side of [-1, 1]) {
      const p = axis.clone().addScaledVector(T, u).addScaledVector(B, side * 2.2).addScaledVector(N, -3 * R - 0.2);
      const g = stand(p.x + side * 4.5, p.z, p.y, 1.2, side > 0 ? 0 : 2, 7, true);
      g.rotateOnWorldAxis(T, -side * 0.24);
    }
  }

  // ── landmark 2: the woven sheet ──────────────────────────────
  // One broad weave that climbs to meet the bridge and sags away beyond it. The bridge is its near corner.
  {
    const wb = route.sheet('WB'); wb.frame(wb.length * 0.5, f);
    const dir = f.t.clone().setY(0).normalize().applyAxisAngle(new Vector3(0, 1, 0), -0.5), up = new Vector3(0, 1, 0);
    const g = new Group();
    // Kept modest and set well back from the route: a single recognizable patch of
    // cloth climbing to meet the bridge, not a carpet spanning the whole background.
    const cloth = new Sheet({
      id: 'w', kind: 'weave', radius: 2, color: 3, weaveBand: 6,
      path: [{ len: 26, pitch: 18 }, { len: 30, pitch: -30 }],
      halfWidth: [[0, 16], [56, 12]],
    }, ORIGIN());
    cloth.s0 = 0; cloth.index = 900;
    for (const m of buildWeave(cloth, shared, false, [0, 1, 2, 3], 0.05)) { m.receiveShadow = true; g.add(m); }
    const origin = f.p.clone().addScaledVector(dir, -130).addScaledVector(new Vector3().crossVectors(dir, up), 50); origin.y = f.p.y - 24;
    orient(g, origin, dir, up); root.add(g);
    // posts where the cloth is pinned up
    for (const [along, across, top] of [[16, -12, 0], [16, 12, 0], [42, -8, 4], [42, 10, 4]] as const) {
      const p = origin.clone().addScaledVector(dir, along).addScaledVector(new Vector3().crossVectors(up, dir), across);
      stand(p.x, p.z, Math.max(6, f.p.y - 14 + top), 1.6, (along + across) % 3 === 0 ? 1 : 0, 8);
    }
  }

  // ── landmark 3: the staggered stack ──────────────────────────
  // Cut segments piled in crossing layers. The stepping segments of the course are its top layer.
  {
    const st = route.sheet('ST3'); st.frame(st.length / 2, f);
    const dir = f.t.clone().setY(0).normalize(), sideV = new Vector3().crossVectors(new Vector3(0, 1, 0), dir).normalize(), up = new Vector3(0, 1, 0);
    const centre = f.p.clone(), R = 2.5, pitchY = R * 1.86, topY = centre.y - R - 1.2;
    const layers = Math.max(2, Math.floor((topY - R) / pitchY));
    for (let L = 0; L < layers; L++) {
      const y = topY - L * pitchY, alongRoute = L % 2 === 0, n = 3 + Math.ceil(L * 0.9), run = alongRoute ? dir : sideV, cross = alongRoute ? sideV : dir;
      for (let i = 0; i < n; i++) {
        const len = 30 + r() * 26 + L * 3, slip = (r() - 0.5) * 14;
        const p = centre.clone().addScaledVector(cross, (i - (n - 1) / 2) * R * 2.06 + (alongRoute ? 0 : 4)).addScaledVector(run, -len / 2 + slip); p.y = y;
        const g = makeStraw(shared, len, R, Math.floor(r() * 4), 0, L < 2, L < 3 ? DECOR_MESH : FAR_MESH);
        orient(g, p, run, up); g.rotateZ(r() * TAU); root.add(g);
      }
    }
    // offcuts at its foot
    for (let i = 0; i < 7; i++) {
      const ang = r() * TAU, dist = 36 + r() * 26, len = 7 + r() * 9, Rr = 1.3 + r() * 0.8;
      const g = makeStraw(shared, len, Rr, Math.floor(r() * 4), 0, false, FAR_MESH);
      g.rotation.y = r() * TAU; g.position.set(centre.x + Math.cos(ang) * dist, Rr - 0.3, centre.z + Math.sin(ang) * dist); root.add(g);
    }
  }

  // ── background: a few very large straws lying far off, for depth ──
  for (let i = 0; i < 5; i++) {
    const x = minX - 170 + r() * (maxX - minX + 340), z = minZ - 60 + r() * (maxZ - minZ + 220);
    if (clearance(x, z) < 95) continue;
    const R = 5 + r() * 5, len = 110 + r() * 120;
    const g = makeStraw(shared, len, R, Math.floor(r() * 4), 0, false, FAR_MESH);
    g.rotation.y = r() * TAU; g.position.set(x, R - 0.4, z); root.add(g);
  }
  return root;
}
