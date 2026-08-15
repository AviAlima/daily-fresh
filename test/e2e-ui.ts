export {};
const { chromium } = require('/Users/avi.alima/.nvm/versions/node/v20.10.0/lib/node_modules/playwright') as { chromium: any };

const URL = 'http://localhost:8457/';
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log('  ok ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function addTask(page: any, text: string) {
  await page.fill('#taskInput', text);
  await page.press('#taskInput', 'Enter');
  await sleep(250);
}

async function openTasks(page: any): Promise<any[]> {
  return page.$$eval('#taskList .task', (els: any[]) => els.map((e: any) => e.querySelector('.task-text').textContent));
}

async function cleanSeed(page: any) {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: any) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d: any) => d.accept());

  await page.goto(URL, { waitUntil: 'networkidle' });
  await cleanSeed(page);
  if (await page.$('#onboardModal:not(.hidden)')) {
    await page.fill('#onboardName', 'E2E');
    await page.click('#onboardStart');
    await sleep(300);
  }

  // ---- Drag reorder (mouse): move C above A ----
  await addTask(page, 'Task A');
  await addTask(page, 'Task B');
  await addTask(page, 'Task C');
  const boxes = await page.$$eval('#taskList .task', (els: any[]) => els.map((e: any) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height };
  }));
  const [a, b, c] = boxes;
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await sleep(450);
  const targetY = a.y - c.h / 2 - 5;
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(c.x, c.y + ((targetY - c.y) * i) / 10, { steps: 2 });
    await sleep(30);
  }
  await sleep(200);
  await page.mouse.up();
  await sleep(300);
  let order = await openTasks(page);
  check('drag reorder moved C to top', order[0] === 'Task C', JSON.stringify(order));

  // persistence after reload
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(300);
  order = await openTasks(page);
  check('reorder persisted after reload', order[0] === 'Task C', JSON.stringify(order));

  // ---- Edit via pencil: rename Task B ----
  const bPencil = await page.$('#taskList .task:has-text("Task B") [data-edit]');
  await bPencil.click();
  await sleep(200);
  await page.fill('#editText', 'Task B edited');
  await page.click('#editSave');
  await sleep(300);
  const ed = await openTasks(page);
  check('edit renames task', ed.includes('Task B edited'), JSON.stringify(ed));
  check('edit modal closed after save', await page.$eval('#editModal', (el: any) => el.classList.contains('hidden')));

  // ---- Postpone via edit modal: Task A -> tomorrow ----
  const aPencil = await page.$('#taskList .task:has-text("Task A") [data-edit]');
  await aPencil.click();
  await sleep(200);
  await page.click('#editPostponeBtn');
  await sleep(200);
  await page.click('#editPostponeRow [data-postpone="tomorrow"]');
  await sleep(300);
  const afterPostpone = await openTasks(page);
  check('postpone removes task from today', !afterPostpone.includes('Task A'), JSON.stringify(afterPostpone));
  check('postpone keeps other tasks', afterPostpone.includes('Task C') && afterPostpone.includes('Task B edited'), JSON.stringify(afterPostpone));

  // ---- Carry: seed a yesterday day, carry it over ----
  await page.evaluate(() => {
    const Logic = (window as any).Logic;
    const now = new Date();
    const resetHour = 5;
    const today = Logic.currentDayKey(now, resetHour);
    const y = Logic.shiftKey(today, -1);
    const yDay = {
      tasks: [{ id: 'y1', text: 'Yesterday chore', done: false, estimate: 0, order: 0, carriedFrom: null, created: '2026-01-01T00:00:00.000Z', doneAt: null, ts: null }, { id: 'y2', text: 'Done yesterday', done: true, doneAt: Date.now(), estimate: 0, order: 1, carriedFrom: null, created: '2026-01-01T00:00:00.000Z', ts: null }],
      note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0
    };
    const todo = { id: 't1', text: 'Planned today', done: false, estimate: 0, order: 0, carriedFrom: null, created: '2026-01-01T00:00:00.000Z', doneAt: null, ts: null };
    const todayDay = { tasks: [todo], note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0 };
    const state = { settings: { resetHour, theme: 'dark', sound: false, name: 'E2E' }, days: { [y]: yDay, [today]: todayDay }, onboarded: true, activeDay: today };
    localStorage.setItem('daily-fresh-state-v2', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(400);
  const badge = await page.$eval('#navToday .carry-count', (el: any) => el ? el.textContent : null).catch(() => null);
  check('carry badge shows 1 candidate', badge === '1', 'badge=' + badge);
  await page.click('#carryToggle');
  await sleep(300);
  await page.click('#carryList [data-carry]');
  await sleep(300);
  const afterCarry = await openTasks(page);
  check('carry moves yesterday chore into today', afterCarry.includes('Yesterday chore'), JSON.stringify(afterCarry));
  check('carried task not duplicated when carried again', await page.$$eval('#taskList .task', (els: any[]) => els.filter((e: any) => e.querySelector('.task-text').textContent === 'Yesterday chore').length) === 1);
  const badgeAfter = await page.$eval('#navToday .carry-count', (el: any) => el ? el.textContent : null).catch(() => null);
  check('carry badge clears after carrying', badgeAfter === null, 'badge=' + badgeAfter);

  console.log('errors:', errors.length ? errors : 'none');
  if (errors.length) { fail++; console.log('  FAIL page errors: ' + errors.join(' | ')); }

  // ---- Mobile: long-press on the task's right edge must NOT be eaten by the modal's X ----
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const mpage = await mctx.newPage();
  mpage.on('pageerror', (e: any) => console.log('  [mobile pageerror] ' + e.message));
  await mpage.goto(URL, { waitUntil: 'networkidle' });
  await cleanSeed(mpage);
  if (await mpage.$('#onboardModal:not(.hidden)')) {
    await mpage.fill('#onboardName', 'Mobile');
    await mpage.click('#onboardStart');
    await sleep(300);
  }
  await addTask(mpage, 'Right edge task');
  const tbox = await mpage.$eval('#taskList .task', (el: any) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const px = tbox.x + tbox.w - 18, py = tbox.y + tbox.h / 2;
  const cdp = await mctx.newCDPSession(mpage);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: py }] });
  await sleep(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  const openAfterRelease = await mpage.$eval('#editModal', (el: any) => !el.classList.contains('hidden'));
  check('long-press at right edge keeps edit open (ghost click on X eaten)', openAfterRelease);
  await mpage.click('#editClose');
  await sleep(300);
  const closedAfterX = await mpage.$eval('#editModal', (el: any) => el.classList.contains('hidden'));
  check('editing closes via the X button', closedAfterX);
  await mctx.close();

  await browser.close();
  console.log(fail === 0 ? '\nE2E-UI PASSED (' + pass + ' checks)' : '\nE2E-UI FAILED (' + fail + ' failed, ' + pass + ' passed)');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e: any) => { console.error('E2E-UI ERROR:', e.message); process.exit(1); });