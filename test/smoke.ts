export {};
const { chromium } = require('/Users/avi.alima/.nvm/versions/node/v20.10.0/lib/node_modules/playwright') as { chromium: any };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: any) => errors.push('pageerror: ' + e.message));
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:8457/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  // onboarding modal -> skip
  await page.fill('#onboardName', 'Avi');
  await page.click('#onboardStart');

  // add tasks
  await page.fill('#taskInput', 'Buy milk 10m');
  await page.press('#taskInput', 'Enter');
  await page.fill('#taskInput', 'Call dentist');
  await page.press('#taskInput', 'Enter');
  await page.waitForTimeout(300);
  const tasks = await page.$$eval('#taskList .task', (els: any[]) => els.map((e: any) => e.querySelector('.task-text').textContent));
  console.log('tasks:', JSON.stringify(tasks));
  if (tasks.length !== 2 || tasks[0] !== 'Buy milk 10m') throw new Error('tasks failed: ' + JSON.stringify(tasks));

  // toggle done -> moves to done list
  await page.click('#taskList .task .check');
  await page.waitForTimeout(200);
  const doneCount = await page.$eval('#doneWrap', (el: any) => !el.classList.contains('hidden'));
  if (!doneCount) throw new Error('done section should be visible');
  const doneText = await page.$$eval('#doneList .task-text', (els: any[]) => els.map((e: any) => e.textContent));
  console.log('done:', JSON.stringify(doneText));

  // estimate chip (task with estimate is in the done list now)
  const est = await page.$$eval('#taskList .est-chip, #doneList .est-chip', (els: any[]) => els.map((e: any) => e.textContent));
  console.log('estimates:', JSON.stringify(est));
  if (!est.length || est[0] !== '~10m') throw new Error('estimate missing');

  // settings view
  await page.click('#navSettings');
  await page.waitForTimeout(200);
  const syncVisible = await page.$eval('#syncRow', (el: any) => !el.classList.contains('hidden'));
  console.log('syncRow visible (config present):', syncVisible);
  if (!syncVisible) throw new Error('sync row should be visible with config');
  const pairVisible = await page.$eval('#syncPairWrap', (el: any) => el.style.display !== 'none');
  if (!pairVisible) throw new Error('pair input should be visible when unpaired');

  // version
  const ver = await page.$eval('#appVersion', (el: any) => el.textContent);
  console.log('version:', ver);
  if (ver !== 'v79') throw new Error('version mismatch: ' + ver);

  // interface: zen default, all four modes switch and persist
  const uiDefault = await page.evaluate(() => ({
    ui: document.documentElement.dataset.ui,
    v2live: !(document.getElementById('v2css') as any).disabled,
    dashHidden: document.getElementById('dashStrip')!.classList.contains('hidden')
  }));
  console.log('interface default:', JSON.stringify(uiDefault));
  if (uiDefault.ui !== 'zen' || !uiDefault.v2live || !uiDefault.dashHidden) throw new Error('zen should be the default: ' + JSON.stringify(uiDefault));
  await page.click('#navSettings');
  await page.waitForTimeout(200);
  await page.click('#uiDashBtn');
  await page.waitForTimeout(200);
  const uiDash = await page.evaluate(() => ({
    ui: document.documentElement.dataset.ui,
    stripVisible: !document.getElementById('dashStrip')!.classList.contains('hidden'),
    cells: document.querySelectorAll('.dash-cell').length,
    stored: localStorage.getItem('daily-fresh-ui')
  }));
  console.log('interface after dashboard:', JSON.stringify(uiDash));
  if (uiDash.ui !== 'dashboard' || uiDash.cells < 3) throw new Error('dashboard toggle failed: ' + JSON.stringify(uiDash));
  await page.click('#uiFocusBtn');
  await page.waitForTimeout(200);
  const uiFocus = await page.evaluate(() => document.documentElement.dataset.ui);
  if (uiFocus !== 'focus') throw new Error('focus switch failed: ' + uiFocus);
  await page.click('#uiClassicBtn');
  await page.waitForTimeout(200);
  const uiClassic = await page.evaluate(() => ({
    ui: document.documentElement.dataset.ui,
    v2off: (document.getElementById('v2css') as any).disabled,
    stored: localStorage.getItem('daily-fresh-ui')
  }));
  console.log('interface after classic:', JSON.stringify(uiClassic));
  if (uiClassic.ui !== 'classic' || !uiClassic.v2off || uiClassic.stored !== 'classic') throw new Error('classic toggle failed: ' + JSON.stringify(uiClassic));
  await page.click('#uiZenBtn');
  await page.waitForTimeout(200);
  const uiBack = await page.evaluate(() => ({ ui: document.documentElement.dataset.ui, v2on: !(document.getElementById('v2css') as any).disabled }));
  if (uiBack.ui !== 'zen' || !uiBack.v2on) throw new Error('switching back to zen failed');
  await page.reload({ waitUntil: 'networkidle' });
  const uiPersisted = await page.evaluate(() => document.documentElement.dataset.ui);
  if (uiPersisted !== 'zen') throw new Error('ui preference did not persist across reload: ' + uiPersisted);

  // history view
  await page.click('#navHistory');
  await page.waitForTimeout(200);
  const historyVisible = await page.$eval('#historyList', (el: any) => el.children.length >= 1);
  console.log('history card rendered:', historyVisible);

  // reload persistence
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const persisted = await page.$$eval('#taskList .task', (els: any[]) => els.length);
  const persistedDone = await page.$$eval('#doneList .task', (els: any[]) => els.length);
  console.log('persisted open/done:', persisted, persistedDone);
  if (persisted !== 1 || persistedDone !== 1) throw new Error('persistence failed');

  console.log('errors:', errors.length ? errors : 'none');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('SMOKE TEST PASSED');
  await browser.close();
})().catch((e: any) => { console.error('SMOKE TEST FAILED:', e.message); process.exit(1); });
