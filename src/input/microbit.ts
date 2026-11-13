/**
 * micro:bit v2 over USB serial (Web Serial API).
 *
 * Hold the micro:bit flat, LEDs up, USB cable pointing away from you.
 *   tilt forward (far edge down)  -> run          (micro:bit y axis goes negative)
 *   tilt back                     -> brake
 *   tilt left / right             -> walk around the wall (x axis)
 *   button A                      -> jump
 */
import { CONFIG } from '../config';
import { clamp } from '../core/math';
import { LineProtocol, type MicrobitSample } from './protocol';

export type MicrobitStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'no-data';
export interface TiltSettings { sensitivity: number; deadZone: number; invertForward: boolean; invertSide: boolean; neutralPitch: number; neutralRoll: number }

const STALE_MS = 400;
const RAD = 180 / Math.PI;
const KEY = 'inside-the-straw.microbit';

export function loadTiltSettings(): TiltSettings {
  const d: TiltSettings = { sensitivity: 1, deadZone: CONFIG.microbit.deadZoneDegrees, invertForward: false, invertSide: false, neutralPitch: 0, neutralRoll: 0 };
  try { Object.assign(d, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* storage unavailable: defaults */ }
  return d;
}

export class MicrobitInput {
  status: MicrobitStatus = 'serial' in navigator ? 'disconnected' : 'unsupported';
  settings = loadTiltSettings();
  readonly protocol = new LineProtocol();
  /** Smoothed tilt in degrees, before calibration (for the test screen). */
  pitch = 0; roll = 0;
  buttonA = false; buttonB = false;
  onStatus: (s: MicrobitStatus) => void = () => {};
  onLost: () => void = () => {};
  private jumpEdge = false; private lastA = false; private lastSampleAt = -1e9; private gotSample = false;
  private port: SerialPort | null = null; private reader: ReadableStreamDefaultReader<string> | null = null; private closing = false;
  private readonly onSerialDisconnect = (e: Event) => { if (this.port && e.target === this.port) void this.lost(); };

  constructor() {
    if ('serial' in navigator) navigator.serial.addEventListener('disconnect', this.onSerialDisconnect);
  }

  get supported() { return this.status !== 'unsupported'; }
  get connected() { return this.status === 'connected' || this.status === 'no-data'; }

  saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ } }

  /** Must be called from a click or key press: browsers only show the port picker after a user action. */
  async connect(): Promise<boolean> {
    if (!this.supported) return false;
    if (this.connected) return true;
    this.setStatus('connecting');
    try {
      // 0x0D28 is the micro:bit's USB interface chip (DAPLink)
      const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x0d28 }] });
      await port.open({ baudRate: 115200 });
      this.port = port; this.closing = false; this.protocol.reset(); this.gotSample = false; this.lastSampleAt = performance.now();
      this.setStatus('no-data');
      void this.readLoop(port);
      return true;
    } catch {
      this.port = null; this.setStatus('disconnected');
      return false;
    }
  }

  private async readLoop(port: SerialPort) {
    const decoder = new TextDecoderStream();
    const piped = port.readable!.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {});
    const reader = (this.reader = decoder.readable.getReader());
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.receive(value);
      }
    } catch { /* cable pulled */ } finally {
      reader.releaseLock(); await piped;
      if (!this.closing) void this.lost();
    }
  }

  /** Feed raw serial text. Public so tests (and the browser test hook) can simulate a device. */
  receive(text: string, now = performance.now()) {
    for (const s of this.protocol.feed(text)) this.sample(s, now);
  }

  private sample(s: MicrobitSample, now: number) {
    const pitch = Math.atan2(-s.y, -s.z) * RAD, roll = Math.atan2(s.x, -s.z) * RAD;
    const k = this.gotSample ? 1 - CONFIG.microbit.smoothing : 1;
    this.pitch += (pitch - this.pitch) * k; this.roll += (roll - this.roll) * k;
    // one jump per press: only the 0 -> 1 edge counts, however long the button is held
    if (s.a && !this.lastA) this.jumpEdge = true;
    this.lastA = s.a; this.buttonA = s.a; this.buttonB = s.b;
    this.lastSampleAt = now; this.gotSample = true;
    if (this.status === 'no-data') this.setStatus('connected');
  }

  /** Call every frame: detects stale data. */
  poll(now = performance.now()) {
    if (this.status === 'connected' && now - this.lastSampleAt > STALE_MS) { this.setStatus('no-data'); this.buttonA = false; }
  }

  get fresh() { return this.status === 'connected'; }

  private shape(deg: number): number {
    const st = this.settings, full = CONFIG.microbit.fullTiltDegrees, m = Math.abs(deg);
    if (m <= st.deadZone) return 0;
    return Math.sign(deg) * clamp(((m - st.deadZone) / Math.max(1, full - st.deadZone)) * st.sensitivity, 0, 1);
  }

  /** Forward (+) / brake (-) in -1..1 after calibration, dead zone and sensitivity. Zero if data is stale. */
  get forwardAxis() { return this.fresh ? this.shape((this.pitch - this.settings.neutralPitch) * (this.settings.invertForward ? -1 : 1)) : 0; }
  get sideAxis() { return this.fresh ? this.shape((this.roll - this.settings.neutralRoll) * (this.settings.invertSide ? -1 : 1)) : 0; }

  consumeJump(): boolean { const j = this.jumpEdge; this.jumpEdge = false; return j; }

  /** Take the way the micro:bit is being held right now as "neutral". */
  calibrate() { this.settings.neutralPitch = this.pitch; this.settings.neutralRoll = this.roll; this.saveSettings(); }

  async disconnect() {
    this.closing = true;
    try { await this.reader?.cancel(); } catch { /* already closed */ }
    try { await this.port?.close(); } catch { /* already closed */ }
    this.port = null; this.reader = null; this.setStatus(this.supported ? 'disconnected' : 'unsupported');
  }

  /** Simulate the cable being pulled (tests). */
  async simulateLoss() { await this.lost(); }

  private async lost() {
    if (this.status === 'disconnected' || this.status === 'unsupported') return;
    this.closing = true;
    try { await this.port?.close(); } catch { /* gone */ }
    this.port = null; this.reader = null; this.jumpEdge = false; this.lastA = false;
    this.setStatus('disconnected');
    this.onLost();
  }

  /** Test hook: pretend a device is attached without a real port. */
  simulateAttach() { this.protocol.reset(); this.gotSample = false; this.lastSampleAt = performance.now(); this.status = 'no-data'; this.onStatus(this.status); }

  private setStatus(s: MicrobitStatus) { if (s !== this.status) { this.status = s; this.onStatus(s); } }

  dispose() { if ('serial' in navigator) navigator.serial.removeEventListener('disconnect', this.onSerialDisconnect); void this.disconnect(); }
}
