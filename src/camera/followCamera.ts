/**
 * Third-person follow camera.
 *
 * Strategy for 360-degree movement: the camera never uses world-up. Its
 * "up" is the surface normal under the traveller, and its position is a
 * point a little behind and above the traveller *in surface coordinates*.
 * Everything is derived from continuous vectors and blended as positions
 * and quaternions, so there is no angle to wrap and nothing to flip when
 * the traveller crosses the ceiling: the world turns smoothly around a
 * traveller who always appears to stand on the "floor" of the screen.
 */
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { damp, lerp } from '../core/math';
import type { PlayerController } from '../player/controller';
import type { Route } from '../world/route';
import { Frame } from '../world/sheet';
import { REVEALS } from '../world/level';

const _eye = new Vector3(), _look = new Vector3(), _up = new Vector3(), _n = new Vector3(), _axis = new Vector3(), _d = new Vector3();
const _m = new Matrix4(), _q = new Quaternion(), _f = new Frame();

export class FollowCamera {
  readonly camera = new PerspectiveCamera(62, 1, 0.08, 1400);
  private open = 0; private slide = 0; private first = true;
  private lookS = new Vector3();
  /** Current reveal offsets (back, up, side) and the route ranges that ask for them. */
  private rv = new Vector3(); private rvW = 0;
  private reveals: { s0: number; s1: number; back: number; up: number; side: number }[];

  constructor(private route: Route) {
    this.reveals = REVEALS.map((r) => ({ s0: route.markS(r.from), s1: route.markS(r.to), back: r.back, up: r.up, side: r.side }));
  }

  snap() { this.first = true; }

  update(dt: number, pc: PlayerController) {
    const r = this.route, cam = this.camera;
    if (pc.mode === 'fall') {
      // stay put and watch the traveller drift away; no chase, no shake
      _m.lookAt(cam.position, pc.fallPos, _up.set(0, 1, 0).applyQuaternion(cam.quaternion));
      cam.quaternion.slerp(_q.setFromRotationMatrix(_m), 1 - Math.exp(-3 * dt));
      return;
    }
    const sh = pc.sheet, s = pc.s;
    this.open = damp(this.open, sh.def.open ? 1 : 0, 1.6, dt);
    // on a slide the view widens a little and reaches further ahead, toward the bends and the landing
    this.slide = damp(this.slide, pc.sliding || (sh.def.slide && pc.mode === 'air') ? 1 : 0, 2.2, dt);
    const o = this.open, sl = this.slide, done = pc.mode === 'done' ? 1 : 0;
    // Reveal: at authored transitions ease back, up and a little to one side, so the whole material
    // experiment is in view; ease home afterwards. Offsets only ever blend, so nothing cuts or flips,
    // and the camera's "up" stays the surface under the traveller, so steering keeps its meaning.
    let tb = 0, tu = 0, ts = 0, on = 0;
    for (const rz of this.reveals) if (s >= rz.s0 && s < rz.s1) { tb = rz.back; tu = rz.up; ts = rz.side; on = 1; }
    const rate = this.first ? 1e3 : on ? 1.5 : 1.1;
    this.rv.x = damp(this.rv.x, tb, rate, dt); this.rv.y = damp(this.rv.y, tu, rate, dt); this.rv.z = damp(this.rv.z, ts, rate, dt);
    this.rvW = damp(this.rvW, on, rate, dt);
    const back = lerp(4.6, 6.2, o) + done * 1.0 + sl * 0.9 + this.rv.x, height = lerp(1.8, 2.7, o) + pc.h * 0.35 + sl * 0.5 + this.rv.y, ahead = lerp(6.5, 8, o) + sl * 6;

    r.pos(s - back, pc.a, 0, _eye, _n, sh);
    const camSheet = r.at(s - back), cu = Math.max(0, s - back - camSheet.s0), k = camSheet.curvature(cu);
    // inside a closed (or nearly closed) shell, never lift the camera past the middle of it
    const enclosed = k > 0.25 && (camSheet.wrap || camSheet.halfWidth(cu) * k > 2.0);
    _eye.addScaledVector(_n, enclosed ? Math.min(height, (1 / k) * 0.92) : height);
    // three-quarter shift along the surface's own sideways direction
    if (Math.abs(this.rv.z) > 0.01 && !enclosed) { sh.pos(pc.u, pc.a, 0, _d); sh.pos(pc.u, sh.wrapA(pc.a + 0.3), 0, _axis); _eye.addScaledVector(_axis.sub(_d).normalize(), this.rv.z); }
    r.pos(Math.min(s + ahead, r.total - 0.01), pc.a * (1 - 0.5 * sl), 0.55, _look, undefined, sh);
    // during a reveal keep the traveller nearer the middle of the frame
    sh.pos(pc.u, pc.a, 0.5, _d, _up);
    _look.lerp(_d, 0.4 * this.rvW);

    const kp = this.first ? 1 : 1 - Math.exp(-9 * dt);
    cam.position.lerp(_eye, kp);
    this.lookS.lerp(_look, this.first ? 1 : 1 - Math.exp(-7 * dt));

    // collision: keep the eye inside the straw wall
    if (k > 0.25 && camSheet.wrap) {
      camSheet.frame(Math.max(0, s - back - camSheet.s0), _f);
      const R = 1 / k;
      _axis.copy(_f.p).addScaledVector(_f.n, R);
      _d.subVectors(cam.position, _axis);
      const along = _d.dot(_f.t); _d.addScaledVector(_f.t, -along);
      const rad = _d.length(), lim = R - 0.4;
      if (rad > lim) cam.position.addScaledVector(_d, (lim - rad) / rad * (1 - o));
    }
    _m.lookAt(cam.position, this.lookS, _up);
    _q.setFromRotationMatrix(_m);
    if (this.first) cam.quaternion.copy(_q); else cam.quaternion.slerp(_q, 1 - Math.exp(-8 * dt));
    const fov = lerp(62, 66, o) + sl * 4;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.first = false;
  }

  /** Slow drift around the open-air stretch for the title screen. */
  titleShot(time: number) {
    const r = this.route, s1 = r.sheet('SL1'), cam = this.camera;
    s1.pos(18, 0, 0, _look);
    const a = 0.9 + Math.sin(time * 0.07) * 0.35;
    cam.position.set(_look.x + Math.cos(a) * 30, _look.y + 7 + Math.sin(time * 0.11) * 1.5, _look.z + Math.sin(a) * 30 - 12);
    cam.lookAt(_look.x, _look.y - 1, _look.z + 4);
    if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
    this.first = true;
  }

  resize(w: number, h: number) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
