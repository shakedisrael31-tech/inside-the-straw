// Browser checks against a running server: node scripts/e2e.mjs [url]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++; };
const info = () => page.evaluate(() => window.straw.debug.info());
// wait in simulated game time, so the checks do not depend on how fast this machine renders
const wait = async (ms) => { const st = (await info()).state; if (st !== 'play' && st !== 'ending') return page.waitForTimeout(Math.min(ms, 400));
  const t0 = (await info()).sim; await page.waitForFunction((t) => { const i = window.straw.debug.info(); return i.sim >= t || (i.state !== 'play' && i.state !== 'ending'); }, t0 + ms / 1000, { timeout: 120000, polling: 30 }); };

await page.goto(url);
await page.waitForFunction(() => !!window.straw, null, { timeout: 60000 });
check('title screen shown, English title', (await page.innerText('h1')).replace(/\s+/g, ' ').trim() === 'INSIDE THE STRAW');
await page.evaluate(() => window.straw.applySettings({ music: 0.6, sfx: 0.8, mute: false, quality: 'low' }));
check('no audio before interaction', await page.evaluate(() => !window.straw.audio.ready));
await page.click('#btn-play');
check('play starts and audio starts after click', (await info()).state === 'play' && await page.evaluate(() => window.straw.audio.ready));

// keyboard movement
await page.keyboard.down('KeyW'); await wait(1500); await page.keyboard.up('KeyW');
let a = await info(); check('W runs forward', a.s > 5, `s=${a.s.toFixed(1)}`);
await wait(1500); let b = await info(); await wait(500); let c = await info();
check('releasing the key stops (no auto-run)', Math.abs(c.s - b.s) < 0.01);
await page.keyboard.down('KeyD'); await wait(4200); await page.keyboard.up('KeyD');
c = await info(); check('D walks around the wall past the ceiling (wraps)', c.mode === 'ground', `a=${c.a.toFixed(2)}`);
await page.evaluate(() => window.straw.debug.teleport(20, 6.9)); await wait(300);
await page.keyboard.press('Space'); await wait(120); c = await info();
check('Space jumps on the ceiling', c.mode === 'air' && c.h > 0); await wait(1200);
check('lands again on the ceiling', (await info()).mode === 'ground');

// camera continuity through a full lap
await page.evaluate(() => window.straw.debug.teleport(20, 0)); await wait(400);
await page.evaluate(() => { const g = window.straw, cam = g.debug.camera(); window.__maxTurn = 0; let last = cam.quaternion.clone();
  window.__probe = setInterval(() => { const d = last.angleTo(cam.quaternion); if (d > window.__maxTurn) window.__maxTurn = d; last = cam.quaternion.clone(); }, 16); });
await page.keyboard.down('KeyD'); await wait(4000); await page.keyboard.up('KeyD');
const turn = await page.evaluate(() => { clearInterval(window.__probe); return window.__maxTurn; });
check('camera never flips during a full 360 lap', turn < 0.6, `max step ${(turn * 57.3).toFixed(1)} deg`);

// hole -> fail -> respawn
await page.evaluate(() => window.straw.debug.teleport(66, 0)); await wait(300);
await page.keyboard.down('KeyW'); await wait(2600); await page.keyboard.up('KeyW'); await wait(1200);
c = await info(); check('falling through a hole returns to the start/checkpoint', c.retries === 1 && c.mode === 'ground', `s=${c.s.toFixed(1)}`);

// checkpoint, collapse, pause
await page.evaluate(() => window.straw.debug.teleport(103, 0));
await page.keyboard.down('KeyW'); await wait(900); await page.keyboard.up('KeyW');
c = await info(); check('checkpoint 1 reached and the unravelling starts', c.checkpoint === 1 && c.front > 0, `front=${c.front.toFixed(1)}`);
await wait(1000); const f1 = (await info()).front;
await page.keyboard.press('Escape'); await wait(200);
const p1 = await info(); await page.waitForTimeout(1500); const p2 = await info();
check('Esc pauses; the front does not move while paused', p1.state === 'pause' && p1.front === p2.front && p1.front > f1);
await page.keyboard.press('Escape'); await wait(600);
const p3 = await info(); check('Esc resumes; the front moves again', p3.state === 'play' && p3.front > p2.front);

