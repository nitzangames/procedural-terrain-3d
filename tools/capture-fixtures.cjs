const puppeteer = require('/usr/local/lib/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  // Visit the origin once to make localStorage available
  await page.goto('http://localhost:8081/', { waitUntil: 'load' });
  for (const style of ['lowpoly', 'stylized', 'realistic']) {
    await page.evaluate(s => localStorage.setItem('terrain.style', s), style);
    await page.goto('http://localhost:8081?seed=fixture42', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: `screenshots/style-${style}.png` });
    console.log('captured', style);
  }
  await browser.close();
})();
