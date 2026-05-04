const puppeteer = require('/usr/local/lib/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  // Square 600×600 thumbnail per platform convention
  await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });
  // Visit origin once so localStorage exists for setItem
  await page.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('terrain.style', 'lowpoly'));
  await page.goto('http://localhost:8080?seed=thumbnail99', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: '/Users/nitzanwilnai/Programming/Claude/JSGames/ProceduralTerrain3D/thumbnail.png' });
  await browser.close();
})();