// collapse removes support; respawn is safe
await page.evaluate(() => window.straw.debug.setFront(window.straw.player.s + 3)); await wait(2600);
c = await info(); check('collapse removes support, then respawn at checkpoint with front safely behind', c.retries === 2 && c.mode === 'ground' && c.s - c.front >= 18, `gap=${(c.s - c.front).toFixed(1)}`);
await wait(2500); check('no immediate repeat failure after respawn', (await info()).retries === 2);

// every checkpoint respawns
const cps = await page.evaluate(() => window.straw.world.checkpoints.map((c) => c.s));
let okAll = true;
for (const s of cps) {
  await page.evaluate((s) => window.straw.debug.teleport(s + 0.5, 0), s); await wait(250);
  await page.keyboard.press('Escape'); await wait(150); await page.click('#btn-restart'); await wait(400);
  const i = await info(); if (Math.abs(i.s - s) > 0.6 || i.mode !== 'ground' || i.state !== 'play') { okAll = false; console.log('   bad respawn', s, JSON.stringify(i)); }
}
check(`Restart checkpoint works from all ${cps.length} checkpoints`, okAll);

// resize
await page.setViewportSize({ width: 800, height: 900 }); await wait(400);
const sz = await page.evaluate(() => { const c = document.getElementById('game'), cam = window.straw.debug.camera(); return [c.clientWidth, c.clientHeight, cam.aspect]; });
check('window resize updates canvas and camera', sz[0] === 800 && sz[1] === 900 && Math.abs(sz[2] - 800 / 900) < 1e-3);
await page.setViewportSize({ width: 640, height: 360 });

// simulated micro:bit
await page.evaluate(() => { const g = window.straw, mb = g.input.microbit; mb.simulateAttach(); let s = 0;
  window.__mb = { x: 0, y: 0, a: 0 };
  window.__mbT = setInterval(() => mb.receive(`{"s":${s++ & 65535},"x":${window.__mb.x},"y":${window.__mb.y},"z":-900,"a":${window.__mb.a},"b":0}\n`), 20); });
await page.waitForTimeout(300);
await page.evaluate(() => { window.straw.startRun(); window.straw.debug.teleport(20, 0); window.__mb.y = -500; });   // fresh run: no collapse in play
const m0 = await info(); await wait(1500); const m1 = await info();
check('simulated micro:bit: tilt forward runs', m1.s > m0.s + 3 && await page.evaluate(() => window.straw.input.device === 'microbit'));
await page.evaluate(() => { window.__mb.y = 0; window.__mb.x = 500; }); await wait(1000); const m2 = await info();
check('simulated micro:bit: tilt right moves around the wall', m2.a > m1.a + 1);
await page.evaluate(() => { window.__mb.x = 0; window.__j = 0; const p = window.straw.player; const o = p.step.bind(p); p.step = (dt, c, f) => { if (c.jump) window.__j++; o(dt, c, f); }; window.__mb.a = 1; });
await page.waitForFunction(() => window.straw.input.microbit.buttonA, null, { timeout: 60000 }); // software rendering starves timers: wait for the press to arrive
await wait(1500); const jn = await page.evaluate(() => window.__j); check('button A held for 1.5 s = exactly one jump', jn === 1, `jumps=${jn}`);
await page.evaluate(() => { clearInterval(window.__mbT); }); await page.waitForTimeout(3000);
check('stale data: status drops to no-data and input goes neutral', await page.evaluate(() => window.straw.input.microbit.status === 'no-data' && window.straw.input.microbit.forwardAxis === 0));
await page.evaluate(() => window.straw.input.microbit.simulateLoss()); await page.waitForTimeout(300);
c = await info(); check('disconnect pauses and offers reconnect / keyboard', c.state === 'pause' && c.screen === 'lost' && await page.isVisible('#lost-reconnect') && await page.isVisible('#lost-keyboard'));
await page.click('#lost-keyboard'); await page.click('#btn-resume'); await wait(200);
check('continue with keyboard resumes play', (await info()).state === 'play');

// restart: no duplicate music or listeners
const timers = await page.evaluate(async () => { const g = window.straw; let n = 0; const o = window.setInterval; window.setInterval = (...a) => { n++; return o(...a); };
  for (let i = 0; i < 3; i++) { g.toTitle(); g.startRun(); } window.setInterval = o; return [n, g.audio.timer !== null]; });
