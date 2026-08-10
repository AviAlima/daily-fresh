import * as assert from 'assert';

(global as any).localStorage = {
  _d: {} as Record<string, string>,
  getItem(k: string) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem(k: string, v: string) { this._d[k] = String(v); },
  removeItem(k: string) { delete this._d[k]; }
};
(global as any).window = { addEventListener() {} };

const S = require('../../dist/sync.js') as SyncModule;

const T = (id: string, text: string, ts?: TsMap): TaskShape & { ts: TsMap } => ({
  id, text, done: false, estimate: 0, order: 0,
  carriedFrom: null, created: new Date().toISOString(), doneAt: null, ts: ts || {}
});

const day = (o: Partial<DayShape>): DayShape => ({
  tasks: [], tombstones: [], note: '', focus: null, reflection: '', fieldTs: {}, orderTs: 0,
  ...o
});

const st = (o: Partial<Omit<AppState, 'settings'>> & { settings?: Partial<SettingsShape> }): AppState => {
  const base: AppState = {
    settings: { resetHour: 0, theme: 'dark', sound: false, name: '' },
    days: {}, tomorrow: [], onboarded: true
  };
  return Object.assign(base, o, { settings: Object.assign(base.settings, o.settings || {}) });
};

const rm = (o: Partial<RemoteMeta>): RemoteMeta => ({
  owner: '', name: '', nameTs: 0, resetHour: 0, resetHourTs: 0, tomorrow: [], tomorrowTs: 0,
  ...o
});

let pass = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log('  ok ' + name); }
  catch (e) { console.log('  FAIL ' + name + ': ' + (e as Error).message); process.exitCode = 1; }
}

console.log('hash');
check('hash stable + deterministic', () => {
  assert.equal(S.hashCode('ABC234XYZ789'), S.hashCode('ABC234XYZ789'));
  assert.ok(S.hashCode('ABC234XYZ789').match(/^[a-z0-9-]+$/));
  assert.notEqual(S.hashCode('ABC234XYZ789'), S.hashCode('ABC234XYZ790'));
});

console.log('code');
check('12 chars from safe alphabet', () => {
  const c = S.genCode();
  assert.equal(c.length, 12);
  assert.ok(/^[A-Z2-9]+$/.test(c));
});

console.log('mergeTask: done toggle newest wins');
check('remote newer done=true wins', () => {
  const local = T('a', 'x'); local.done = false; local.ts.done = 1000;
  const remote = T('a', 'x'); remote.done = true; remote.doneAt = 2000; remote.ts.done = 2000;
  const m = S.mergeTask(local, remote);
  assert.equal(m.task.done, true);
  assert.equal(m.task.doneAt, 2000);
  assert.ok(m.changed);
});
check('local newer done=false beats stale remote', () => {
  const local = T('a', 'x'); local.done = false; local.doneAt = null; local.ts.done = 3000;
  const remote = T('a', 'x'); remote.done = true; remote.doneAt = 1000; remote.ts.done = 1000;
  const m = S.mergeTask(local, remote);
  assert.equal(m.task.done, false);
  assert.equal(m.task.doneAt, null);
});
check('text edit newer wins independently of done', () => {
  const local = T('a', 'old'); local.ts.text = 5000; local.ts.done = 1000; local.done = true; local.doneAt = 900;
  const remote = T('a', 'old'); remote.ts.text = 1000; remote.ts.done = 900;
  const m = S.mergeTask(local, remote);
  assert.equal(m.task.text, 'old');
  assert.equal(m.task.done, true);
});

