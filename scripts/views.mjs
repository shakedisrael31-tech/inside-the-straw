// Screenshots of chosen spots, for checking the look:
//   node scripts/views.mjs out "name:sheetId:u:a[:secondsToWait[:frontOffset]]" ...
// A positive wait lets authored events play; frontOffset places the unravelling that far behind.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [out = 'view', ...views] = process.argv.slice(2);
const dir = process.env.SHOTS ?? '/tmp/shots'; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = new Set();
page.on('console', (m) => { if (m.type() === 'error') errors.add(m.text()); });
page.on('pageerror', (e) => errors.add('pageerror: ' + e.message));
await page.goto(process.env.URL ?? 'http://localhost:5173/');
await page.waitForFunction(() => !!window.straw, null, { timeout: 90000 });
await page.evaluate(() => window.straw.startRun());
const files = [];
for (const v of views) {
  const [name, sheet, u, a = '0', wait = '0', front] = v.split(':');
  await page.evaluate(([sheet, u, a, wait, front]) => {
    const g = window.straw, s = g.route.sheet(sheet).s0 + +u;
    g.route.resetEvents(0); g.front.reset(); g.debug.teleport(s, +a);
    if (front) g.debug.setFront(s - +front);
    window.__until = g.debug.info().sim + +wait;
  }, [sheet, u, a, wait, front]);
  await page.waitForFunction(() => window.straw.debug.info().sim >= window.__until, null, { timeout: 120000, polling: 50 });
  await page.evaluate(() => { const g = window.straw; g.pause(); g.ui.show(null); });
  await page.waitForTimeout(700);
  const f = `${dir}/${out}-${name}.png`; await page.screenshot({ path: f }); files.push(f);
  await page.evaluate(() => { const g = window.straw; g.resume(); });
}
console.log(files.join(' '));
if (errors.size) console.log([...errors].slice(0, 8).join('\n'));
await browser.close();
