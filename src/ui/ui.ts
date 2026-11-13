/** DOM interface: title, HUD, pause, settings, micro:bit test screen, disconnect dialog, ending. All text is English. */
import './style.css';
import { CONFIG } from '../config';
import type { MicrobitInput, MicrobitStatus } from '../input/microbit';
import type { PromptKey } from '../world/level';
import type { Device } from '../input/input';
import type { FallCause } from '../player/controller';

export type Quality = 'low' | 'medium' | 'high';
export interface Settings { music: number; sfx: number; mute: boolean; quality: Quality }
export type ScreenName = 'title' | 'pause' | 'settings' | 'microbit' | 'lost' | 'ending';

export interface UIHandlers {
  play(mode?: 'full' | 'benchmark'): void; connect(): Promise<boolean>; resume(): void; restart(): void; quit(): void; again(): void; pause(): void;
  settings(s: Settings): void; useKeyboard(): void; click(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = 'inside-the-straw.settings';

const PROMPT_TEXT: Record<PromptKey, [keyboard: string, microbit: string]> = {
  run: ['Hold W or ↑ to run forward', 'Tilt the micro:bit forward to run'],
  brake: ['Let go to slow down. Hold S or ↓ to brake', 'Level it to slow down. Tilt back to brake'],
  around: ['The wall is crushed in. Use A / D or ← → to climb round it', 'The wall is crushed in. Tilt left or right to climb round it'],
  holes: ['Tears are real holes. Walk round them on the wall', 'Tears are real holes. Walk round them on the wall'],
  jump: ['Press Space to hop the crease, and to jump the tear', 'Press button A to hop the crease, and to jump the tear'],
  collapse: ['The straw is unravelling behind you. Keep moving', 'The straw is unravelling behind you. Keep moving'],
  peelfloor: ['Watch the seams. The floor ahead is about to peel: take the wall', 'Watch the seams. The floor ahead is about to peel: take the wall'],
  band: ['Two strips are letting go. Find the band that stays', 'Two strips are letting go. Find the band that stays'],
  toSlide: ['The straw is cut open ahead. Stay on the strip that is left: it becomes a slide', 'The straw is cut open ahead. Stay on the strip that is left: it becomes a slide'],
  slide: ['Slide! Steer with A / D. S slows you a little', 'Slide! Tilt to steer. Tilt back to slow a little'],
  gap: ['Space at the end of the slide to jump into the blue straw', 'Button A at the end of the slide to jump into the blue straw'],
  weave: ['A strand is pulling out of the weave. Keep to what holds', 'A strand is pulling out of the weave. Keep to what holds'],
  rest: ['Safe for a moment. Next: the stack of cut straws', 'Safe for a moment. Next: the stack of cut straws'],
  stack: ['Run along the tops of the cut straws and jump between them', 'Run along the tops of the cut straws and jump between them'],
  exit: ['Cut open again. Follow the strip that is left', 'Cut open again. Follow the strip that is left'],
  tabs: ['The end splits into three tabs. The middle one is the sure way', 'The end splits into three tabs. The middle one is the sure way'],
  safe: ['The unravelling cannot follow you in here', 'The unravelling cannot follow you in here'],
};

/** What went wrong, said plainly, with what to try next. Chosen from the cause the game actually detected. */
export const FAIL_TEXT: Record<FallCause, string> = {
  collapse: 'The unravelling caught up. Keep moving',
  peel: 'The strip peeled away. Watch for the lifting seam and get off it early',
  tear: 'That was a tear in the wall. Go round it',
  edge: 'You went over the side. Stay nearer the middle',
  gap: 'The paper ends there. Jump from the edge',
  short: 'You missed the landing: too short. Jump later, right at the edge',
  wide: 'You missed the landing: you came down beside it',
  step: 'You hit the end of the next straw. Jump a little earlier',
};

export function loadSettings(): Settings {
  const s: Settings = { music: 0.6, sfx: 0.8, mute: false, quality: 'medium' };
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* defaults */ }
  return s;
}

export class UI {
  settings = loadSettings();
  private screens: Record<ScreenName, HTMLElement> = {
    title: $('screen-title'), pause: $('screen-pause'), settings: $('screen-settings'), microbit: $('screen-microbit'), lost: $('screen-lost'), ending: $('screen-ending'),
  };
  current: ScreenName | null = 'title';
  /** 'benchmark' when the page was opened with ?benchmark or #benchmark. */
  defaultMode: 'full' | 'benchmark' = /benchmark|slide/i.test(location.search + location.hash) ? 'benchmark' : 'full';
  private back: ScreenName[] = [];
  private promptKey: PromptKey | null = null; private promptDevice: Device = 'keyboard';
  private toastTimer = 0; private lastMeter = -99; private lastCp = ''; private lastStars = '';

