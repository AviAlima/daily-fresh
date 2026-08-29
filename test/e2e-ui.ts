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

  // ---- Bring-all with an origin AND its carried copy must not duplicate (root-based guard) ----
  await page.evaluate(() => {
    const Logic = (window as any).Logic;
    const resetHour = 5;
    const today = Logic.currentDayKey(new Date(), resetHour);
    const y = Logic.shiftKey(today, -1);
    const o = Logic.shiftKey(today, -2);
    const origin = { id: 'orig', text: 'Stacked task', done: false, estimate: 0, order: 0, carriedFrom: null, created: '2026-01-01T00:00:00.000Z', doneAt: null, ts: null };
    const copy = { id: 'c1', text: 'Stacked task', done: false, estimate: 0, order: 0, carriedFrom: { day: o, id: 'orig' }, created: '2026-01-01T00:00:00.000Z', doneAt: null, ts: null };
    const mkDay = (tasks: any[]) => ({ tasks, note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0 });
    const state = { settings: { resetHour, theme: 'dark', sound: false, name: 'E2E' }, days: { [o]: mkDay([origin]), [y]: mkDay([copy]), [today]: mkDay([]) }, onboarded: true, activeDay: today };
    localStorage.setItem('daily-fresh-state-v2', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(400);
  const stackedBadge = await page.$eval('#navToday .carry-count', (el: any) => el ? el.textContent : null).catch(() => null);
  check('only the newest copy of the chain is offered (1 candidate)', stackedBadge === '1', 'badge=' + stackedBadge);
  await page.click('#carryToggle');
  await sleep(250);
  await page.click('#carryAll');
  await sleep(400);
  const stackedCount = await page.$$eval('#taskList .task', (els: any[]) => els.filter((e: any) => e.querySelector('.task-text').textContent === 'Stacked task').length);
  check('bring-all of a chain creates exactly one task', stackedCount === 1, 'count=' + stackedCount);

  // ---- Postpone then Undo: the copy must not survive in tomorrow ----
  await page.evaluate(() => {
    const Logic = (window as any).Logic;
    const resetHour = 5;
    const today = Logic.currentDayKey(new Date(), resetHour);
    const y = Logic.shiftKey(today, -1);
    const mkDay = (tasks: any[]) => ({ tasks, note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0 });
    const task = { id: 'pt1', text: 'Postponed chore', done: false, estimate: 0, order: 0, carriedFrom: null, created: '2026-01-01T00:00:00.000Z', doneAt: null, ts: null };
    const state = { settings: { resetHour, theme: 'dark', sound: false, name: 'E2E' }, days: { [y]: mkDay([task]), [today]: mkDay([]) }, onboarded: true, activeDay: today };
    localStorage.setItem('daily-fresh-state-v2', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(400);
  await page.click('#carryToggle');
  await sleep(250);
  await page.click('#carryList [data-carry]');
  await sleep(300);
  await page.click('#taskList .task:has-text("Postponed chore") [data-edit]');
  await sleep(200);
  await page.click('#editPostponeBtn');
  await sleep(200);
  await page.click('#editPostponeRow [data-postpone="tomorrow"]');
  await sleep(400);
  const postponedGone = await openTasks(page);
  check('postpone moved the task out of today', !postponedGone.includes('Postponed chore'), JSON.stringify(postponedGone));
  await page.click('#toast .toast-act');
  await sleep(400);
  const undoneBack = await openTasks(page);
  check('undo brings the postponed task back to today', undoneBack.includes('Postponed chore'), JSON.stringify(undoneBack));
  const copyStranded = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('daily-fresh-state-v2') || '{}');
    const Logic = (window as any).Logic;
    const tomorrow = Logic.shiftKey(Logic.currentDayKey(new Date(), 5), 1);
    const d = s.days && s.days[tomorrow];
    return d ? (d.tasks || []).filter((t: any) => t.text === 'Postponed chore').length : 0;
  });
  check('undo removes the stranded copy from tomorrow', copyStranded === 0, 'copies=' + copyStranded);
  const copyTombstoned = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('daily-fresh-state-v2') || '{}');
    const Logic = (window as any).Logic;
    const tomorrow = Logic.shiftKey(Logic.currentDayKey(new Date(), 5), 1);
    const d = s.days && s.days[tomorrow];
    return d ? (d.tombstones || []).length : 0;
  });
  check('the undone copy is tombstoned (sync cannot resurrect it)', copyTombstoned >= 1, 'tombstones=' + copyTombstoned);

  // ---- A carry whose text already exists open in today is not offered (dedupe would bounce it) ----
  await page.evaluate(() => {
    const Logic = (window as any).Logic;
    const resetHour = 5;
    const today = Logic.currentDayKey(new Date(), resetHour);
    const y = Logic.shiftKey(today, -1);
    const o = Logic.shiftKey(today, -2);
    const mkDay = (tasks: any[]) => ({ tasks, note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0 });
    const state = {
      settings: { resetHour, theme: 'dark', sound: false, name: 'E2E' },
      days: {
        [o]: mkDay([{ id: 'orig2', text: 'Doubled task', done: false, estimate: 0, order: 0, carriedFrom: null, created: '2026-01-01T00:00:00.000Z', doneAt: null, ts: null }]),
        [y]: mkDay([{ id: 'c9', text: 'Doubled task', done: false, estimate: 0, order: 0, carriedFrom: { day: o, id: 'orig2' }, created: '2026-01-01T00:00:00.000Z', doneAt: null, ts: null }]),
        [today]: mkDay([{ id: 'stale9', text: 'Doubled task', done: false, estimate: 0, order: 0, carriedFrom: null, created: '2026-01-01T00:00:00.000Z', doneAt: null, ts: null }])
      },
      onboarded: true, activeDay: today
    };
    localStorage.setItem('daily-fresh-state-v2', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(400);
  const doubledBadge = await page.$eval('#navToday .carry-count', (el: any) => el ? el.textContent : null).catch(() => null);
  check('carry list hides a task already open in today (no bounce)', doubledBadge === null, 'badge=' + doubledBadge);
  await page.click('#carryAll').catch(() => {});
  await sleep(300);
  const doubledCount = await page.$$eval('#taskList .task', (els: any[]) => els.filter((e: any) => e.querySelector('.task-text').textContent === 'Doubled task').length);
  check('no duplicate created by bring-all when text already open', doubledCount === 1, 'count=' + doubledCount);

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

  // ---- WhatsApp-style keyboard drag-dismiss on the mobile context ----
  // Synthetic TouchEvents (Chromium's native tap-outside blur would mask the
  // gesture logic with real CDP touches).
  await mpage.evaluate(() => { document.body.classList.add('keyboard-open'); });
  await mpage.fill('#taskInput', 'Gesture task'); await mpage.press('#taskInput', 'Enter'); await sleep(300);
  const focusAndTrack = async () => {
    await mpage.focus('#taskInput');
    await mpage.evaluate(() => {
      (window as any).__log = [];
      document.addEventListener('focusout', (e: any) => {
        (window as any).__log.push('out:' + (e.target.id || e.target.tagName));
      }, true);
    });
  };
  const focused = () => mpage.evaluate(() => (document.activeElement as HTMLElement)?.id || (document.activeElement as HTMLElement)?.tagName || 'none');
  const swipe = (from: { x: number; y: number }, path: Array<[number, number]>) => mpage.evaluate(([from, path]: any) => {
    function fire(type: string, x: number, y: number) {
      const tgt = document.elementFromPoint(x, y) || document.body;
      const t = new Touch({ identifier: 1, target: tgt, clientX: x, clientY: y });
      tgt.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    }
    fire('touchstart', from[0] !== undefined ? from[0] : from.x, from[1] !== undefined ? from[1] : from.y);
    (path as Array<[number, number]>).forEach(([x, y]) => fire('touchmove', x, y));
    fire('touchend', 0, 0);
    return (document.querySelector('.app') as HTMLElement).style.transform;
  }, [from, path] as any);
  const ptAt = (x: number, y: number) => mpage.evaluate(([x, y]: any) => {
    const el = document.elementFromPoint(x, y);
    return { x, y, on: el ? (el.closest('.task') ? 'task' : (el.id || el.className || el.tagName)) : 'none' };
  }, [x, y] as any) as any;
  // locate a background point (below the last task)
  const bg = await mpage.evaluate(() => {
    const els = Array.from(document.querySelectorAll('#taskList .task'));
    const last = els[els.length - 1] as HTMLElement;
    return { y: Math.round(last.getBoundingClientRect().bottom + 60) };
  });
  // 1) small drag below ~0.75cm (44px) → snaps back, keyboard stays
  await focusAndTrack();
  await swipe({ x: 300, y: bg.y - 40 }, [[300, bg.y - 30], [300, bg.y - 20], [300, bg.y - 10], [300, bg.y - 10]]);
  let st1 = await focused();
  check('small drag snaps back (keyboard stays)', st1 === 'taskInput', st1);
  // 2) long drag (>= 44px) → dismisses
  await focusAndTrack();
  await swipe({ x: 300, y: bg.y - 40 }, [[300, bg.y], [300, bg.y + 20], [300, bg.y + 10], [300, bg.y + 20]]);
  let st2 = await focused();
  check('long drag past ~0.75cm dismisses the keyboard', st2 !== 'taskInput', st2);
  // 3) horizontal move from background → no dismiss
  await focusAndTrack();
  await swipe({ x: 150, y: bg.y }, [[210, bg.y], [240, bg.y], [260, bg.y], [260, bg.y]]);
  const st3 = await focused();
  check('horizontal drag does not dismiss', st3 === 'taskInput', st3);
  // 4) drag starting on a task is ignored (belongs to reorder/long-press)
  await focusAndTrack();
  const ty = await mpage.evaluate(() => {
    const r = document.querySelector('#taskList .task')!.getBoundingClientRect();
    return Math.round(r.top + r.height / 2);
  });
  await swipe({ x: 200, y: ty }, [[200, ty + 12], [200, ty + 30], [200, ty + 50], [200, ty + 70]]);
  const st4 = await focused();
  check('drag starting on a task does not dismiss', st4 === 'taskInput', st4);
  // 5) tap on the content closes the keyboard
  await focusAndTrack();
  await swipe({ x: 200, y: ty }, []);
  const st4b = await focused();
  check('tap on the content closes the keyboard', st4b !== 'taskInput', st4b);
  // 6) the + button closes the keyboard after adding
  await focusAndTrack();
  await mpage.fill('#taskInput', 'Plus close'); await mpage.click('#addBtn'); await sleep(300);
  const st5 = await focused();
  check('+ closes the keyboard after adding', st5 !== 'taskInput', st5);
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