console.log('mergeDay: adds never lost, tombstones win');
check('remote task added to local day', () => {
  const local = day({ tasks: [T('l', 'local', { done: 1 })], fieldTs: {} });
  const remote = day({ tasks: [T('l', 'local', { done: 1 }), T('r', 'remote task', { done: 1 })], fieldTs: {} });
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 2);
  assert.ok(m.day.tasks.some(t => t.id === 'r'));
  assert.ok(m.changed);
});
check('local task absent remotely is kept', () => {
  const local = day({ tasks: [T('l', 'local only', { done: 1 })], fieldTs: {} });
  const remote = day({ tasks: [T('r', 'remote', { done: 1 })], fieldTs: {} });
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 2);
});
check('tombstone newer than task ts removes it', () => {
  const local = day({ tombstones: [{ id: 'dead', deletedAt: 2000 }], fieldTs: {} });
  const remote = day({ tasks: [T('dead', 'deleted on other device', { done: 1500, text: 1500 })], fieldTs: {} });
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 0);
});
check('tombstone older than task update keeps task', () => {
  const local = day({ tasks: [T('alive', 'edited after delete', { done: 3000, text: 3000 })], tombstones: [{ id: 'alive', deletedAt: 2000 }], fieldTs: {} });
  const remote = day({ fieldTs: {} });
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 1);
});
check('tombstone union takes max deletedAt', () => {
  const a: Tombstone[] = [{ id: 'x', deletedAt: 100 }, { id: 'y', deletedAt: 100 }];
  const b: Tombstone[] = [{ id: 'x', deletedAt: 500 }];
  const m = S.mergeTombstones(a, b);
  assert.deepEqual(m, [{ id: 'x', deletedAt: 500 }, { id: 'y', deletedAt: 100 }]);
});
check('carried task duplicate not merged twice', () => {
  const mk = (id: string) => Object.assign(T(id, 'task'), { carriedFrom: { day: '2026-08-06', id: 'orig' } });
  const local = day({ tasks: [mk('new1')], fieldTs: {} });
  const remote = day({ tasks: [mk('new2')], fieldTs: {} });
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 2);
  assert.equal(m.day.tasks.filter(t => t.carriedFrom && t.carriedFrom.id === 'orig').length, 2);
});

console.log('mergeDay: note/focus/reflection LWW');
check('newer remote note wins', () => {
  const local = day({ note: 'old', fieldTs: { note: 1000 } });
  const remote = day({ note: 'new', fieldTs: { note: 2000 } });
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.note, 'new');
});

console.log('pushDay: unchanged fields keep remote ts, changed get now');
check('stamps now only on differences', () => {
  const now = 50000;
  const local = day({ tasks: [T('a', 'same text', {})] });
  local.tasks[0].done = true; local.tasks[0].doneAt = 123;
  const remote = day({ tasks: [T('a', 'same text', {})] });
  remote.tasks[0].done = false; remote.tasks[0].ts!.done = 1000; remote.tasks[0].ts!.text = 2000;
  const doc = S.pushDay(local, remote, now);
  assert.equal(doc.tasks[0].ts!.done, now);      // local changed done -> now
  assert.equal(doc.tasks[0].ts!.text, 2000);     // text unchanged -> keep remote ts
});
check('pushDay includes tombstones', () => {
  const local = day({ tombstones: [{ id: 'g', deletedAt: 999 }] });
  const remote = day({ tasks: [T('g', 'gone', {})] });
  const doc = S.pushDay(local, remote, Date.now());
  assert.equal(doc.tombstones.length, 1);
});

console.log('orderTs: reorder sync');
check('newer remote orderTs adopts remote order', () => {
  const mk = (tasks: TaskShape[], orderTs: number) => day({ tasks, orderTs });
  const local = mk([
    Object.assign(T('a', 'x', {}), { order: 0 }),
    Object.assign(T('b', 'y', {}), { order: 1 }),
    Object.assign(T('c', 'z', {}), { order: 2 })
  ], 1000);
  const remote = mk([
    Object.assign(T('c', 'z', {}), { order: 0 }),
    Object.assign(T('a', 'x', {}), { order: 1 }),
    Object.assign(T('b', 'y', {}), { order: 2 })
  ], 2000);
  const m = S.mergeDay(local, remote);
  assert.deepEqual(m.day.tasks.map(t => t.id), ['c', 'a', 'b']);
  assert.equal(m.day.orderTs, 2000);
  assert.equal(m.changed, true);
});
check('older remote orderTs is ignored', () => {
  const local = day({
    tasks: [Object.assign(T('a', 'x', {}), { order: 0 })],
    orderTs: 2000
  });
  const remote = day({
    tasks: [Object.assign(T('a', 'x', {}), { order: 1 })],
    orderTs: 1000
  });
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.orderTs, 2000);
  assert.equal(m.changed, false);
});
check('pushDay: only reorderer stamps order ts', () => {
  const now = 9000;
  const local = day({
    tasks: [Object.assign(T('a', 'x', {}), { order: 1, ts: { order: 1000 } })],
    orderTs: 5000
  });
  const remote = day({
    orderTs: 3000,
    tasks: [Object.assign(T('a', 'x', {}), { order: 0, ts: { order: 3000 } })]
  });
  const doc = S.pushDay(local, remote, now);
  assert.equal(doc.tasks[0].ts!.order, now);
  assert.equal(doc.orderTs, 5000);
});
check('pushDay: non-reorderer preserves remote order ts', () => {
  const now = 9000;
  const local = day({
    tasks: [Object.assign(T('a', 'x', {}), { order: 1, ts: { order: 1000 } })],
    orderTs: 3000
  });
  const remote = day({
    orderTs: 5000,
    tasks: [Object.assign(T('a', 'x', {}), { order: 0, ts: { order: 5000 } })]
  });
  const doc = S.pushDay(local, remote, now);
  assert.equal(doc.tasks[0].ts!.order, 5000);
  assert.equal(doc.orderTs, 5000);
});

