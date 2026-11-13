/**
 * One input abstraction: keyboard and micro:bit both produce the same
 * Controls. The keyboard always works, so the whole game is playable with
 * no hardware, and it stays live as a fallback while a micro:bit is in use.
 */
import type { Controls } from '../player/controller';
import { MicrobitInput } from './microbit';

export type Device = 'keyboard' | 'microbit';

export class InputManager {
  readonly microbit = new MicrobitInput();
  device: Device = 'keyboard';
  onPause: () => void = () => {};
  private keys = new Set<string>();
  private jumpEdge = false;
  private readonly controls: Controls = { forward: 0, brake: 0, lateral: 0, jump: false };

  private readonly down = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { if (!e.repeat) this.onPause(); return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement)) e.preventDefault();
    if (e.code === 'Space' && !e.repeat) this.jumpEdge = true;   // key repeat never re-triggers a jump
    this.keys.add(e.code);
  };
  private readonly up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private readonly blur = () => { this.keys.clear(); };

  constructor() {
    window.addEventListener('keydown', this.down); window.addEventListener('keyup', this.up); window.addEventListener('blur', this.blur);
  }

  private key(...codes: string[]) { for (const c of codes) if (this.keys.has(c)) return true; return false; }

  /** Read the controls for one simulation step. The jump flag is an edge and is consumed by reading. */
  read(): Controls {
    const c = this.controls;
    c.forward = this.key('KeyW', 'ArrowUp') ? 1 : 0;
    c.brake = this.key('KeyS', 'ArrowDown') ? 1 : 0;
    c.lateral = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    c.jump = this.jumpEdge; this.jumpEdge = false;
    if (this.device === 'microbit') {
      const mb = this.microbit, f = mb.forwardAxis;
      if (f > c.forward) c.forward = f;
      if (-f > c.brake) c.brake = -f;
      if (Math.abs(mb.sideAxis) > Math.abs(c.lateral)) c.lateral = mb.sideAxis;
      if (mb.consumeJump()) c.jump = true;
    }
    if (c.brake > 0) c.forward = 0;
    return c;
  }

  clear() { this.keys.clear(); this.jumpEdge = false; this.microbit.consumeJump(); }

  dispose() {
    window.removeEventListener('keydown', this.down); window.removeEventListener('keyup', this.up); window.removeEventListener('blur', this.blur);
    this.microbit.dispose();
  }
}
