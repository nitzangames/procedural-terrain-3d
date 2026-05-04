const puppeteer = require('/usr/local/lib/node_modules/puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
  const errors = [];
  const consoleLogs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('http://localhost:8765?seed=42', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 5000));
  const title = await page.title();
  const canvasExists = await page.evaluate(() => !!document.getElementById('game'));
  await page.screenshot({ path: '/tmp/terrain-smoke.png' });
  // Sample center pixel for non-blackness
  const colorSum = await page.evaluate(() => {
    const c = document.getElementById('game');
    if (!c) return -2;
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return -1;
    // Force a pixel readback at frame draw time
    const px = new Uint8Array(4);
    ctx.readPixels(c.width / 2, c.height / 2, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    return px[0] + px[1] + px[2];
  });
  console.log(JSON.stringify({ title, canvasExists, colorSum, errorCount: errors.length, errors, consoleLogs: consoleLogs.slice(0, 20) }));
  await browser.close();
})();
