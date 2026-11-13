/**
 * The unravelling front: a single number of route progress that creeps
 * forward. It has no timer on the player; standing still is fine until the
 * paper under you is reached.
 */
import { CONFIG } from '../config';
import type { Route } from '../world/route';
import { SAFE_FROM } from '../world/level';

export class CollapseFront {
  active = false;
  speed = 0;
  private grace = 0;
  private readonly limit: number;

  constructor(private route: Route) {
    this.limit = route.markS(SAFE_FROM);
    route.front = -1e6;
  }

  reset() { this.active = false; this.route.front = -1e6; this.speed = 0; }

  activate(frontS: number) { this.active = true; this.route.front = Math.min(frontS, this.limit); this.grace = 0; }

  /** After a failure: put the front a safe distance behind the checkpoint and hold it briefly. */
  respawn(checkpointS: number) {
    if (!this.active) return;
    this.route.front = Math.min(checkpointS - CONFIG.collapse.respawnHeadStart, this.limit);
    this.grace = CONFIG.collapse.respawnGrace;
  }

  /** Distance from the front to the player, in metres of route. */
  distance(playerS: number) { return this.active ? playerS - this.route.front : Infinity; }

  update(dt: number, playerS: number) {
    if (!this.active) return;
    if (this.grace > 0) { this.grace -= dt; this.speed = 0; return; }
    const C = CONFIG.collapse, dist = playerS - this.route.front;
    let v: number = C.speed;
    // bounded catch-up: a smooth, capped increase in speed. The front is never moved forward by any other means.
    if (dist > C.catchUpDistance) v += C.catchUpBoost * Math.min(1, (dist - C.catchUpDistance) / 12);
    else if (dist < C.mercyDistance) v *= C.mercyFactor;
    this.speed = v;
    this.route.front = Math.min(this.limit, this.route.front + v * dt);
  }
}
