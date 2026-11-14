/**
 * Traveller movement. Pure logic, no rendering: it is stepped at a fixed
 * rate, which keeps it frame-rate independent and lets the test suite run
 * the whole course headlessly.
 *
 * The traveller lives in surface coordinates (sheet, u, a, h). While
 * grounded it is attached to the paper, so walls and ceilings need no
 * special handling and world gravity never applies inside a straw. A jump
 * lifts h along the local surface normal and falls back along it.
 *
 * On a slide the rules change: speed comes from the slope and builds
 * gradually, braking only takes some of it off, and steering stays live.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import { approach, clamp } from '../core/math';
import type { Route } from '../world/route';
import type { Sheet } from '../world/sheet';

export interface Controls { forward: number; brake: number; lateral: number; jump: boolean }
export type Mode = 'ground' | 'air' | 'fall' | 'done';
export type PlayerEvent = 'jump' | 'land' | 'bump' | 'fall';
/**
 * Why the traveller lost its footing, detected from the surface state at that moment:
 *   collapse  the pursuing unravelling reached this spot
 *   peel      an authored strip peeled away here
 *   tear      walked into a static tear in the wall
 *   edge      went over the side of a strip, slide or straw
 *   gap       ran off an end without jumping
 *   short     jumped, and came down before the landing
 *   wide      jumped, and came down beside the landing
 *   step      ran or jumped into the face of a higher segment
 */
export type FallCause = 'collapse' | 'peel' | 'tear' | 'edge' | 'gap' | 'short' | 'wide' | 'step';

// Acceleration figures scale with the same `pace` knob as top speed, so the traveller
// still reaches top speed in the same amount of time at any pace - just a faster one.
const PACE = CONFIG.difficulty.pace;
const ACCEL = CONFIG.difficulty.accel * PACE, DECEL = CONFIG.difficulty.decel * PACE, BRAKE = CONFIG.difficulty.brake * PACE;
const LAT_ACCEL = CONFIG.difficulty.lateralAccel * PACE, AIR_LAT_ACCEL = CONFIG.difficulty.airLateralAccel * PACE;
// Top running and lateral speeds, paced. Jump and slide speeds are read straight off
// CONFIG.difficulty below and are intentionally left out of this scaling (see config.ts).
const MAX_SPEED = CONFIG.difficulty.maxSpeed * PACE, LATERAL_SPEED = CONFIG.difficulty.lateralSpeed * PACE;
const COYOTE = 0.11, JUMP_BUFFER = 0.14, BODY = 0.24;
const _n = new Vector3(), _p2 = new Vector3();

export class PlayerController {
  sheet!: Sheet;
  u = 0; a = 0; h = 0;
  vu = 0; va = 0; vh = 0;
  mode: Mode = 'ground';
  /** Feedback flags for animation and sound. */
  sliding = false; braking = false;
  /** Seconds since the last landing / since the fall began. */
  landT = 1; fallT = 0;
  events: PlayerEvent[] = [];
  fallCause: FallCause | null = null;
  /** World-space state used only while falling away after a failure. */
  readonly fallPos = new Vector3(); readonly fallVel = new Vector3(); readonly fallG = new Vector3();
  private coyote = 0; private jumpBuf = 0; private bumpCool = 0;

  constructor(private route: Route) { this.sheet = route.sheets[0]; }

  get s() { return this.sheet.s0 + this.u; }

  place(s: number, a = 0) {
    this.sheet = this.route.at(s); this.u = s - this.sheet.s0; this.a = a; this.h = 0;
    this.vu = this.va = this.vh = 0; this.mode = 'ground'; this.sliding = this.braking = false;
    this.coyote = this.jumpBuf = 0; this.landT = 1; this.fallT = 0; this.events.length = 0; this.fallCause = null;
  }

