/**
 * The paper traveller: a small folded-paper figure with a wide conical hat
 * and an ochre backpack. Built from a handful of flat-shaded primitives and
 * animated procedurally (idle, run, jump, fall, land, lean, success).
 */
import {
  BoxGeometry, CanvasTexture, CircleGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Vector3,
} from 'three';
import { damp } from '../core/math';
import type { PlayerController } from './controller';

const _p = new Vector3(), _n = new Vector3(), _t = new Vector3(), _x = new Vector3(), _m = new Matrix4(), _p2 = new Vector3();

const paper = (color: string, emissive = 0.0) => new MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, emissive: color, emissiveIntensity: emissive });

export class Traveler {
  readonly root = new Group();
  readonly shadow: Mesh;
  private body = new Group(); private torso = new Group();
  private legL = new Group(); private legR = new Group(); private armL = new Group(); private armR = new Group();
  private head = new Group(); private scarf: Mesh;
  private phase = 0; private lean = 0; private yaw = 0; private squash = 0; private air = 0; private runW = 0;
  celebrate = 0;
  /** Set to 1 for a short cheer (checkpoint). Decays by itself. */
  cheer = 0;
  private slideW = 0; private brakeW = 0;
  /** Set true when a foot touches down during the run cycle (for footstep sounds). */
  stepped = false;

