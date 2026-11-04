export {};
const assert = require('assert');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/avi.alima/.nvm/versions/node/v20.10.0/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.route('**/dist/app.js', async (route: any) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: 'window.Sync.init = function(options) { window.__onRemote = options.onRemote; };\n' + await response.text() });
    });
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:8457/');
    await page.fill('#onboardName', 'Motion test');
    await page.click('#onboardStart');
    await page.fill('#taskInput', 'First task');
    await page.press('#taskInput', 'Enter');
    await page.evaluate(() => { (window as any).originalRow = document.querySelector('#taskList .task'); });
    await page.fill('#taskInput', 'Second task');
    await page.press('#taskInput', 'Enter');
    assert.ok(await page.evaluate(() => (window as any).originalRow === document.querySelector('#taskList .task')));
    console.log('PASS unchanged rows retain their DOM identity across renders');
    const box = await page.locator('#taskList .task').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForSelector('.task.armed');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 22);
    await page.waitForSelector('.task.dragging');
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('daily-fresh-state-v2')!);
      const day: any = Object.values(state.days).find((day: any) => day.tasks.length === 2);
      day.tasks[1].text = 'Updated from another device';
      localStorage.setItem('daily-fresh-state-v2', JSON.stringify(state));
      (window as any).__onRemote();
    });
    assert.ok(await page.evaluate(() => (window as any).originalRow.isConnected && (window as any).originalRow.classList.contains('dragging')));
    await page.mouse.up();
    assert.ok((await page.locator('#taskList').textContent()).includes('Updated from another device'));
    console.log('PASS remote updates preserve the dragged row and appear after release');

    await page.click('#navSettings');
    await page.locator('summary').filter({ hasText: 'Appearance' }).click();
    await page.locator('label[for="motionToggle"]').click();
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'off');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'off');
    await page.locator('#taskList [data-check]').first().click();
    assert.equal(await page.locator('#taskList .task').count(), 1);
    assert.equal(await page.locator('.task.completing').count(), 0);
    console.log('PASS motion preference persists and completion has no artificial delay when off');
    await page.click('#navSettings');
    await page.locator('summary').filter({ hasText: 'Appearance' }).click();
    await page.locator('label[for="motionToggle"]').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.documentElement.dataset.motion === 'off');
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'off');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.documentElement.dataset.motion === 'on');
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'on');
    await page.locator('label[for="motionToggle"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/daily-fresh-motion-settings.png' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.click('#navToday');
    await page.locator('#taskList [data-check]').first().click();
    assert.equal(await page.locator('.task.completing').count(), 1);
    await page.waitForFunction(() => document.querySelectorAll('.task.completing').length === 0);
    assert.equal(await page.locator('#taskList .task').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS live reduced-motion changes, mobile layout, and animated completion');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