  step(dt: number, c: Controls, finishS: number) {
    const D = CONFIG.difficulty, route = this.route;
    this.landT += dt; this.bumpCool -= dt;
    if (this.mode === 'fall') {
      this.fallT += dt;
      this.fallVel.addScaledVector(this.fallG, dt);
      this.fallPos.addScaledVector(this.fallVel, dt);
      return;
    }
    if (this.mode === 'done') { c = { forward: 0, brake: 1, lateral: 0, jump: false }; }
    const grounded = this.mode !== 'air';
    const onSlide = !!this.sheet.def.slide;
    this.sliding = onSlide && grounded;
    this.braking = !onSlide && grounded && c.brake > 0 && this.vu > 0.8;

    if (onSlide) {
      // the slope sets the pace; it builds and eases gradually, and the brake takes part of it off
      if (grounded) {
        const want = clamp(D.slideBaseSpeed + D.slideSlopeGain * this.sheet.descent(this.u), D.slideBaseSpeed * 0.8, D.slideMaxSpeed) * (1 - D.slideBrake * c.brake);
        this.vu = approach(this.vu, want, (this.vu < want ? 2.6 : 4.0) * dt);
      }
    } else if (c.brake > 0) this.vu = Math.max(0, this.vu - BRAKE * c.brake * dt);
    else if (c.forward > 0) {
      const target = MAX_SPEED * c.forward;
      this.vu = this.vu < target ? Math.min(target, this.vu + ACCEL * dt) : Math.max(target, this.vu - DECEL * 1.4 * dt);
    } else this.vu = Math.max(0, this.vu - DECEL * dt);
    this.va = approach(this.va, LATERAL_SPEED * (onSlide ? 0.85 : 1) * c.lateral, (grounded ? LAT_ACCEL : AIR_LAT_ACCEL) * dt);

    // advance, stopping at crushed wall that is too steep to climb (unless already on it)
    let nu = this.u + this.vu * dt, na = this.sheet.wrapA(this.a + this.va * dt);
    if (this.sheet.def.crushes && !route.blocked(this.sheet, this.u + BODY, this.a, this.h)) {
      if (route.blocked(this.sheet, nu + BODY, this.a, this.h)) {
        nu = this.u;
        if (this.vu > 1.2 && this.bumpCool <= 0) { this.events.push('bump'); this.bumpCool = 0.4; }
        this.vu = 0;
      }
      if (route.blocked(this.sheet, nu + BODY, na, this.h)) { na = this.a; this.va = 0; }
    }
    this.u = nu; this.a = na;
    while (this.u >= this.sheet.length && this.sheet.index < route.sheets.length - 1) {
      const prev = this.sheet, next = route.sheets[prev.index + 1], an = route.mapA(this.a, prev, next);
      // keep the same point in space across the join: steps between segments, lifted tabs
      this.h += prev.reliefAt(prev.length, this.a) - next.reliefAt(0, an) - (next.def.rise ?? 0);
      this.u -= prev.length; this.sheet = next; this.a = an;
      if (this.h < -0.38) return this.beginFall('step');   // ran or fell into the face of a step
      if (this.h < 0.03) { if (this.mode !== 'air') this.h = 0; else { this.h = Math.max(this.h, 0.001); } }
      else if (this.mode === 'ground') { this.mode = 'air'; this.vh = 0; }   // walked off a raised edge
    }
    if (this.u > this.sheet.length) { this.u = this.sheet.length; this.vu = 0; }

    if (c.jump) this.jumpBuf = JUMP_BUFFER; else this.jumpBuf -= dt;
    const supported = route.solid(this.sheet, this.u, this.a);

    if (this.mode === 'ground' || this.mode === 'done') {
      if (supported) this.coyote = 0;
      else { this.coyote += dt; if (this.coyote > COYOTE) return this.beginFall(); }
      if (this.mode === 'ground') {
        if (this.jumpBuf > 0) {
          this.mode = 'air'; this.vh = D.jumpSpeed; this.h = 0.001; this.jumpBuf = 0; this.coyote = 0;
          // A jump is a leap: leaning forward always carries you a useful distance, even from a standstill.
          if (c.forward > 0.3 && c.brake === 0) this.vu = Math.max(this.vu, MAX_SPEED * 0.8);
          this.events.push('jump');
        } else if (this.s >= finishS) this.mode = 'done';
      }
    } else if (this.mode === 'air') {
      this.vh -= D.gravity * dt;
      this.h += this.vh * dt;
      if (this.h <= 0 && this.vh < 0) {
        if (supported || this.ledgeAssist()) {
          this.h = 0; this.vh = 0; this.mode = 'ground'; this.landT = 0; this.coyote = 0;
          this.events.push('land');
        } else if (this.h < -0.12) this.beginFall();
      }
    }
  }

  /** Forgiving landings: if the toes just miss an edge, step onto it. */
  private ledgeAssist(): boolean {
    const r = this.route, reach = 0.5 + this.vu * 0.03;
    for (let d = 0.12; d <= reach; d += 0.12) {
      const s = this.s + d, sh = r.at(s);
      if (sh !== this.sheet && Math.abs(sh.def.rise ?? 0) > 0.38) continue;
      if (r.solidS(s, this.a, this.sheet)) { this.a = r.mapA(this.a, this.sheet, sh); this.sheet = sh; this.u = s - sh.s0; return true; }
    }
    for (const da of [0.25, -0.25]) if (r.solid(this.sheet, this.u, this.sheet.wrapA(this.a + da))) { this.a = this.sheet.wrapA(this.a + da); return true; }
    return false;
  }

  private beginFall(known?: FallCause) {
    const sh = this.sheet, r = this.route, air = this.mode === 'air';
    const sd = sh.sd(this.u, this.a);
    this.fallCause = known ?? (sd > 0 && r.collapsed(sh, this.u, this.a) ? 'collapse'
      : sd > 0 && r.peeledAt(sh, this.u, this.a) ? 'peel'
      : sh.def.kind === 'void' ? (air ? 'short' : 'gap')
      : air ? 'wide'
      : !sh.wrap && Math.abs(this.a) > sh.halfWidth(this.u) - 0.25 ? 'edge' : 'tear');
    sh.pos(this.u, this.a, Math.max(this.h, 0), this.fallPos, _n);
    sh.pos(this.u + 0.1, this.a, Math.max(this.h, 0), _p2);
    _p2.sub(this.fallPos).normalize();
    // The traveller's "down" is always the paper it stood on, so it drops away through the opening.
    this.fallVel.copy(_p2).multiplyScalar(this.vu * 0.8).addScaledVector(_n, Math.min(this.vh, 0) - 1.5);
    this.fallG.copy(_n).multiplyScalar(-CONFIG.difficulty.gravity);
    this.mode = 'fall'; this.fallT = 0; this.sliding = this.braking = false; this.events.push('fall');
  }
}
