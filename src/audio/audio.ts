/**
 * All sound is synthesised with the Web Audio API: there are no audio
 * files to license or load.
 *
 * Music: an original 16-bar loop in D major at 92 bpm - soft marimba
 * arpeggios, a plucked bass, a sparse bell melody and a paper-light shaker.
 * A muted pulse joins in as the unravelling gets close.
 */
type Ctx = AudioContext;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

const BPM = 92, STEP = 60 / BPM / 4, BARS = 16, STEPS = BARS * 16;
// two bars per chord: D, Bm, G, A, D, F#m, G, A   (root, then chord tones for the arpeggio)
const CHORDS: { root: number; tones: number[] }[] = [
  { root: 38, tones: [62, 66, 69, 76] }, { root: 35, tones: [59, 62, 66, 74] },
  { root: 43, tones: [59, 62, 67, 74] }, { root: 45, tones: [61, 64, 69, 76] },
  { root: 38, tones: [62, 66, 69, 78] }, { root: 42, tones: [61, 66, 69, 73] },
  { root: 43, tones: [62, 67, 71, 74] }, { root: 45, tones: [64, 67, 69, 73] },
];
const ARP = [0, 2, 1, 2, 3, 2, 1, 2];
// bell melody: [bar, step-in-bar, midi note, length in steps]
const MELODY: [number, number, number, number][] = [
  [0, 0, 78, 6], [0, 8, 81, 4], [1, 0, 76, 8], [2, 4, 74, 4], [2, 10, 78, 4], [3, 0, 74, 10],
  [4, 0, 79, 6], [4, 8, 78, 4], [5, 0, 74, 8], [6, 4, 76, 4], [6, 10, 81, 4], [7, 0, 76, 10],
  [8, 0, 81, 4], [8, 6, 83, 2], [8, 8, 86, 6], [9, 2, 81, 8], [10, 4, 78, 4], [10, 10, 81, 4], [11, 0, 80, 4], [11, 6, 78, 8],
  [12, 0, 79, 6], [12, 8, 83, 4], [13, 2, 78, 8], [14, 0, 76, 4], [14, 6, 73, 4], [14, 12, 76, 4], [15, 4, 74, 10],
];

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master!: GainNode; private music!: GainNode; private sfx!: GainNode; private tensionGain!: GainNode; private cue!: GainNode;
  private noise!: AudioBuffer;
  private slideGain: GainNode | null = null; private slideFilter!: BiquadFilterNode;
  private timer: number | null = null;
  private step = 0; private nextTime = 0; private playing = false;
  private tension = 0; private tearAcc = 0; private proximity = 0;
  musicVolume = 0.6; sfxVolume = 0.8; muted = false;

  get ready() { return !!this.ctx; }

  /** Create the audio graph. Call from a click or key press: browsers block sound before a user action. */
  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext());
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.connect(comp);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.cue = ctx.createGain(); this.cue.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.tensionGain = ctx.createGain(); this.tensionGain.gain.value = 0; this.tensionGain.connect(this.music);
    const n = (this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // one continuous paper-friction voice for slides; created once, so restarts can never stack it
    const src = ctx.createBufferSource(); src.buffer = n; src.loop = true;
    this.slideFilter = ctx.createBiquadFilter(); this.slideFilter.type = 'bandpass'; this.slideFilter.frequency.value = 1400; this.slideFilter.Q.value = 0.7;
    this.slideGain = ctx.createGain(); this.slideGain.gain.value = 0;
    src.connect(this.slideFilter).connect(this.slideGain).connect(this.sfx); src.start();
    this.applyVolumes(0);
  }

  /** Paper friction while sliding. level 0 = silent; pitch and loudness follow speed (0..1). */
  setSlide(level: number) {
    if (!this.ctx || !this.slideGain) return;
    const t = this.ctx.currentTime;
    this.slideGain.gain.setTargetAtTime(level > 0 ? 0.05 + 0.13 * level : 0, t, 0.09);
    this.slideFilter.frequency.setTargetAtTime(900 + 1700 * level, t, 0.12);
  }

  applyVolumes(ramp = 0.08) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, ramp || 0.001);
    this.music.gain.setTargetAtTime(this.musicVolume * 0.5, t, ramp || 0.001);
    this.cue.gain.setTargetAtTime(this.musicVolume * 0.55, t, ramp || 0.001);
    this.sfx.gain.setTargetAtTime(this.sfxVolume * 0.7, t, ramp || 0.001);
  }

  // ── instruments ──────────────────────────────────────────────
  private tone(dest: AudioNode, t: number, f: number, type: OscillatorType, peak: number, attack: number, decay: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(dest); o.start(t); o.stop(t + attack + decay + 0.05);
    return o;
  }
  private marimba(dest: AudioNode, t: number, note: number, vel: number) {
    const f = midi(note);
    this.tone(dest, t, f, 'sine', 0.3 * vel, 0.004, 0.42);
    this.tone(dest, t, f * 4, 'sine', 0.07 * vel, 0.002, 0.09);
    this.tone(dest, t, f * 9.2, 'sine', 0.02 * vel, 0.001, 0.04);
  }
  private bell(dest: AudioNode, t: number, note: number, vel: number, len: number) {
    const f = midi(note);
    this.tone(dest, t, f, 'sine', 0.13 * vel, 0.006, 0.9 + len);
    this.tone(dest, t, f * 2.76, 'sine', 0.035 * vel, 0.004, 0.5 + len * 0.4);
    this.tone(dest, t, f * 5.4, 'sine', 0.012 * vel, 0.002, 0.2);
  }
  private pluck(dest: AudioNode, t: number, note: number, vel: number, decay = 0.5) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = midi(note);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(180, t + decay);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.34 * vel, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(lp).connect(g).connect(dest); o.start(t); o.stop(t + decay + 0.05);
  }
  private burst(dest: AudioNode, t: number, peak: number, dur: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1) {
    const ctx = this.ctx!, s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    s.buffer = this.noise; s.loop = true; s.loopStart = Math.random() * 0.5;
    fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + Math.min(0.01, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(dest); s.start(t, Math.random() * 0.9); s.stop(t + dur + 0.05);
  }

  // ── music ────────────────────────────────────────────────────
  startMusic() {
    if (!this.ctx) return;
    this.stopMusic();   // never two loops at once
    this.playing = true; this.step = 0; this.nextTime = this.ctx.currentTime + 0.12;
    this.music.gain.cancelScheduledValues(this.ctx.currentTime); this.applyVolumes(0.3);
    this.timer = window.setInterval(() => this.schedule(), 30);
  }
  stopMusic(fade = 0) {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.playing = false;
    if (this.ctx && fade > 0) this.music.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
  }
  private schedule() {
    const ctx = this.ctx!;
    if (!this.playing || ctx.state !== 'running') return;
    while (this.nextTime < ctx.currentTime + 0.18) { this.playStep(this.step, this.nextTime); this.nextTime += STEP; this.step = (this.step + 1) % STEPS; }
  }
  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16), s = step % 16, ch = CHORDS[Math.floor(bar / 2) % CHORDS.length], m = this.music;
    const swing = s % 2 ? 0.012 : 0;
    // marimba arpeggio on eighth notes, thinner in the first four bars of each half
    if (s % 2 === 0) {
      const i = s / 2, sparse = bar % 8 < 2 && i % 2 === 1;
      if (!sparse) this.marimba(m, t, ch.tones[ARP[i]], i === 0 ? 1 : i % 2 ? 0.55 : 0.75);
    } else if ((s === 7 || s === 15) && bar % 2 === 1) this.marimba(m, t + swing, ch.tones[3] , 0.4);
    if (s === 0) this.pluck(m, t, ch.root, 1, 0.7);
    if (s === 6) this.pluck(m, t, ch.root + 7, 0.6, 0.4);
    if (s === 10) this.pluck(m, t, ch.root + (bar % 2 ? 12 : 7), 0.7, 0.45);
    if (s % 4 === 2) this.burst(m, t, 0.035, 0.05, 'bandpass', 6500, 6500, 1.5);
    if (s === 4 || s === 12) this.burst(m, t, 0.05, 0.09, 'bandpass', 2400, 1800, 2);
    for (const n of MELODY) if (n[0] === bar && n[1] === s) this.bell(m, t, n[2], 0.9, n[3] * STEP * 0.5);
    // tension layer: a muted pulse on the root and fifth
    if (this.tension > 0.02) {
      this.pluck(this.tensionGain, t, ch.root + (s % 4 === 0 ? 12 : s % 4 === 2 ? 19 : 12), s % 4 === 0 ? 0.9 : 0.5, 0.16);
      if (s % 8 === 4) this.marimba(this.tensionGain, t, ch.tones[0] + 12, 0.5);
    }
  }

  /** proximity 0 (front far away) .. 1 (right behind you). */
  setProximity(p: number) {
    this.proximity = p;
    this.tension = p > 0.25 ? (p - 0.25) / 0.75 : 0;
    if (this.ctx) this.tensionGain.gain.setTargetAtTime(this.tension * 0.8, this.ctx.currentTime, 0.4);
  }

  /** Paper-tearing grains; denser and louder as the front approaches. */
  update(dt: number) {
    if (!this.ctx || this.ctx.state !== 'running' || this.proximity <= 0.02) return;
    const p = this.proximity;
    this.tearAcc += dt * (1.5 + 26 * p * p);
    while (this.tearAcc > 1) {
      this.tearAcc -= 1;
      const t = this.ctx.currentTime + Math.random() * 0.05, vol = 0.015 + 0.14 * p * p;
      if (Math.random() < 0.12) this.burst(this.sfx, t, vol * 1.3, 0.22 + Math.random() * 0.2, 'bandpass', 900 + Math.random() * 600, 3500 + Math.random() * 2000, 0.8);
      else this.burst(this.sfx, t, vol * (0.5 + Math.random()), 0.012 + Math.random() * 0.04, 'highpass', 1800 + Math.random() * 3000);
    }
  }

  // ── effects ──────────────────────────────────────────────────
  private get now() { return this.ctx!.currentTime; }
  footstep() { if (!this.ctx) return; this.burst(this.sfx, this.now, 0.07, 0.045, 'bandpass', 1500 + Math.random() * 900, 900, 1.2); }
  jump() { if (!this.ctx) return; const t = this.now; this.burst(this.sfx, t, 0.09, 0.16, 'bandpass', 700, 2600, 1); this.tone(this.sfx, t, 420, 'sine', 0.06, 0.005, 0.12).frequency.exponentialRampToValueAtTime(760, t + 0.1); }
  land() { if (!this.ctx) return; const t = this.now; this.burst(this.sfx, t, 0.14, 0.09, 'lowpass', 900, 300); this.burst(this.sfx, t, 0.05, 0.05, 'highpass', 3000); }
  bump() { if (!this.ctx) return; const t = this.now; this.burst(this.sfx, t, 0.16, 0.12, 'lowpass', 600, 200); this.tone(this.sfx, t, 150, 'sine', 0.12, 0.003, 0.12); }
  star() { if (!this.ctx) return; const t = this.now; this.bell(this.sfx, t, 90, 0.9, 0.1); this.bell(this.sfx, t + 0.07, 95, 0.8, 0.2); }
  checkpoint() {
    if (!this.ctx) return; const t = this.now;
    this.bell(this.sfx, t, 74, 1.1, 0.3); this.bell(this.sfx, t + 0.13, 78, 1.1, 0.3); this.bell(this.sfx, t + 0.26, 81, 1.2, 0.7);
    // a brief release: a warm open chord under the bells
    for (const n of [50, 57, 62, 66]) this.pluck(this.cue, t + 0.26, n, 0.55, 1.5);
  }
  fail() {
    if (!this.ctx) return; const t = this.now;
    this.burst(this.sfx, t, 0.12, 0.5, 'bandpass', 2600, 500, 0.7);
    this.marimba(this.sfx, t + 0.05, 69, 0.8); this.marimba(this.sfx, t + 0.22, 66, 0.7); this.marimba(this.sfx, t + 0.4, 62, 0.7);
  }
  /** Warning: paper shifting before a strip lets go. Soft, three small flutters. */
  rustle() { if (!this.ctx) return; const t = this.now; for (let i = 0; i < 5; i++) this.burst(this.sfx, t + i * 0.13 + Math.random() * 0.05, 0.05 + 0.03 * Math.random(), 0.09, 'bandpass', 2600 + Math.random() * 1800, 1800, 1.2); }
  /** The strip separates: one longer tear with a few fibres snapping after it. */
  tear() {
    if (!this.ctx) return; const t = this.now;
    this.burst(this.sfx, t, 0.17, 0.55, 'bandpass', 1100, 4200, 0.7);
    for (let i = 0; i < 6; i++) this.burst(this.sfx, t + 0.08 + i * 0.09 + Math.random() * 0.04, 0.07, 0.03, 'highpass', 2400 + Math.random() * 2500);
  }
  ui() { if (!this.ctx) return; this.marimba(this.sfx, this.now, 81, 0.35); }
  /** Short rewarding cue at the gift. */
  finish() {
    if (!this.ctx) return;
    this.stopMusic(0.9);
    this.setProximity(0);
    const t = this.now + 0.25, c = this.cue;
    [62, 66, 69, 74, 78, 81].forEach((n, i) => { this.marimba(c, t + i * 0.12, n, 0.9); this.bell(c, t + i * 0.12, n + 12, 0.6, 0.3); });
    const t2 = t + 0.85;
    for (const n of [62, 66, 69, 74, 81, 86]) this.bell(c, t2, n, 1.0, 1.8);
    this.pluck(c, t2, 38, 1.2, 1.6);
    for (let i = 0; i < 5; i++) this.bell(c, t2 + 0.5 + i * 0.17, [90, 93, 86, 90, 98][i], 0.5, 0.6);
  }

  suspend() { void this.ctx?.suspend(); }
  resume() { void this.ctx?.resume(); }
}
