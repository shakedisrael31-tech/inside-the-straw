/** Small paper fragments shed at the unravelling front. A fixed pool, no per-frame allocation. */
import { Color, DoubleSide, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { CONFIG, STRIPE_COLORS } from '../config';
import type { Route } from '../world/route';

const N = 140;
const _p = new Vector3(), _n = new Vector3(), _s = new Vector3(), _q = new Quaternion(), _m = new Matrix4(), _e = new Vector3();

export class PaperFragments {
  readonly mesh: InstancedMesh;
  density = 1;
  private pos = new Float32Array(N * 3); private vel = new Float32Array(N * 3); private life = new Float32Array(N); private spin = new Float32Array(N * 2);
  private next = 0; private acc = 0;
  private cream = new Color(CONFIG.colors.paper); private inks = STRIPE_COLORS.map((c) => new Color(c));

  constructor(private route: Route) {
    this.mesh = new InstancedMesh(new PlaneGeometry(0.2, 0.13), new MeshStandardMaterial({ roughness: 1, side: DoubleSide }), N);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage); this.mesh.frustumCulled = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) { this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, this.cream); }
  }

  reset() { this.life.fill(0); }

  /** A small fleck thrown up from the paper (slide wake). */
  puff(p: Vector3, n: Vector3, back: Vector3, colorIndex: number) {
    const i = this.next; this.next = (this.next + 1) % N;
    this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.3; this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.1; this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
    const up = 0.8 + Math.random() * 1.2, bk = 1 + Math.random() * 1.5;
    this.vel[i * 3] = n.x * up + back.x * bk + (Math.random() - 0.5); this.vel[i * 3 + 1] = n.y * up + back.y * bk + 0.6; this.vel[i * 3 + 2] = n.z * up + back.z * bk + (Math.random() - 0.5);
    this.life[i] = 0.45; this.spin[i * 2] = Math.random() * 6; this.spin[i * 2 + 1] = 6 + Math.random() * 8;
    this.mesh.setColorAt(i, Math.random() < 0.3 ? this.inks[colorIndex] : this.cream);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, time: number, frontSpeed: number, viewer: Vector3) {
    const r = this.route, front = r.front;
    if (front > 0 && frontSpeed > 0) {
      const sh = r.at(front);
      sh.pos(Math.min(sh.length, Math.max(0, front - sh.s0)), 0, 0, _p);
      if (sh.def.kind !== 'void' && _p.distanceToSquared(viewer) < 70 * 70) {
        this.acc += dt * 34 * this.density;
        while (this.acc > 1) {
          this.acc -= 1;
          const i = this.next; this.next = (this.next + 1) % N;
          const u = Math.min(sh.length, Math.max(0, front - sh.s0 + Math.random() * 1.6 - 0.4));
          const a = (Math.random() * 2 - 1) * sh.halfWidth(u);
          if (sh.sd(u, a) <= 0) continue;
          sh.pos(u, a, -0.05, _p, _n);
          _p.toArray(this.pos, i * 3);
          this.vel[i * 3] = -_n.x * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.5;
          this.vel[i * 3 + 1] = -_n.y * (1 + Math.random() * 2.5) + Math.random() * 1.2;
          this.vel[i * 3 + 2] = -_n.z * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.5;
          this.life[i] = 1; this.spin[i * 2] = Math.random() * 6; this.spin[i * 2 + 1] = 3 + Math.random() * 6;
          this.mesh.setColorAt(i, Math.random() < 0.4 ? this.inks[sh.def.color] : this.cream);
          if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt / 2.2;
      const k = Math.max(0, this.life[i]), j = i * 3;
      this.vel[j + 1] -= 3.2 * dt;                        // paper falls slowly
      this.vel[j] *= 1 - 0.8 * dt; this.vel[j + 2] *= 1 - 0.8 * dt;
      this.pos[j] += this.vel[j] * dt + Math.sin(time * 3 + i) * 0.4 * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const ang = this.spin[i * 2] + time * this.spin[i * 2 + 1];
      _q.setFromAxisAngle(_e.set(Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 2.3)).normalize(), ang);
      const sc = Math.min(1, k * 3) * (0.7 + (i % 5) * 0.2);
      _m.compose(_p.fromArray(this.pos, j), _q, _s.setScalar(sc));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
