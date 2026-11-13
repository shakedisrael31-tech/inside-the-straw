/** Builds the scene: course meshes, light, props (checkpoints, stars, envelope) and the decoration. */
import {
  AmbientLight, BoxGeometry, BufferGeometry, CircleGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Fog, Group,
  HemisphereLight, Mesh, Vector4, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, Scene, Shape, ShapeGeometry, Vector3, Matrix4,
} from 'three';
import { CONFIG } from '../config';
import { Route, type PeelEvent } from './route';
import { COURSE, CHECKPOINTS, EVENTS, STARS, ENVELOPE } from './level';
import { buildSheetGeometries, COURSE_MESH } from './sheetMesh';
import { buildWeave } from './weave';
import { Sheet, Frame } from './sheet';
import { createPaperMaterial, createShared, type PaperShared } from './paperMaterial';
import { buildDecor } from './decor';

export interface Star { mesh: Mesh; s: number; a: number; h: number; taken: boolean }
export interface CheckpointProp { s: number; band: Mesh; mat: MeshStandardMaterial; glow: number }

const SUN = new Vector3(-0.45, 0.78, 0.35).normalize();
const _p = new Vector3(), _n = new Vector3(), _q = new Vector3();

export class World {
  readonly scene = new Scene();
  readonly route: Route;
  readonly shared: PaperShared;
  readonly sun: DirectionalLight;
  readonly stars: Star[] = [];
  readonly checkpoints: CheckpointProp[] = [];
  readonly envelope = new Group();
  private envFlap = new Group(); private envLetter!: Mesh;
  private chunks: Mesh[] = [];
  private shadowSize = 2048;
  private evSort: PeelEvent[] = [];

  constructor() {
    this.route = new Route(COURSE, { p: new Vector3(0, 52, 0), yaw: 0, pitch: 0, roll: 0 }, EVENTS);
    this.shared = createShared();
    this.shared.uSunDir.value.copy(SUN);
    const scene = this.scene, C = CONFIG.colors;
    scene.fog = new Fog(new Color(C.skyHorizon), 90, 620);

    scene.add(new HemisphereLight('#fff6e6', '#e8cfa2', 1.45));
    scene.add(new AmbientLight('#fff1dc', 0.35));
    const sun = (this.sun = new DirectionalLight('#ffdcab', 2.9));
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
    scene.add(sun, sun.target);

    // the course
    const sheets = this.route.sheets;
    const add = (sh: Sheet, mat: MeshStandardMaterial, capStart: boolean, capEnd: boolean) => {
      for (const g of buildSheetGeometries(sh, COURSE_MESH, capStart, capEnd)) {
        const m = new Mesh(g, mat);
        m.castShadow = m.receiveShadow = true; m.customDepthMaterial = mat.userData.depth;
        scene.add(m); this.chunks.push(m);
      }
    };
    const f = new Frame(), nrm = new Vector3(), pt = new Vector3();
    sheets.forEach((sh, i) => {
      if (sh.def.kind === 'void') return;
      if (sh.def.kind === 'weave') {
        // the woven bridge is built strand by strand
        for (const m of buildWeave(sh, this.shared, true)) { m.castShadow = m.receiveShadow = true; scene.add(m); this.chunks.push(m); }
        return;
      }
      const mat = createPaperMaterial(this.shared, { color: sh.def.color, radius: sh.radius, pitch: sh.pitch, slope: sh.slope, collapse: true, circ: sh.wrap ? sh.circ : 0 });
      if (sh.def.straw) {
        // a stack segment: draw the whole closed straw whose top is the walkable strip, hollow cut ends showing
        sh.frame(0, f);
        const R = sh.radius, tube = new Sheet({ id: sh.def.id + '-straw', kind: 'tube', radius: R, color: sh.def.color, path: [{ len: sh.length }] },
          { p: f.p.clone().addScaledVector(f.n, -2 * R), t: f.t.clone(), n: f.n.clone(), b: new Vector3().crossVectors(f.t, f.n).normalize() });
        tube.index = 200 + i; tube.s0 = sh.s0;
        add(tube, mat, true, true);
        return;
      }
      const open = (o: Sheet | undefined) => !o || o.def.kind === 'void' || o.def.kind === 'weave' || sh.def.kind === 'weave' || !!o.def.rise;
      add(sh, mat, open(sheets[i - 1]) || !!sh.def.rise, open(sheets[i + 1]));
      // every tear keeps its torn-out piece, hanging outside from the far edge of the hole
      for (const hole of sh.def.holes ?? []) {
        if (!hole.tab) continue;
        const u1 = hole.u + hole.lu * 0.86;
        sh.frame(u1, f); sh.pos(u1, hole.a, 0, pt, nrm);
        const t = f.t.clone().negate(), b = new Vector3().crossVectors(t, nrm).normalize();
        const L = hole.lu * 1.75;
        const tab = new Sheet({ id: sh.def.id + '-tab', kind: 'strip', radius: sh.radius, color: sh.def.color, path: [{ len: L * 0.5, pitch: -95 }, { len: L * 0.5, pitch: -70 }],
          curv: [[0, 1 / sh.radius]], halfWidth: [[0, hole.la * 0.5], [L * 0.3, hole.la * 0.8], [L, hole.la * 0.55]] }, { p: pt.clone(), t, n: nrm.clone(), b });
        tab.index = 100 + i; tab.s0 = sh.s0 + u1; tab.sDir = -1; tab.aOff = hole.a; tab.aDir = -1;
        add(tab, mat, false, true);
      }
    });

    this.buildCheckpoints(); this.buildStars(); this.buildEnvelope();
    scene.add(buildDecor(this.shared, this.route));
  }

