const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = 8082;
const BASE_URL = `http://localhost:${PORT}`;
const RESULTS = {
  passed: [],
  failed: [],
  manual: [],
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServer() {
  console.log(`Starting server on port ${PORT}...`);
  return new Promise((resolve, reject) => {
    const server = spawn('python3', ['-m', 'http.server', PORT.toString()], {
      cwd: '/Users/nitzanwilnai/Programming/Claude/JSGames/ProceduralTerrain3D',
    });

    server.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Serving HTTP')) {
        console.log('Server started');
        resolve(server);
      }
    });

    server.on('error', reject);
    setTimeout(() => resolve(server), 3000);
  });
}

async function stopServer(server) {
  return new Promise((resolve) => {
    server.kill();
    setTimeout(resolve, 1000);
  });
}

async function checkPageForErrors(page, seed) {
  const errors = [];
  const logs = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
      logs.push(`[ERROR] ${msg.text()}`);
    } else {
      logs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  page.on('error', (err) => {
    errors.push(err.message);
    logs.push(`[PAGE ERROR] ${err.message}`);
  });

  page.on('pageerror', (err) => {
    errors.push(err.message);
    logs.push(`[PAGE ERROR] ${err.message}`);
  });

  return { errors, logs };
}

async function takeScreenshot(page, seed) {
  const filename = `/tmp/smoke-${seed}.png`;
  await page.screenshot({ path: filename });
  return filename;
}

async function getFileSize(filepath) {
  try {
    const stats = fs.statSync(filepath);
    return stats.size;
  } catch {
    return 0;
  }
}

