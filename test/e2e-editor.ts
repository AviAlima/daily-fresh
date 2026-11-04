export {};
const assert = require('assert');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/avi.alima/.nvm/versions/node/v20.10.0/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:8457/');
    await page.fill('#onboardName', 'Editor test');
    await page.click('#onboardStart');
    await page.fill('#taskInput', 'Original 15m');
    await page.press('#taskInput', 'Enter');
    await page.click('[data-edit]');
    await page.fill('#editText', 'Updated 30m');
    await page.click('#editPostponeBtn');
    await page.click('[data-postpone="tomorrow"]');
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('daily-fresh-state-v2')!));
    const tasks = Object.values(state.days).flatMap((d: any) => d.tasks);
    assert.equal(tasks.length, 1);
    assert.equal((tasks[0] as any).text, 'Updated 30m');
    assert.equal((tasks[0] as any).estimate, 30);
    console.log('PASS postponing preserves edited text and estimate');

    await page.fill('#taskInput', 'Another 10m');
    await page.press('#taskInput', 'Enter');
    await page.click('[data-edit]');
    await page.fill('#editText', 'Draft 45m');
    page.once('dialog', (dialog: any) => dialog.dismiss());
    await page.click('#editClose');
    assert.equal(await page.locator('#editModal').isVisible(), true);
    assert.equal(await page.inputValue('#editText'), 'Draft 45m');
    await page.click('#editSave');
    assert.equal(await page.locator('#editModal').isVisible(), false);
    assert.equal(await page.locator('#taskList .est-chip').textContent(), '~45m');
    await page.click('[data-edit]');
    await page.fill('#editText', 'No estimate');
    await page.click('#editSave');
    assert.equal(await page.locator('#taskList .est-chip').count(), 0);
    console.log('PASS canceled discard retains draft; save updates and clears estimates');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