  private buildCheckpoints() {
    const r = this.route;
    for (const cp of CHECKPOINTS) {
      const sh = r.sheet(cp.sheet), pos: number[] = [], nrm: number[] = [], idx: number[] = [];
      const half = sh.wrap ? sh.circ / 2 : sh.maxHalfWidth, n = Math.ceil((half * 2) / 0.25);
      let prev = -1;
      for (let j = 0; j <= n; j++) {
        const a = -half + (j / n) * half * 2;
        if (sh.sd(cp.u, a) <= 0.05 || sh.sd(cp.u + 0.45, a) <= 0.05) { prev = -1; continue; }
        const base = pos.length / 3;
        for (const du of [0, 0.45]) { sh.pos(cp.u + du, a, 0.035, _p, _n); pos.push(_p.x, _p.y, _p.z); nrm.push(_n.x, _n.y, _n.z); }
        if (prev >= 0) idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
        prev = base;
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new Float32BufferAttribute(nrm, 3)); g.setIndex(idx);
      const mat = new MeshStandardMaterial({ color: '#c9a56c', roughness: 0.9, emissive: '#ffcf70', emissiveIntensity: 0.15, side: DoubleSide });
      const band = new Mesh(g, mat); band.receiveShadow = true; this.scene.add(band);
      this.checkpoints.push({ s: sh.s0 + cp.u, band, mat, glow: 0 });
    }
  }