  constructor(private h: UIHandlers, private mb: MicrobitInput) {
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', () => { h.click(); fn(); });
    on('btn-play', () => h.play(this.defaultMode));
    on('btn-benchmark', () => h.play('benchmark'));
    on('btn-connect', () => void this.connectFlow());
    on('btn-settings', () => this.open('settings'));
    on('btn-resume', () => h.resume());
    on('btn-restart', () => h.restart());
    on('btn-pause-settings', () => this.open('settings'));
    on('btn-quit', () => h.quit());
    on('btn-settings-back', () => this.close());
    on('btn-open-microbit', () => this.open('microbit'));
    on('mb-back', () => this.close());
    on('mb-connect', () => void this.connectFlow(false));
    on('mb-calibrate', () => { mb.calibrate(); this.flash('mb-calibrate', 'Neutral position set'); });
    on('lost-reconnect', () => void h.connect().then((ok) => { if (ok) { this.show('pause'); } }));
    on('lost-keyboard', () => { h.useKeyboard(); this.show('pause'); });
    on('btn-again', () => h.again());
    on('btn-ending-title', () => h.quit());
    on('hud-pause', () => h.pause());

    const music = $<HTMLInputElement>('set-music'), sfx = $<HTMLInputElement>('set-sfx'), mute = $<HTMLInputElement>('set-mute'), q = $<HTMLSelectElement>('set-quality');
    music.value = String(this.settings.music * 100); sfx.value = String(this.settings.sfx * 100); mute.checked = this.settings.mute; q.value = this.settings.quality;
    const push = () => {
      this.settings = { music: +music.value / 100, sfx: +sfx.value / 100, mute: mute.checked, quality: q.value as Quality };
      try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
      h.settings(this.settings);
    };
    for (const el of [music, sfx, mute, q]) el.addEventListener('input', push);
    sfx.addEventListener('change', () => h.click());

    const sens = $<HTMLInputElement>('mb-sens'), dz = $<HTMLInputElement>('mb-deadzone'), invF = $<HTMLInputElement>('mb-inv-f'), invS = $<HTMLInputElement>('mb-inv-s');
    sens.value = String(mb.settings.sensitivity * 100); dz.value = String(mb.settings.deadZone); invF.checked = mb.settings.invertForward; invS.checked = mb.settings.invertSide;
    const pushMb = () => { mb.settings.sensitivity = +sens.value / 100; mb.settings.deadZone = +dz.value; mb.settings.invertForward = invF.checked; mb.settings.invertSide = invS.checked; mb.saveSettings(); };
    for (const el of [sens, dz, invF, invS]) el.addEventListener('input', pushMb);

    $('title-for').textContent = CONFIG.recipientName ? `For ${CONFIG.recipientName}` : 'Run, climb the walls, and stay ahead of the unravelling.';
    if (!CONFIG.collectibles.enabled) $('hud-stars').classList.add('hidden');
    this.onMicrobitStatus(mb.status);
  }

  private flash(id: string, text: string) { const b = $(id), old = b.textContent; b.textContent = text; window.setTimeout(() => { b.textContent = old; }, 1300); }

  private async connectFlow(openScreen = true) {
    if (!this.mb.supported) { this.onMicrobitStatus('unsupported'); if (openScreen) this.open('microbit'); return; }
    if (this.mb.connected) { if (openScreen) this.open('microbit'); return; }
    const ok = await this.h.connect();
    if (ok && openScreen && this.current !== 'microbit') this.open('microbit');
    if (!ok) $('title-note').textContent = 'No micro:bit was selected. You can try again, or play with the keyboard.';
  }

  onMicrobitStatus(s: MicrobitStatus) {
    const text: Record<MicrobitStatus, string> = {
      unsupported: 'USB serial is not available in this browser',
      disconnected: 'Not connected', connecting: 'Choose your micro:bit in the browser window…',
      'no-data': 'Connected, waiting for data…', connected: 'Connected and receiving',
    };
    $('mb-status').textContent = 'Status: ' + text[s];
    $('mb-help').textContent = s === 'unsupported'
      ? 'To use a micro:bit, open the game in Chrome or Edge on a computer, from https:// or http://localhost. The whole game is playable with the keyboard.'
      : s === 'no-data' ? 'If nothing arrives, check that the Inside the Straw firmware is on the micro:bit (see the README).' : '';
    const live = s === 'connected' || s === 'no-data';
    $('btn-play').textContent = (this.defaultMode === 'benchmark' ? 'Play the slide section' : 'Play') + (live ? ' with micro:bit' : ' with keyboard');
    $('btn-connect').textContent = live ? 'micro:bit setup and test' : 'Connect micro:bit';
    $<HTMLButtonElement>('mb-connect').disabled = live || s === 'unsupported' || s === 'connecting';
    $('mb-connect').textContent = live ? 'Connected' : 'Connect micro:bit';
    $('title-note').textContent = s === 'unsupported' ? 'micro:bit control needs Chrome or Edge on a computer. Keyboard play works everywhere.'
      : live ? 'micro:bit connected. The keyboard still works at any time.' : '';
  }

