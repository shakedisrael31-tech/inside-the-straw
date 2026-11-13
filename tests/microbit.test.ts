// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LineProtocol } from '../src/input/protocol';

const msg = (s: number, x = 0, y = 0, z = -1024, a = 0, b = 0) => `{"s":${s},"x":${x},"y":${y},"z":${z},"a":${a},"b":${b}}\n`;

describe('serial protocol parser', () => {
  it('parses whole lines', () => {
    const p = new LineProtocol();
    const out = p.feed(msg(1, -48, 112, -1008, 1, 0));
    expect(out).toEqual([{ seq: 1, x: -48, y: 112, z: -1008, a: true, b: false }]);
  });
  it('reassembles messages split across chunks, byte by byte', () => {
    const p = new LineProtocol(), text = msg(1) + msg(2) + msg(3);
    let n = 0;
    for (const ch of text) n += p.feed(ch).length;
    expect(n).toBe(3);
    expect(p.stats.malformed).toBe(0);
  });
  it('handles CRLF line endings from MicroPython', () => {
    const p = new LineProtocol();
    expect(p.feed(msg(1).replace('\n', '\r\n') + msg(2).replace('\n', '\r\n')).length).toBe(2);
  });
  it('ignores malformed input and keeps going', () => {
    const p = new LineProtocol();
    const out = p.feed('MicroPython v2.1.2 on 2024-01-01; micro:bit v2\n>>> \n{"s":1,"x":"oops"}\n{broken json\n{"s":2,"x":1e99,"y":0,"z":0}\n' + msg(5));
    expect(out.length).toBe(1);
    expect(out[0].seq).toBe(5);
    expect(p.stats.malformed).toBe(5);
  });
  it('drops an endless line instead of growing a buffer', () => {
    const p = new LineProtocol();
    for (let i = 0; i < 100; i++) p.feed('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(p.feed('\n' + msg(1)).length).toBe(1);
  });
  it('counts dropped and duplicate messages and survives sequence wrap', () => {
    const p = new LineProtocol();
    p.feed(msg(65534) + msg(65535) + msg(0) + msg(1));
    expect(p.stats.dropped).toBe(0);
    p.feed(msg(4));                // 2 and 3 lost
    expect(p.stats.dropped).toBe(2);
    expect(p.feed(msg(4)).length).toBe(0);
    expect(p.stats.duplicate).toBe(1);
  });
});

describe('micro:bit input behaviour (simulated serial data)', () => {
  let MicrobitInput: typeof import('../src/input/microbit').MicrobitInput;
  beforeEach(async () => {
    vi.stubGlobal('navigator', { serial: { addEventListener() {}, removeEventListener() {} } });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
    ({ MicrobitInput } = await import('../src/input/microbit'));
  });
  const tilt = (pitchDeg: number, rollDeg: number) => {
    const p = (pitchDeg * Math.PI) / 180, r = (rollDeg * Math.PI) / 180;
    return [Math.round(1024 * Math.sin(r)), Math.round(-1024 * Math.sin(p)), Math.round(-1024 * Math.cos(p) * Math.cos(r))] as const;
  };
  const stream = (mb: InstanceType<typeof MicrobitInput>, from: number, n: number, pitch: number, roll: number, a = 0, t0 = 0) => {
    const [x, y, z] = tilt(pitch, roll);
    for (let i = 0; i < n; i++) mb.receive(msg(from + i, x, y, z, a), t0 + i * 20);
  };

  it('maps tilt to forward / brake / sideways with a dead zone', () => {
    const mb = new MicrobitInput(); mb.simulateAttach();
    stream(mb, 0, 30, 0, 0);
    expect(mb.status).toBe('connected');
    expect(mb.forwardAxis).toBe(0); expect(mb.sideAxis).toBe(0);
    stream(mb, 30, 30, 2, -2);                 // inside the dead zone
    expect(mb.forwardAxis).toBe(0); expect(mb.sideAxis).toBe(0);
    stream(mb, 60, 40, 30, 0);                 // tilt forward
    expect(mb.forwardAxis).toBeCloseTo(1, 2);
    stream(mb, 100, 40, -30, 0);               // tilt back = brake
    expect(mb.forwardAxis).toBeCloseTo(-1, 2);
    stream(mb, 140, 40, 0, 16);                // gentle right
    expect(mb.sideAxis).toBeGreaterThan(0.3); expect(mb.sideAxis).toBeLessThan(0.7);
    stream(mb, 180, 40, 0, -30);
    expect(mb.sideAxis).toBeCloseTo(-1, 2);
  });
  it('calibration makes the current pose neutral', () => {
    const mb = new MicrobitInput(); mb.simulateAttach();
    stream(mb, 0, 40, 12, -9);
    expect(mb.forwardAxis).toBeGreaterThan(0);
    mb.calibrate();
    expect(mb.forwardAxis).toBe(0); expect(mb.sideAxis).toBe(0);
    stream(mb, 40, 40, 12 + 28, -9);
    expect(mb.forwardAxis).toBeCloseTo(1, 1);
  });
  it('jumps once per press of button A, not once per message', () => {
    const mb = new MicrobitInput(); mb.simulateAttach();
    stream(mb, 0, 5, 0, 0, 0);
    expect(mb.consumeJump()).toBe(false);
    stream(mb, 5, 50, 0, 0, 1);                // held for a full second
    expect(mb.consumeJump()).toBe(true);
    expect(mb.consumeJump()).toBe(false);
    stream(mb, 55, 50, 0, 0, 1);               // still held
    expect(mb.consumeJump()).toBe(false);
    stream(mb, 105, 3, 0, 0, 0); stream(mb, 108, 3, 0, 0, 1);
    expect(mb.consumeJump()).toBe(true);
  });
  it('treats stale data as neutral', () => {
    const mb = new MicrobitInput(); mb.simulateAttach();
    stream(mb, 0, 40, 30, 20, 0, 1000);
    expect(mb.forwardAxis).toBeGreaterThan(0.9);
    mb.poll(1000 + 40 * 20 + 100);
    expect(mb.status).toBe('connected');
    mb.poll(1000 + 40 * 20 + 600);
    expect(mb.status).toBe('no-data');
    expect(mb.forwardAxis).toBe(0); expect(mb.sideAxis).toBe(0);
    stream(mb, 40, 2, 30, 0, 0, 3000);
    expect(mb.status).toBe('connected');
  });
  it('reports a lost connection exactly once', async () => {
    const mb = new MicrobitInput(); mb.simulateAttach();
    let lost = 0; mb.onLost = () => lost++;
    stream(mb, 0, 10, 20, 0);
    await mb.simulateLoss(); await mb.simulateLoss();
    expect(lost).toBe(1);
    expect(mb.status).toBe('disconnected');
    expect(mb.forwardAxis).toBe(0);
  });
});