check('restarting 3 times leaves a single music scheduler', timers[0] === 3 && timers[1]);
await page.evaluate(() => { window.__j = 0; }); await wait(300); await page.keyboard.press('Space'); await wait(1500); const jk = await page.evaluate(() => window.__j);
check('one jump per key press after restarts (no duplicate key listeners)', jk === 1, `jumps=${jk}`);

// ending
// slide
await page.evaluate(() => { const g = window.straw; g.startRun(); g.debug.teleport(g.route.sheet('SL1').s0 + 2, 0); }); await wait(2500);
c = await info(); check('slide: speed comes from the slope with no input, in a sliding state', c.sliding && c.vu > 5.5, `v=${c.vu.toFixed(1)}`);
// benchmark launch, local event, checkpoint reset
await page.evaluate(() => window.straw.toTitle()); await page.click('#btn-benchmark'); await wait(300);
c = await info(); check('Benchmark button starts at the benchmark checkpoint with the unravelling behind', c.state === 'play' && c.checkpoint === 3 && c.sheet === 'T2' && c.s - c.front > 20);
// local peel event: warning first, then the floor really opens, the fall is explained, and a checkpoint restart restores it
await page.evaluate(() => { const g = window.straw; g.toTitle(); g.startRun(); g.debug.teleport(g.route.sheet('T2').s0 + 4.3, 0); }); await wait(500);
const evq = () => page.evaluate(() => { const g = window.straw, e = g.route.events.find((x) => x.def.id === 'floor1'), sh = g.route.sheet('T2'); return { t: e.t, lift: e.lift, front: e.frontS, s0: e.s0, floor: g.route.solid(sh, 18, 0), wall: g.route.solid(sh, 18, 5), slot: Math.max(...g.world.shared.uEvA.value.map((v) => v.w)) }; });
let ev = await evq();
check('local event: warning phase first (seam lifting, floor still solid, shader fed the same event)', ev.t > 0 && ev.lift > 0 && ev.front === ev.s0 && ev.floor && ev.slot > 0, JSON.stringify(ev));
await wait(2500); ev = await evq();
check('local event: then the floor is really open, and the side wall still holds', ev.front > ev.s0 + 3 && !ev.floor && ev.wall);
await page.evaluate(() => { const g = window.straw; g.debug.teleport(g.route.sheet('T2').s0 + 18, 0); }); await wait(700);
c = await info(); const toast = await page.evaluate(() => document.body.innerText);
check('falling where the strip peeled is detected as "peel" and said in plain words', c.lastFail === 'peel' && /strip peeled away/i.test(toast), `cause=${c.lastFail}`);
await wait(1500); c = await info();
check('quick respawn at the checkpoint, floor restored', c.mode === 'ground' && c.sheet === 'T2' && (await evq()).front === (await evq()).s0, `mode=${c.mode} sheet=${c.sheet}`);
// camera reveals: the traveller stays in frame and the camera keeps the surface below it
for (const [id, u] of [['OPEN', 18], ['SL1', 36], ['WB', 2], ['PAD', 6], ['FAN', 3]]) {
  await page.evaluate(([id, u]) => { const g = window.straw; g.debug.teleport(g.route.sheet(id).s0 + u, 0); }, [id, u]); await wait(900);
  const v = await page.evaluate(() => { const g = window.straw, cam = g.debug.camera(), p = g.debug.playerPos().clone(); const d = p.distanceTo(cam.position); p.project(cam); return { x: p.x, y: p.y, z: p.z, d }; });
  check(`reveal at ${id}: traveller in frame, not too far`, Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8 && v.z < 1 && v.d < 12, `x=${v.x.toFixed(2)} y=${v.y.toFixed(2)} d=${v.d.toFixed(1)}`);
}
await page.keyboard.press('F3'); check('F3 shows the development diagnostics', await page.evaluate(() => /cause|front|sheet/i.test(document.querySelector('#debug')?.textContent ?? ''))); await page.keyboard.press('F3');
await page.evaluate(() => { const g = window.straw; g.startRun(); g.debug.teleport(g.route.sheet('T6').s0 + 26, 0); }); await page.keyboard.down('KeyW'); await wait(6500); await page.keyboard.up('KeyW');
c = await info(); check('reaching the gift shows the ending letter', c.screen === 'ending' && (await page.textContent('#letter-body')).length > 20);
check('interface text contains no Hebrew', !/[֐-׿]/.test(await page.evaluate(() => document.body.innerText)));
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll browser checks passed');
process.exit(failed ? 1 : 0);