async function hashFile(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function test1LoadAndRender(browser) {
  console.log('\n=== TEST 1: Game loads and renders without console errors ===');
  const seeds = ['hello', 'world', '42'];
  const results = [];

  for (const seed of seeds) {
    console.log(`\nTesting seed: ${seed}`);
    const page = await browser.newPage();

    const errorInfo = await checkPageForErrors(page, seed);

    try {
      await page.goto(`${BASE_URL}/?seed=${seed}&capture=1`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      await sleep(5000);

      const screenshot = await takeScreenshot(page, seed);
      const size = await getFileSize(screenshot);

      const passed = errorInfo.errors.length === 0 && size > 50000;
      results.push({
        seed,
        errorCount: errorInfo.errors.length,
        screenshotSize: size,
        passed,
        errors: errorInfo.errors,
      });

      console.log(`  Errors: ${errorInfo.errors.length}`);
      console.log(`  Screenshot size: ${size} bytes`);
      console.log(`  Status: ${passed ? 'PASS' : 'FAIL'}`);

      if (!passed) {
        if (errorInfo.errors.length > 0) {
          console.log(`  Errors: ${errorInfo.errors.join(', ')}`);
        }
        if (size <= 50000) {
          console.log(`  Screenshot too small: ${size} <= 50000`);
        }
      }
    } catch (err) {
      console.log(`  FAIL: ${err.message}`);
      results.push({
        seed,
        errorCount: -1,
        screenshotSize: 0,
        passed: false,
        errors: [err.message],
      });
    } finally {
      await page.close();
    }
  }

  const allPassed = results.every(r => r.passed);
  if (allPassed) {
    RESULTS.passed.push('Game loads and renders without errors (all 3 seeds)');
  } else {
    const failures = results.filter(r => !r.passed).map(r => `seed=${r.seed}`).join(', ');
    RESULTS.failed.push(`Game loads - failures: ${failures}`);
  }
}

async function test2SeedDeterminism(browser) {
  console.log('\n=== TEST 2: Seed determinism ===');
  const seed = 'det1';
  const screenshots = [];

  for (let i = 0; i < 2; i++) {
    console.log(`\nLoad ${i + 1} of 2...`);
    const page = await browser.newPage();

    await checkPageForErrors(page, `${seed}-${i}`);

    try {
      await page.goto(`${BASE_URL}/?seed=${seed}&capture=1`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      await sleep(5000);

      const screenshot = await takeScreenshot(page, `${seed}-${i}`);
      const size = await getFileSize(screenshot);
      screenshots.push({ screenshot, size });

      console.log(`  Screenshot size: ${size} bytes`);
    } catch (err) {
      console.log(`  FAIL: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  if (screenshots.length === 2) {
    const size1 = screenshots[0].size;
    const size2 = screenshots[1].size;
    const diff = Math.abs(size1 - size2) / size1;
    const withinTolerance = diff <= 0.05;

    console.log(`\nSize comparison:`);
    console.log(`  Screenshot 1: ${size1} bytes`);
    console.log(`  Screenshot 2: ${size2} bytes`);
    console.log(`  Difference: ${(diff * 100).toFixed(1)}%`);
    console.log(`  Within 5% tolerance: ${withinTolerance ? 'YES' : 'NO'}`);

    if (withinTolerance) {
      RESULTS.passed.push('Seed determinism check (within 5% tolerance)');
    } else {
      RESULTS.failed.push(`Seed determinism - size diff ${(diff * 100).toFixed(1)}%`);
    }
  } else {
    RESULTS.failed.push('Seed determinism - could not capture screenshots');
  }
}

async function test3StyleSwitch(browser) {
  console.log('\n=== TEST 3: Style switch without errors ===');
  const page = await browser.newPage();

  const errorInfo = await checkPageForErrors(page, 'ss1');

  try {
    // Load with lowpoly style
    await page.goto(`${BASE_URL}/?seed=ss1`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    await sleep(3000);
    const screenshot1 = await takeScreenshot(page, 'ss1-lowpoly');
    const size1 = await getFileSize(screenshot1);

    // Switch to realistic style
    await page.evaluate(() => {
      localStorage.setItem('terrain.style', 'realistic');
    });

    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(3000);
    const screenshot2 = await takeScreenshot(page, 'ss1-realistic');
    const size2 = await getFileSize(screenshot2);

    const differentSizes = Math.abs(size1 - size2) > 100;
    const noErrors = errorInfo.errors.length === 0;
    const passed = differentSizes && noErrors;

    console.log(`\nLowpoly screenshot: ${size1} bytes`);
    console.log(`Realistic screenshot: ${size2} bytes`);
    console.log(`Screenshots differ: ${differentSizes ? 'YES' : 'NO'}`);
    console.log(`No errors: ${noErrors ? 'YES' : 'NO'}`);
    console.log(`Status: ${passed ? 'PASS' : 'FAIL'}`);

    if (passed) {
      RESULTS.passed.push('Style switch works without errors');
    } else {
      const reasons = [];
      if (!differentSizes) reasons.push('styles not visually different');
      if (!noErrors) reasons.push(`${errorInfo.errors.length} errors`);
      RESULTS.failed.push(`Style switch - ${reasons.join(', ')}`);
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    RESULTS.failed.push(`Style switch - ${err.message}`);
  } finally {
    await page.close();
  }
}

async function main() {
  let server;
  let browser;

  try {
    server = await startServer();
    await sleep(2000);

    browser = await puppeteer.launch({ headless: true });

    await test1LoadAndRender(browser);
    await test2SeedDeterminism(browser);
    await test3StyleSwitch(browser);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (browser) await browser.close();
    if (server) await stopServer(server);

    console.log('\n========== RESULTS ==========');
    console.log('\n✅ PASSED:');
    RESULTS.passed.forEach(r => console.log(`  - ${r}`));

    if (RESULTS.failed.length > 0) {
      console.log('\n❌ FAILED:');
      RESULTS.failed.forEach(r => console.log(`  - ${r}`));
    }

    if (RESULTS.manual.length > 0) {
      console.log('\n⏸ MANUAL:');
      RESULTS.manual.forEach(r => console.log(`  - ${r}`));
    }

    process.exit(RESULTS.failed.length > 0 ? 1 : 0);
  }
}

main();