  /** Replace whatever is showing. */
  show(name: ScreenName | null) {
    this.back.length = 0; this.current = name;
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
    if (name) (this.screens[name].querySelector('.btn.primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  /** Open on top of the current screen; close() returns to it. */
  open(name: ScreenName) { if (this.current) this.back.push(this.current); const b = this.back.slice(); this.show(name); this.back = b; }
  close() { const prev = this.back.pop() ?? null, b = this.back.slice(); this.show(prev); this.back = b; }

  hud(visible: boolean) { $('hud').classList.toggle('hidden', !visible); }

  setProgress(cp: number, total: number, stars: number, starTotal: number, pop = false) {
    const c = `Checkpoint ${cp} / ${total}`, s = `${CONFIG.collectibles.label} ${stars} / ${starTotal}`;
    if (c !== this.lastCp) { this.lastCp = c; const el = $('hud-checkpoint'); el.textContent = c; if (pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } }
    if (s !== this.lastStars) { this.lastStars = s; $('hud-stars').textContent = s; }
  }

  /** proximity 0..1, or -1 while the unravelling has not started. */
  setMeter(p: number) {
    const v = p < 0 ? -1 : Math.round(p * 20);
    if (v === this.lastMeter) return;
    this.lastMeter = v;
    const m = $('hud-meter');
    m.classList.toggle('idle', p < 0); m.classList.toggle('near', p > 0.7);
    $('hud-meter-fill').style.width = `${Math.max(0, p) * 100}%`;
  }

  setPrompt(key: PromptKey | null, device: Device) {
    if (key === this.promptKey && device === this.promptDevice) return;
    this.promptKey = key; this.promptDevice = device;
    const el = $('hud-prompt');
    el.classList.toggle('hidden', !key);
    if (key) { el.textContent = PROMPT_TEXT[key][device === 'microbit' ? 1 : 0]; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  }

  toast(text: string, ms = 2200) {
    const el = $('hud-toast'); el.textContent = text; el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    window.clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => el.classList.add('hidden'), ms);
  }

  fade(on: boolean) { $('fade').classList.toggle('on', on); }

  showEnding(stars: number, starTotal: number, seconds: number, retries: number) {
    $('letter-to').textContent = CONFIG.recipientName ? `Dear ${CONFIG.recipientName},` : '';
    $('letter-to').classList.toggle('hidden', !CONFIG.recipientName);
    const body = $('letter-body'); body.replaceChildren();
    for (const line of CONFIG.giftMessage) { const p = document.createElement('p'); p.textContent = line; body.appendChild(p); }
    $('letter-sign').textContent = CONFIG.giftSignature; $('letter-sign').classList.toggle('hidden', !CONFIG.giftSignature);
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    const parts = [`Journey time ${m}:${String(s).padStart(2, '0')}`];
    if (CONFIG.collectibles.enabled) parts.push(`${CONFIG.collectibles.label} ${stars} / ${starTotal}`);
    parts.push(retries === 0 ? 'No tumbles' : `${retries} ${retries === 1 ? 'tumble' : 'tumbles'}`);
    $('ending-stats').textContent = parts.join('   ·   ');
    const env = $('envelope'), foot = document.querySelector('.ending-foot') as HTMLElement;
    env.classList.remove('open'); foot.classList.remove('on');
    this.show('ending');
    requestAnimationFrame(() => requestAnimationFrame(() => { env.classList.add('open'); foot.classList.add('on'); }));
  }

  /** Live read-out on the micro:bit test screen. */
  updateMicrobit() {
    if (this.current !== 'microbit') return;
    const mb = this.mb, st = mb.settings, full = CONFIG.microbit.fullTiltDegrees * 1.25;
    const px = Math.max(-1, Math.min(1, ((mb.roll - st.neutralRoll) * (st.invertSide ? -1 : 1)) / full)), py = Math.max(-1, Math.min(1, ((mb.pitch - st.neutralPitch) * (st.invertForward ? -1 : 1)) / full));
    const dot = $('mb-dot'); dot.style.transform = `translate(${px * 89}px, ${-py * 89}px)`; dot.style.opacity = mb.fresh ? '1' : '0.3';
    const dz = (st.deadZone / full) * 178; $('mb-dead').style.width = $('mb-dead').style.height = `${dz}px`;
    $('mb-a').classList.toggle('on', mb.buttonA);
    $('mb-fwd').textContent = mb.forwardAxis.toFixed(2); $('mb-side').textContent = mb.sideAxis.toFixed(2);
    const ps = mb.protocol.stats; $('mb-stats').textContent = `${ps.ok} ok · ${ps.dropped} lost · ${ps.malformed} bad`;
  }
}
