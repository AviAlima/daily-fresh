export {};
const { chromium } = require('/Users/avi.alima/.nvm/versions/node/v20.10.0/lib/node_modules/playwright') as { chromium: any };

const URL = 'http://localhost:8457/';
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log('  ok ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Device { ctx: any; page: any; label: string; }

async function newDevice(browser: any, label: string): Promise<Device> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => console.log('  [' + label + ' pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.$('#onboardModal:not(.hidden)')) {
    await page.fill('#onboardName', label);
    await page.click('#onboardStart');
  }
  return { ctx, page, label };
}

async function addTask(page: any, text: string) {
  await page.fill('#taskInput', text);
  await page.press('#taskInput', 'Enter');
  await sleep(300);
}

async function openTasks(page: any): Promise<any[]> {
  return page.$$eval('#taskList .task', (els: any[]) => els.map((e: any) => e.querySelector('.task-text').textContent));
}
async function doneTasks(page: any): Promise<any[]> {
  await page.click('#doneToggle', { force: true }).catch(() => {});
  await sleep(200);
  return page.$$eval('#doneList .task', (els: any[]) => els.map((e: any) => e.querySelector('.task-text').textContent));
}

(async () => {
  const browser = await chromium.launch();

  // ---- Desktop: start sync, get code ----
  const desk = await newDevice(browser, 'Desktop');
  await desk.page.click('#navSettings');
  await sleep(300);
  const startBtn = await desk.page.$('#syncStart');
  if (!startBtn) { console.log('FAIL: sync section not rendered'); process.exit(1); }
  await desk.page.click('#syncStart');
  await sleep(7000);
  const code = await desk.page.$eval('#syncCode', (el: any) => el.textContent.trim());
  console.log('sync code:', code);
  check('code generated (12 chars)', /^[A-Z2-9]{12}$/.test(code), code);

  // ---- Phone: pair with the code ----
  const ph = await newDevice(browser, 'Phone');
  await ph.page.click('#navSettings');
  await sleep(300);
  await ph.page.fill('#syncInput', code);
  await ph.page.click('#syncPairBtn');
  await sleep(3000);
  const phPaired = await ph.page.$eval('#syncBody', (el: any) => !el.classList.contains('hidden'));
  check('phone paired', phPaired);

  // ---- Desktop adds a task -> appears on phone ----
  await desk.page.click('#navToday');
  await addTask(desk.page, 'E2E sync task A');
  await sleep(4000);
  const phTasks = await openTasks(ph.page);
  check('task A synced phone<-desktop', phTasks.includes('E2E sync task A'), JSON.stringify(phTasks));

  // ---- Phone toggles done -> desktop sees it ----
  await ph.page.click('#navToday');
  await sleep(300);
  const phCheck = await ph.page.$('#taskList .task .check');
  await phCheck.click();
  await sleep(4000);
  const deskDone = await doneTasks(desk.page);
  check('done state synced desktop<-phone', deskDone.includes('E2E sync task A'), JSON.stringify(deskDone));

  // ---- Concurrent adds from both sides ----
  await addTask(desk.page, 'From desktop B');
  await addTask(ph.page, 'From phone C');
  await sleep(4000);
  const deskTasks = await openTasks(desk.page);
  check('concurrent adds both survive on desktop', deskTasks.includes('From desktop B') && deskTasks.includes('From phone C'), JSON.stringify(deskTasks));

  // ---- Delete on phone -> stays deleted on desktop (tombstone) ----
  const delBtn = await ph.page.$('#taskList .task:has-text("From desktop B") .del');
  await delBtn.click();
  await sleep(4000);
  const deskAfterDel = await openTasks(desk.page);
  const deskDone2 = await doneTasks(desk.page);
  check('delete synced (tombstone) desktop', !deskAfterDel.includes('From desktop B') && !deskDone2.includes('From desktop B'), JSON.stringify({ open: deskAfterDel, done: deskDone2 }));

  // ---- Offline: phone adds, desktop is offline... test offline queue on phone ----
  await ph.ctx.setOffline(true);
  await sleep(500);
  await addTask(ph.page, 'Offline task');
  await sleep(1000);
  const deskBeforeOnline = await openTasks(desk.page);
  check('offline add not yet on desktop', !deskBeforeOnline.includes('Offline task'), JSON.stringify(deskBeforeOnline));
  await ph.ctx.setOffline(false);
  await sleep(6000);
  const deskAfterOnline = await openTasks(desk.page);
  check('offline add flushed on reconnect', deskAfterOnline.includes('Offline task'), JSON.stringify(deskAfterOnline));

  // ---- resetHour syncs across devices ----
  const nowHour = new Date().getHours();
  await desk.page.click('#navSettings');
  await sleep(300);
  await desk.page.selectOption('#resetHour', String(nowHour));
  await sleep(5000);
  const phHour = await ph.page.$eval('#resetHour', (el: any) => el.value);
  check('resetHour synced phone<-desktop', phHour === String(nowHour), 'desktop=' + nowHour + ' phone=' + phHour);

  // ---- Cleanup test data ----
  await desk.page.click('#navSettings');
  await sleep(300);
  await desk.page.click('#syncUnpair');
  await sleep(500);
  await desk.ctx.close();
  await ph.ctx.close();
  await browser.close();

  console.log(fail === 0 ? '\nE2E PASSED (' + pass + ' checks)' : '\nE2E FAILED (' + fail + ' failed, ' + pass + ' passed)');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e: any) => { console.error('E2E ERROR:', e.message); process.exit(1); });