  private buildStars() {
    if (!CONFIG.collectibles.enabled) return;
    const geo = new OctahedronGeometry(0.2, 0);
    geo.scale(1, 1.35, 1);
    const mat = new MeshStandardMaterial({ color: '#ffc531', emissive: '#ff9d1e', emissiveIntensity: 0.55, roughness: 0.6, flatShading: true });
    for (const st of STARS) {
      const sh = this.route.sheet(st.sheet), h = st.h ?? 0.55, a = sh.wrapA(st.a);
      const m = new Mesh(geo, mat); sh.pos(st.u, a, h, m.position, _n);
      m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), _n);
      this.scene.add(m);
      this.stars.push({ mesh: m, s: sh.s0 + st.u, a, h, taken: false });
    }
  }

  private buildEnvelope() {
    const sh = this.route.sheet(ENVELOPE.sheet), f = { p: new Vector3(), t: new Vector3(), n: new Vector3(), b: new Vector3() };
    sh.frame(ENVELOPE.u, f as never);
    const env = this.envelope;
    const paper = new MeshStandardMaterial({ color: '#f4ead3', roughness: 0.95, side: DoubleSide });
    const kraft = new MeshStandardMaterial({ color: '#dcc197', roughness: 0.95, side: DoubleSide });
    const W = 2.1, H = 1.4;
    const back = new Mesh(new BoxGeometry(W, H, 0.05), kraft); back.position.y = H / 2;
    const pocket = new Mesh(new BoxGeometry(W, H * 0.62, 0.03), paper); pocket.position.set(0, H * 0.31, -0.05);
    // airmail-style edge in the four straw colours
    const cols = [CONFIG.colors.red, CONFIG.colors.blue, CONFIG.colors.yellow, CONFIG.colors.green];
    for (let i = 0; i < 14; i++) {
      const s = new Mesh(new PlaneGeometry(W / 14 * 0.6, 0.1), new MeshStandardMaterial({ color: cols[i % 4], roughness: 0.9, side: DoubleSide }));
      s.position.set(-W / 2 + (i + 0.5) * (W / 14), 0.09, -0.07); env.add(s);
    }
    const tri = new Shape(); tri.moveTo(-W / 2, 0); tri.lineTo(W / 2, 0); tri.lineTo(0, -H * 0.55); tri.closePath();
    const flap = new Mesh(new ShapeGeometry(tri), paper); flap.position.z = -0.075;
    const seal = new Mesh(new CircleGeometry(0.13, 20), new MeshStandardMaterial({ color: CONFIG.colors.red, roughness: 0.7, side: DoubleSide }));
    seal.position.set(0, -H * 0.5, -0.085); flap.add(seal);
    this.envFlap.add(flap); this.envFlap.position.y = H;
    this.envLetter = new Mesh(new PlaneGeometry(W * 0.82, H * 0.8), new MeshStandardMaterial({ color: '#fffaf0', roughness: 0.9, side: DoubleSide, emissive: '#fff3d0', emissiveIntensity: 0.25 }));
    this.envLetter.position.set(0, H * 0.45, -0.03);
    env.add(back, pocket, this.envFlap, this.envLetter);
    env.traverse((o) => { o.castShadow = true; });
    // stand it on the pad, facing back toward the arriving traveller, leaning a little
    const m = new Matrix4().makeBasis(_q.copy(f.b).negate(), f.n, f.t);
    env.quaternion.setFromRotationMatrix(m); env.position.copy(f.p).addScaledVector(f.n, 0.02);
    env.rotateX(0.2);
    this.scene.add(env);
    this.setEnvelopeOpen(0);
  }

  /** 0 closed .. 1 open with the letter raised. */
  setEnvelopeOpen(k: number) {
    const e = Math.min(1, k * 1.6), l = Math.max(0, Math.min(1, (k - 0.45) / 0.55));
    this.envFlap.rotation.x = e * Math.PI * 0.92;
    this.envLetter.position.y = 1.4 * 0.45 + l * 0.75;
  }

  setQuality(shadows: boolean, size: number) {
    this.sun.castShadow = shadows;
    if (size !== this.shadowSize) { this.shadowSize = size; this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null as never; }
  }

  update(dt: number, time: number, focus: Vector3, playerS = 0) {
    this.shared.uTime.value = time;
    this.shared.uFront.value = this.route.front;
    // hand the nearest active peel events to the shader (the same objects collision reads)
    const A = this.shared.uEvA.value, B = this.shared.uEvB.value;
    let slot = 0;
    this.evSort.length = 0;
    for (const ev of this.route.events) if (ev.t >= 0 && Math.abs((ev.s0 + ev.s1) / 2 - playerS) < 160) this.evSort.push(ev);
    this.evSort.sort((x, y) => Math.abs(x.s0 - playerS) - Math.abs(y.s0 - playerS));
    for (const ev of this.evSort) { if (slot >= A.length) break; A[slot].set(ev.s0, ev.s1, ev.def.a, ev.def.w); B[slot].set(ev.frontS, ev.lift, 0, 0); slot++; }
    for (; slot < A.length; slot++) (A[slot] as Vector4).set(0, 0, 0, 0);
    // keep the shadow frustum centred on the action, snapped to texels to stop shimmer
    const texel = 68 / this.shadowSize * 4;
    _p.copy(focus); _p.x = Math.round(_p.x / texel) * texel; _p.y = Math.round(_p.y / texel) * texel; _p.z = Math.round(_p.z / texel) * texel;
    this.sun.target.position.copy(_p); this.sun.position.copy(_p).addScaledVector(SUN, 110);
    const front = this.route.front;
    for (const c of this.chunks) c.visible = (c.geometry.userData.s1 as number) > front - 24;
    for (const st of this.stars) if (!st.taken) { st.mesh.rotateY(dt * 2.2); }
    for (const cp of this.checkpoints) {
      cp.glow = Math.max(0, cp.glow - dt * 0.5);
      cp.mat.emissiveIntensity = 0.15 + cp.glow * 1.6;
      cp.band.visible = cp.s > front - 2;
    }
  }
}