  constructor() {
    const cream = paper('#f7efdd', 0.12), kraft = paper('#d7b582', 0.08), ochre = paper('#c98a1c', 0.1), dark = paper('#6b4630'), skin = paper('#e7c39a', 0.08), indigo = paper('#27407a', 0.1);
    const coat = new Mesh(new CylinderGeometry(0.075, 0.185, 0.34, 7, 1), cream); coat.position.y = 0.33;
    const hem = new Mesh(new CylinderGeometry(0.185, 0.2, 0.03, 7, 1), kraft); hem.position.y = 0.165;
    const headM = new Mesh(new IcosahedronGeometry(0.095, 1), skin);
    const hair = new Mesh(new IcosahedronGeometry(0.1, 1), dark); hair.position.set(0, 0.012, -0.022); hair.scale.set(1, 0.95, 0.9);
    const hat = new Mesh(new ConeGeometry(0.25, 0.16, 8), kraft); hat.position.y = 0.115; hat.rotation.y = 0.3;
    const hatTip = new Mesh(new ConeGeometry(0.06, 0.07, 6), cream); hatTip.position.y = 0.2;
    this.head.add(headM, hair, hat, hatTip); this.head.position.y = 0.57;
    const pack = new Mesh(new BoxGeometry(0.19, 0.2, 0.1), ochre); pack.position.set(0, 0.36, -0.14);
    const packFlap = new Mesh(new BoxGeometry(0.2, 0.08, 0.11), paper('#a8700f', 0.1)); packFlap.position.set(0, 0.43, -0.142);
    const packPocket = new Mesh(new BoxGeometry(0.1, 0.07, 0.03), paper('#e0a637', 0.1)); packPocket.position.set(0, 0.31, -0.2);
    this.scarf = new Mesh(new BoxGeometry(0.05, 0.03, 0.2), indigo); this.scarf.geometry.translate(0, 0, -0.1); this.scarf.position.set(0.05, 0.5, -0.06);
    const collar = new Mesh(new CylinderGeometry(0.085, 0.095, 0.045, 7), indigo); collar.position.y = 0.495;
    const mkLimb = (g: Group, w: number, len: number, mat: MeshStandardMaterial) => { const m = new Mesh(new BoxGeometry(w, len, w * 1.1), mat); m.position.y = -len / 2; g.add(m); return m; };
    mkLimb(this.legL, 0.06, 0.17, dark); mkLimb(this.legR, 0.06, 0.17, dark);
    this.legL.position.set(0.065, 0.17, 0); this.legR.position.set(-0.065, 0.17, 0);
    for (const l of [this.legL, this.legR]) { const boot = new Mesh(new BoxGeometry(0.075, 0.045, 0.12), paper('#4f3222')); boot.position.set(0, -0.165, 0.02); l.add(boot); }
    mkLimb(this.armL, 0.05, 0.19, cream); mkLimb(this.armR, 0.05, 0.19, cream);
    this.armL.position.set(0.125, 0.46, 0); this.armR.position.set(-0.125, 0.46, 0);
    this.torso.add(coat, hem, pack, packFlap, packPocket, collar, this.scarf, this.head, this.armL, this.armR);
    this.body.add(this.torso, this.legL, this.legR);
    this.root.add(this.body);
    this.root.scale.setScalar(1.15);
    this.root.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; } });
    this.root.matrixAutoUpdate = false;

    // soft contact shadow so the feet always read against the stripes
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(60,35,15,0.55)'); gr.addColorStop(0.6, 'rgba(60,35,15,0.25)'); gr.addColorStop(1, 'rgba(60,35,15,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.shadow = new Mesh(new CircleGeometry(0.42, 20), new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.shadow.matrixAutoUpdate = false; this.shadow.renderOrder = 2;
  }

  update(dt: number, pc: PlayerController, time: number) {
    this.stepped = false;
    const falling = pc.mode === 'fall';
    if (falling) {
      _p.copy(pc.fallPos);
      this.body.rotation.x += dt * 5; this.body.rotation.z += dt * 2.3;
      const k = Math.max(0.001, 1 - pc.fallT / 0.9);
      this.root.matrix.identity().setPosition(_p); this.root.matrix.scale(_x.setScalar(1.15 * k));
      this.shadow.visible = false;
      this.armL.rotation.z = 2.4; this.armR.rotation.z = -2.4;
      return;
    }
    const sh = pc.sheet;
    sh.pos(pc.u, pc.a, pc.h, _p, _n);
    sh.pos(pc.u + 0.2, pc.a, pc.h, _p2); _t.subVectors(_p2, _p).normalize();
    _x.crossVectors(_n, _t).normalize(); _t.crossVectors(_x, _n);
    _m.makeBasis(_x, _n, _t).setPosition(_p);
    this.root.matrix.copy(_m).scale(_x.setScalar(1.15));
    // contact shadow on the paper below
    sh.pos(pc.u, pc.a, 0.03, _p2);
    this.shadow.matrix.copy(_m).setPosition(_p2);
    _m.makeRotationX(-Math.PI / 2); this.shadow.matrix.multiply(_m);
    const sc = 1 / (1 + pc.h * 1.2); this.shadow.matrix.scale(_x.set(sc, sc, sc));
    this.shadow.visible = pc.h < 2;

    const speed = pc.vu, grounded = pc.mode !== 'air';
    const moving = Math.hypot(pc.vu, pc.va);
    this.runW = damp(this.runW, grounded ? Math.min(1, moving / 3) : 0, 12, dt);
    this.air = damp(this.air, grounded ? 0 : 1, 14, dt);
    const prev = this.phase;
    this.phase += dt * (5 + moving * 2.6) * (grounded ? 1 : 0.4);
    if (grounded && !pc.sliding && moving > 0.6 && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) this.stepped = true;
    this.lean = damp(this.lean, pc.va * 0.075, 10, dt);
    this.yaw = damp(this.yaw, -Math.atan2(pc.va, Math.max(speed, 1.4)) * 0.75, 10, dt);
    this.squash = pc.landT < 0.22 ? Math.sin((pc.landT / 0.22) * Math.PI) : 0;

    this.slideW = damp(this.slideW, pc.sliding ? 1 : 0, 9, dt);
    this.brakeW = damp(this.brakeW, pc.braking ? 1 : 0, 12, dt);
    this.cheer = Math.max(0, this.cheer - dt * 1.3);
    const sl = this.slideW, br = this.brakeW;
    const w = this.runW * (1 - sl) * (1 - br * 0.8), s = Math.sin(this.phase), a = this.air, up = pc.vh > 0 ? 1 : 0;
    const cel = Math.max(this.celebrate, Math.sin(Math.min(1, this.cheer) * Math.PI) * 0.8);
    this.body.rotation.set(0, this.yaw * (1 - sl * 0.5), this.lean * (1 + sl * 0.9));
    // sliding: sit back on the paper, feet first; braking: dig the heels in
    this.body.position.y = w * Math.abs(Math.cos(this.phase)) * 0.035 - sl * 0.115 + (cel > 0 ? Math.abs(Math.sin(time * 7)) * 0.16 * cel : 0);
    this.body.scale.set(1 + this.squash * 0.16, 1 - this.squash * 0.22, 1 + this.squash * 0.16);
    this.torso.rotation.x = w * 0.2 + a * (up ? -0.12 : 0.22) - sl * 0.62 - br * 0.38;
    this.torso.position.y = Math.sin(time * 2.2) * 0.006 * (1 - w) + Math.sin(time * 31) * 0.004 * sl;
    this.legL.rotation.x = s * 0.95 * w - a * (up ? 0.9 : 0.25) - sl * (1.5 + Math.sin(time * 5) * 0.06) - br * 0.75;
    this.legR.rotation.x = -s * 0.95 * w - a * (up ? 0.3 : 0.6) - sl * (1.42 - Math.sin(time * 5) * 0.06) + br * 0.25;
    const wave = cel > 0 ? Math.sin(time * 9) * 0.35 * cel : 0;
    this.armL.rotation.x = -s * 0.8 * w - a * 0.4 + sl * 0.95 - br * 0.9; this.armR.rotation.x = s * 0.8 * w - a * 0.4 + sl * 0.95 - br * 0.9;
    this.armL.rotation.z = 0.12 + a * (up ? 1.1 : 2.3) + cel * (2.5 + wave) + sl * (0.55 + this.lean * 2.4) + br * 0.5;
    this.armR.rotation.z = -0.12 - a * (up ? 1.1 : 2.3) - cel * (2.5 - wave) - sl * (0.55 - this.lean * 2.4) - br * 0.5;
    this.head.rotation.x = -w * 0.12 + a * (up ? -0.2 : 0.15) - cel * 0.25 + sl * 0.35 + br * 0.2;
    this.head.rotation.z = Math.sin(time * 1.3) * 0.04 * (1 - w);
    this.scarf.rotation.x = -0.25 - w * 0.5 + Math.sin(time * 9 + 1) * 0.12 * (0.3 + w + sl) - a * 0.6 - sl * 0.7;
    this.scarf.rotation.y = Math.sin(time * 6) * 0.2 * (w + sl) - this.lean * 2;
  }

  resetPose() { this.body.rotation.set(0, 0, 0); this.celebrate = 0; this.cheer = 0; this.slideW = this.brakeW = 0; }
}