console.log('readLocalMeta: tomorrow LWW inference');
check('equal tomorrow keeps remote ts, differing stamps now', () => {
  (global as any).localStorage.setItem('daily-fresh-sync-v1', JSON.stringify({ code: 'ABC', hash: S.hashCode('ABC'), paired: true }));
  const state = st({ settings: { name: '' }, tomorrow: [{ id: 't1', text: 'plan' }], tomorrowTs: 0, nameTs: 0 });
  const remoteMeta = rm({ owner: S.hashCode('ABC'), name: '', nameTs: 1000, tomorrow: [{ id: 't1', text: 'plan' }], tomorrowTs: 1000 });
  const m1 = S.readLocalMeta(state, 5000, remoteMeta);
  assert.equal(m1.tomorrowTs, 1000);
  state.tomorrow![0].text = 'changed plan';
  const m2 = S.readLocalMeta(state, 5000);
  assert.equal(m2.tomorrowTs, 5000);
});

console.log('mergeMeta');
check('newer remote tomorrow replaces; newer remote name merges', () => {
  const state = st({ settings: { name: 'Avi' }, tomorrow: [{ id: 'l', text: 'local' }], tomorrowTs: 500, nameTs: 500 });
  const rmt = rm({ tomorrow: [{ id: 'r', text: 'remote' }], tomorrowTs: 900, name: 'Other', nameTs: 900 });
  const m = S.mergeMeta(state, rmt);
  assert.equal(m.tomorrow[0].id, 'r');
  assert.equal(state.settings.name, 'Other');
  assert.equal(state.nameTs, 900);
});
check('older remote name is ignored', () => {
  const state = st({ settings: { name: 'Avi' }, tomorrow: [], tomorrowTs: 0, nameTs: 500 });
  const rmt = rm({ tomorrow: [], tomorrowTs: 0, name: 'Stale', nameTs: 100 });
  S.mergeMeta(state, rmt);
  assert.equal(state.settings.name, 'Avi');
  assert.equal(state.nameTs, 500);
});

console.log('resetHour sync');
check('newer remote resetHour merges into settings', () => {
  const state = st({ settings: { resetHour: 0 }, tomorrow: [], tomorrowTs: 0, nameTs: 0, resetHourTs: 0 });
  const rmt = rm({ resetHour: 5, resetHourTs: 900 });
  S.mergeMeta(state, rmt);
  assert.equal(state.settings.resetHour, 5);
  assert.equal(state.resetHourTs, 900);
});
check('older remote resetHour is ignored', () => {
  const state = st({ settings: { resetHour: 0 }, tomorrow: [], tomorrowTs: 0, nameTs: 0, resetHourTs: 500 });
  const rmt = rm({ resetHour: 5, resetHourTs: 100 });
  S.mergeMeta(state, rmt);
  assert.equal(state.settings.resetHour, 0);
  assert.equal(state.resetHourTs, 500);
});
check('readLocalMeta stamps resetHour when it differs from remote', () => {
  (global as any).localStorage.setItem('daily-fresh-sync-v1', JSON.stringify({ code: 'ABC', hash: S.hashCode('ABC'), paired: true }));
  const state = st({ settings: { resetHour: 3 }, tomorrow: [], tomorrowTs: 0, nameTs: 0 });
  const remoteMeta = rm({ resetHour: 0, resetHourTs: 1000 });
  const m = S.readLocalMeta(state, 5000, remoteMeta);
  assert.equal(m.resetHour, 3);
  assert.equal(m.resetHourTs, 5000);
});
check('readLocalMeta keeps remote ts when equal', () => {
  (global as any).localStorage.setItem('daily-fresh-sync-v1', JSON.stringify({ code: 'ABC', hash: S.hashCode('ABC'), paired: true }));
  const state = st({ settings: { resetHour: 0 }, tomorrow: [], tomorrowTs: 0, nameTs: 0 });
  const remoteMeta = rm({ resetHour: 0, resetHourTs: 1000 });
  const m = S.readLocalMeta(state, 5000, remoteMeta);
  assert.equal(m.resetHourTs, 1000);
});

