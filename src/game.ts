/** Game orchestration: fixed-step simulation, level progression, checkpoints, failure, ending. */
import { NeutralToneMapping, PCFShadowMap, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { CONFIG } from './config';
import { clamp } from './core/math';
import { World } from './world/world';
import { PROMPTS, FINISH, BENCHMARK, type PromptKey } from './world/level';
import type { PeelEvent } from './world/route';
import { PlayerController } from './player/controller';
import { Traveler } from './player/traveler';
import { FollowCamera } from './camera/followCamera';
import { CollapseFront } from './collapse/front';
import { PaperFragments } from './collapse/particles';
import { InputManager } from './input/input';
import { AudioEngine } from './audio/audio';
import { UI, FAIL_TEXT, type Quality, type Settings } from './ui/ui';

type State = 'title' | 'play' | 'pause' | 'ending';
const STEP = 1 / 120, START_S = 3;
const QUALITY: Record<Quality, { dpr: number; shadows: boolean; size: number; fragments: number }> = {
  low: { dpr: 1, shadows: false, size: 1024, fragments: 0.5 },
  medium: { dpr: 1.5, shadows: true, size: 2048, fragments: 1 },
  high: { dpr: 2, shadows: true, size: 4096, fragments: 1 },
};

export class Game {
  readonly world = new World();
  readonly route = this.world.route;
  readonly player = new PlayerController(this.route);
  readonly front = new CollapseFront(this.route);
  readonly input = new InputManager();
  readonly audio = new AudioEngine();
  readonly ui: UI;
  state: State = 'title';
  checkpoint = 0; retries = 0; playTime = 0;
  private renderer: WebGLRenderer;
  private traveler = new Traveler();
  private cam = new FollowCamera(this.route);
  private fragments = new PaperFragments(this.route);
  private finishS = this.route.markS(FINISH);
  private prompts = PROMPTS.map((p) => ({ s0: this.route.sheet(p.sheet).s0 + p.u0, s1: this.route.sheet(p.sheet).s0 + p.u1, key: p.key }));
  private respawnS = START_S; private starsAtCheckpoint: boolean[] = [];
  private acc = 0; private last = 0; private time = 0; private failT = -1; private endT = -1; private raf = 0;
  private focus = new Vector3();
  private evOut: { ev: PeelEvent; phase: 1 | 2 }[] = [];
  private benchmark = false;
  private lastFail: string | null = null; private failCounts: Record<string, number> = {};
  private debugOn = /debug/i.test(location.search + location.hash); private debugEl = document.getElementById('debug');
  private readonly onKey = (e: KeyboardEvent) => { if (e.code === 'F3' || e.code === 'Backquote') { this.debugOn = !this.debugOn; e.preventDefault(); } };
  private _pv = new Vector3(); private _pn = new Vector3(); private _pb = new Vector3(); private puffAcc = 0;
  private readonly onResize = () => this.resize();
  private readonly onVisibility = () => { if (document.hidden && this.state === 'play') this.pause(); };

  constructor(canvas: HTMLCanvasElement) {
    const r = (this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = SRGBColorSpace; r.toneMapping = NeutralToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = PCFShadowMap;
    this.world.scene.add(this.traveler.root, this.traveler.shadow, this.fragments.mesh);

    this.ui = new UI({
      play: (mode) => this.startRun(mode), connect: () => this.connectMicrobit(), resume: () => this.resume(), restart: () => this.restartCheckpoint(),
      quit: () => this.toTitle(), again: () => this.startRun(this.benchmark ? 'benchmark' : 'full'), pause: () => this.pause(), settings: (s) => this.applySettings(s),
      useKeyboard: () => { this.input.device = 'keyboard'; }, click: () => { this.audio.init(); this.audio.applyVolumes(); this.audio.ui(); },
    }, this.input.microbit);
    this.input.onPause = () => { if (this.state === 'play') this.pause(); else if (this.state === 'pause' && this.ui.current === 'pause') this.resume(); };
    this.input.microbit.onStatus = (s) => { this.ui.onMicrobitStatus(s); if (s === 'connected') this.input.device = 'microbit'; };
    this.input.microbit.onLost = () => {
      this.input.device = 'keyboard';
      if (this.state === 'play') { this.pause(); this.ui.show('lost'); }
    };
    window.addEventListener('resize', this.onResize); window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.applySettings(this.ui.settings);
    this.resize();
    this.player.place(START_S);
    this.ui.show('title'); this.ui.hud(false);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private async connectMicrobit() {
    const ok = await this.input.microbit.connect();
    if (ok) this.input.device = 'microbit';
    return ok;
  }

  private applySettings(s: Settings) {
    const q = QUALITY[s.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.world.setQuality(q.shadows, q.size);
    this.fragments.density = q.fragments;
    this.audio.musicVolume = s.music; this.audio.sfxVolume = s.sfx; this.audio.muted = s.mute; this.audio.applyVolumes();
    this.resize();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.resize(w, Math.max(1, h));
  }

  // ── run lifecycle ────────────────────────────────────────────
  startRun(mode: 'full' | 'benchmark' = 'full') {
    this.audio.init();
    this.benchmark = mode === 'benchmark';
    this.input.device = this.input.microbit.connected ? 'microbit' : 'keyboard';
    this.lastFail = null; this.failCounts = {};
    this.checkpoint = 0; this.retries = 0; this.playTime = 0; this.respawnS = START_S; this.failT = this.endT = -1; this.acc = 0;
    this.front.reset(); this.fragments.reset(); this.route.resetEvents(0);
    for (const st of this.world.stars) { st.taken = false; st.mesh.visible = true; }
    this.starsAtCheckpoint = this.world.stars.map(() => false);
    for (const cp of this.world.checkpoints) cp.glow = 0;
    this.world.setEnvelopeOpen(0);
    this.player.place(START_S);
    if (this.benchmark) {
      // start directly at the benchmark checkpoint with the unravelling already in pursuit
      this.checkpoint = BENCHMARK.startCheckpoint + 1; this.respawnS = this.world.checkpoints[BENCHMARK.startCheckpoint].s;
      this.player.place(this.respawnS); this.front.activate(this.respawnS - CONFIG.collapse.startDistance);
    }
    this.traveler.resetPose(); this.cam.snap(); this.input.clear();
    this.state = 'play';
    this.ui.show(null); this.ui.hud(true); this.ui.fade(false); this.syncHud();
    this.audio.resume(); this.audio.setProximity(0); this.audio.startMusic();
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause'; this.ui.show('pause'); this.audio.setSlide(0); this.audio.suspend();
  }
  resume() {
    if (this.state !== 'pause') return;
    this.state = 'play'; this.ui.show(null); this.input.clear(); this.audio.resume(); this.last = performance.now(); this.acc = 0;
  }
  restartCheckpoint() {
    if (this.state !== 'pause') return;
    this.respawn(); this.resume();
  }
  toTitle() {
    this.state = 'title'; this.audio.resume(); this.audio.stopMusic(0.4); this.audio.setProximity(0);
    this.front.reset(); this.fragments.reset(); this.route.resetEvents(0); this.player.place(START_S); this.world.setEnvelopeOpen(0); this.audio.setSlide(0); this.traveler.resetPose();
    this.ui.hud(false); this.ui.fade(false); this.ui.show('title');
  }

  private respawn() {
    // restore the world as it was at the checkpoint: position, velocity, stars, and the front safely behind
    this.player.place(this.respawnS);
    this.front.respawn(this.respawnS);
    this.route.resetEvents(this.respawnS);
    this.world.stars.forEach((st, i) => { st.taken = this.starsAtCheckpoint[i]; st.mesh.visible = !st.taken; });
    this.fragments.reset(); this.traveler.resetPose(); this.cam.snap(); this.input.clear();
    this.failT = -1; this.acc = 0; this.syncHud();
  }

  private syncHud(pop = false) {
    this.ui.setProgress(this.checkpoint, this.world.checkpoints.length, this.world.stars.filter((s) => s.taken).length, this.world.stars.length, pop);
  }

  // ── simulation ───────────────────────────────────────────────
  private step() {
    const p = this.player, w = this.world;
    const controls = this.input.read();
    if (this.failT >= 0 || this.state === 'ending') { controls.forward = 0; controls.lateral = 0; controls.jump = false; controls.brake = this.state === 'ending' ? 1 : 0; }
    p.step(STEP, controls, this.finishS);
    if (this.state === 'play') {
      this.front.update(STEP, p.s); this.playTime += STEP;
      // authored transformations: warning first (rustle), then the strip lets go (tear)
      this.evOut.length = 0; this.route.updateEvents(STEP, p.s, this.evOut);
      for (const o of this.evOut) { if (o.phase === 1) this.audio.rustle(); else this.audio.tear(); }
    }

    for (const e of p.events) {
      if (e === 'jump') this.audio.jump(); else if (e === 'land') this.audio.land(); else if (e === 'bump') this.audio.bump();
      else if (e === 'fall' && this.failT < 0) {
        this.failT = 0; this.retries++; this.audio.fail();
        // say what actually happened, straight away, so the retry has a purpose
        this.lastFail = p.fallCause; this.failCounts[p.fallCause ?? 'tear'] = (this.failCounts[p.fallCause ?? 'tear'] ?? 0) + 1;
        if (p.fallCause) this.ui.toast(FAIL_TEXT[p.fallCause], 2600);
      }
    }
    p.events.length = 0;
    if (p.mode === 'fall') return;

    // checkpoints
    while (this.checkpoint < w.checkpoints.length && p.s >= w.checkpoints[this.checkpoint].s && p.mode === 'ground') {
      const cp = w.checkpoints[this.checkpoint++];
      this.respawnS = cp.s; cp.glow = 1;
      this.starsAtCheckpoint = w.stars.map((s) => s.taken);
      if (this.checkpoint === CONFIG.collapse.startsAtCheckpoint && !this.front.active) this.front.activate(cp.s - CONFIG.collapse.startDistance);
      const benchDone = this.benchmark && this.checkpoint === BENCHMARK.endCheckpoint + 1;
      this.audio.checkpoint(); this.traveler.cheer = 1; this.syncHud(true);
      this.ui.toast(benchDone ? 'Slide section complete. The course carries on' : `Checkpoint ${this.checkpoint} of ${w.checkpoints.length}`, benchDone ? 3200 : 2200);
    }
    // stars
    for (const st of w.stars) {
      if (st.taken || Math.abs(st.s - p.s) > 0.75) continue;
      const da = p.sheet.wrap ? Math.abs(p.sheet.wrapA(st.a - p.a)) : Math.abs(st.a - p.a);
      if (da < 0.75 && Math.abs(st.h - p.h - 0.3) < 0.8) { st.taken = true; st.mesh.visible = false; this.audio.star(); this.syncHud(); }
    }
    // the gift
    if (p.mode === 'done' && this.state === 'play') { this.state = 'ending'; this.endT = 0; this.audio.finish(); this.ui.setPrompt(null, this.input.device); }
  }

  private currentPrompt(): PromptKey | null {
    const s = this.player.s;
    for (const p of this.prompts) if (s >= p.s0 && s < p.s1) return p.key;
    return null;
  }

  private readonly frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const p = this.player, mb = this.input.microbit;
    mb.poll(now); this.ui.updateMicrobit();

    if (this.state === 'play' || this.state === 'ending') {
      this.time += dt; this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n++ < 14) { this.step(); this.acc -= STEP; }
      if (n >= 14) this.acc = 0;

      if (this.failT >= 0) {
        this.failT += dt;
        if (this.failT > 0.5) this.ui.fade(true);
        if (this.failT > 1.0) { this.respawn(); this.ui.fade(false); }
      }
      if (this.state === 'ending') {
        this.endT += dt;
        this.traveler.celebrate = clamp((this.endT - 0.3) / 0.4, 0, 1) * clamp((3.4 - this.endT) / 0.5, 0, 1);
        this.world.setEnvelopeOpen(clamp((this.endT - 0.9) / 1.6, 0, 1));
        if (this.endT > 3.0 && this.ui.current !== 'ending') {
          this.ui.hud(false);
          this.ui.showEnding(this.world.stars.filter((s) => s.taken).length, this.world.stars.length, this.playTime, this.retries);
        }
      } else {
        const dist = this.front.distance(p.s);
        const prox = this.front.active ? clamp(1 - dist / CONFIG.collapse.meterRange, 0, 1) : 0;
        this.ui.setMeter(this.front.active ? prox : -1);
        this.audio.setProximity(this.failT >= 0 || !this.front.active ? 0 : clamp(1 - dist / CONFIG.collapse.warnDistance, 0, 1)); this.audio.update(dt);
        this.ui.setPrompt(this.failT >= 0 ? null : this.currentPrompt(), this.input.device);
      }
      this.audio.setSlide(p.sliding ? 0.35 + 0.65 * clamp(p.vu / CONFIG.difficulty.slideMaxSpeed, 0, 1) : 0);
      this.traveler.update(dt, p, this.time);
      if (this.traveler.stepped && p.mode === 'ground') this.audio.footstep();
      this.cam.update(dt, p);
      // a wake of paper flecks while sliding
      if (p.sliding) {
        this.puffAcc += dt * 26 * this.fragments.density * (p.vu / CONFIG.difficulty.slideMaxSpeed);
        while (this.puffAcc > 1) { this.puffAcc -= 1; p.sheet.pos(p.u - 0.25, p.a, 0.05, this._pv, this._pn); p.sheet.pos(p.u - 0.6, p.a, 0.05, this._pb); this.fragments.puff(this._pv, this._pn, this._pb.sub(this._pv).normalize(), p.sheet.def.color); }
      }
      this.fragments.update(dt, this.time, this.front.speed, this.cam.camera.position);
    } else if (this.state === 'title') {
      this.time += dt;
      this.traveler.update(dt, p, this.time);
      this.cam.titleShot(this.time);
    }
    if (p.mode === 'fall') this.focus.copy(this.cam.camera.position); else p.sheet.pos(p.u, p.a, 0, this.focus);
    if (this.state === 'title') this.focus.copy(this.cam.camera.position).addScaledVector(this.cam.camera.getWorldDirection(new Vector3()), 24);
    this.world.update(this.state === 'pause' ? 0 : dt, this.time, this.focus, p.s);
    this.drawDebug();
    this.renderer.render(this.world.scene, this.cam.camera);
  };

  /** Development overlay (F3, the ` key, or ?debug): position, surface state, event timing, last failure cause. */
  private drawDebug() {
    const el = this.debugEl; if (!el) return;
    el.classList.toggle('hidden', !this.debugOn);
    if (!this.debugOn) return;
    const p = this.player, r = this.route, sh = p.sheet;
    const ev = r.events.filter((e) => e.t >= 0 && !(e.done && e.s1 < p.s - 30)).map((e) => `  ${e.def.id.padEnd(7)} t=${e.t.toFixed(1)} ${e.t < e.warn ? 'WARN' : e.done ? 'open' : 'PEEL'} to ${(e.frontS - e.sheet.s0).toFixed(0)}`);
    el.textContent = [
      `sheet ${sh.def.id}  u ${p.u.toFixed(1)}  a ${p.a.toFixed(2)}  h ${p.h.toFixed(2)}`,
      `s ${p.s.toFixed(1)} / ${r.total.toFixed(0)}   mode ${p.mode}${p.sliding ? ' (slide)' : ''}   v ${p.vu.toFixed(1)}`,
      `paper ${sh.sd(p.u, p.a) > 0 ? 'yes' : 'NO'}  peeled ${r.peeledAt(sh, p.u, p.a) ? 'YES' : 'no'}  collapsed ${r.collapsed(sh, p.u, p.a) ? 'YES' : 'no'}  blocked ${r.blocked(sh, p.u + 0.24, p.a, p.h) ? 'YES' : 'no'}`,
      `front ${this.front.active ? (p.s - r.front).toFixed(1) + ' m behind, ' + this.front.speed.toFixed(1) + ' m/s' : 'not started'}`,
      `checkpoint ${this.checkpoint}  respawn s ${this.respawnS.toFixed(0)}   last fail: ${this.lastFail ?? '-'}`,
      `fails ${Object.entries(this.failCounts).map(([k, v]) => k + ':' + v).join(' ') || '-'}`,
      ...(ev.length ? ['events:', ...ev] : []),
    ].join('\n');
  }

  /** Release everything (hot reload, tests). */
  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize); window.removeEventListener('keydown', this.onKey); document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose(); this.audio.stopMusic(); this.renderer.dispose();
  }

  /** Small hooks used by the automated browser tests. Not used by the game itself. */
  readonly debug = {
    teleport: (s: number, a = 0) => { this.player.place(s, a); this.cam.snap(); },
    setFront: (s: number) => { this.front.activate(s); },
    info: () => ({ sim: this.time, state: this.state, s: this.player.s, a: this.player.a, h: this.player.h, mode: this.player.mode, cause: this.player.fallCause, lastFail: this.lastFail, sliding: this.player.sliding, vu: this.player.vu, sheet: this.player.sheet.def.id, front: this.route.front, checkpoint: this.checkpoint, time: this.playTime, retries: this.retries, screen: this.ui.current }),
    camera: () => this.cam.camera,
    playerPos: () => this.traveler.root.position,
  };
}
