/**
 * micro:bit serial protocol (see firmware/inside_the_straw.py and README).
 *
 * One JSON object per line, 115200 baud, about 50 lines per second:
 *
 *   {"s":1042,"x":-48,"y":112,"z":-1008,"a":0,"b":0}\n
 *
 *   s      sequence number, increments by 1 per message, wraps at 65536
 *   x,y,z  accelerometer in milli-g (micro:bit axes)
 *   a,b    button A / B state, 1 while held
 *
 * The parser tolerates messages split across chunks, garbage, the
 * MicroPython banner, over-long lines and dropped or repeated messages.
 */
export interface MicrobitSample { seq: number; x: number; y: number; z: number; a: boolean; b: boolean }

const MAX_LINE = 160;
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export class LineProtocol {
  private buf = '';
  private lastSeq = -1;
  /** Counters for the calibration screen and tests. */
  stats = { ok: 0, malformed: 0, dropped: 0, duplicate: 0 };

  reset() { this.buf = ''; this.lastSeq = -1; this.stats = { ok: 0, malformed: 0, dropped: 0, duplicate: 0 }; }

  feed(chunk: string): MicrobitSample[] {
    const out: MicrobitSample[] = [];
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      const s = this.parse(line);
      if (s) out.push(s);
    }
    // a line that never ends is noise: drop it rather than grow without bound
    if (this.buf.length > MAX_LINE) { this.buf = ''; this.stats.malformed++; }
    return out;
  }

  private parse(line: string): MicrobitSample | null {
    if (line.length > MAX_LINE || line[0] !== '{' || line[line.length - 1] !== '}') { this.stats.malformed++; return null; }
    let o: Record<string, unknown>;
    try { o = JSON.parse(line); } catch { this.stats.malformed++; return null; }
    if (!o || !inRange(o.s, 0, 65535) || !inRange(o.x, -8200, 8200) || !inRange(o.y, -8200, 8200) || !inRange(o.z, -8200, 8200)) { this.stats.malformed++; return null; }
    const seq = Math.floor(o.s);
    if (this.lastSeq >= 0) {
      const gap = (seq - this.lastSeq + 65536) % 65536;
      if (gap === 0) { this.stats.duplicate++; return null; }
      // a small forward gap is lost messages; a huge one is a reset of the micro:bit
      if (gap > 1 && gap < 30000) this.stats.dropped += gap - 1;
    }
    this.lastSeq = seq; this.stats.ok++;
    return { seq, x: o.x as number, y: o.y as number, z: o.z as number, a: o.a === 1 || o.a === true, b: o.b === 1 || o.b === true };
  }
}