console.log('quarterKey');
check('maps day keys to YYYY-Qn buckets', () => {
  assert.equal(S.quarterKey('2026-08-10'), '2026-Q3');
  assert.equal(S.quarterKey('2026-01-01'), '2026-Q1');
  assert.equal(S.quarterKey('2026-03-31'), '2026-Q1');
  assert.equal(S.quarterKey('2026-04-01'), '2026-Q2');
  assert.equal(S.quarterKey('2025-12-31'), '2025-Q4');
});

console.log('isRecentDay');
check('recent window = 31 days including today', () => {
  const now = new Date(2026, 7, 10).getTime();
  assert.equal(S.isRecentDay('2026-08-10', now), true);
  assert.equal(S.isRecentDay('2026-07-11', now), true);
  assert.equal(S.isRecentDay('2026-07-10', now), false);
  assert.equal(S.isRecentDay('2026-08-11', now), true);
  assert.equal(S.isRecentDay('garbage', now), true);
});

console.log('buildOpen');
check('keeps only recent window days', () => {
  const now = new Date(2026, 7, 10).getTime();
  const state = st({
    days: {
      '2026-08-10': day({ note: 'today' }),
      '2026-07-01': day({ note: 'old' }),
      '2026-01-15': day({ note: 'ancient' })
    }
  });
  const open = S.buildOpen(state, now);
  assert.deepEqual(Object.keys(open), ['2026-08-10']);
});

console.log('planMigration');
check('recent to open, old to quarter archives', () => {
  const now = new Date(2026, 7, 10).getTime();
  const legacy = {
    '2026-08-10': day({ note: 'today' }),
    '2026-03-15': day({ note: 'q1' }),
    '2026-04-20': day({ note: 'q2' }),
    '2025-11-02': day({ note: 'old q4' })
  };
  const plan = S.planMigration(legacy, now);
  assert.deepEqual(Object.keys(plan.openDays), ['2026-08-10']);
  assert.deepEqual(Object.keys(plan.archives['2026-Q1']), ['2026-03-15']);
  assert.deepEqual(Object.keys(plan.archives['2026-Q2']), ['2026-04-20']);
  assert.deepEqual(Object.keys(plan.archives['2025-Q4']), ['2025-11-02']);
  assert.ok(Array.isArray(plan.archives['2026-Q1']['2026-03-15'].tombstones));
});

console.log('planSweep');
check('old changed day goes to its quarter; unchanged days skipped', () => {
  const now = new Date(2026, 7, 10).getTime();
  const local = day({ note: 'edited later', tasks: [T('a', 'task', { done: 1000 })], fieldTs: { note: 500 } });
  const plan1 = S.planSweep(st({ days: { '2026-01-15': local } }), {}, now);
  assert.deepEqual(Object.keys(plan1), ['2026-Q1']);
  assert.ok(plan1['2026-Q1']['2026-01-15']);
  const pushed = S.pushDay(local, null, now);
  const plan2 = S.planSweep(st({ days: { '2026-01-15': local } }), { '2026-Q1': { '2026-01-15': pushed } }, now);
  assert.deepEqual(plan2, {});
});
check('recent days are never swept', () => {
  const now = new Date(2026, 7, 10).getTime();
  const plan = S.planSweep(st({ days: { '2026-08-10': day({ note: 'x' }) } }), {}, now);
  assert.deepEqual(plan, {});
});

console.log('readLocalMeta: schema stamp');
check('meta always carries schema v3', () => {
  (global as any).localStorage.setItem('daily-fresh-sync-v1', JSON.stringify({ code: 'ABC', hash: S.hashCode('ABC'), paired: true }));
  const state = st({ settings: { name: '' }, tomorrow: [], tomorrowTs: 0, nameTs: 0 });
  const m = S.readLocalMeta(state, 5000);
  assert.equal(m.schema, 'v3');
});

console.log(pass + ' checks passed');
