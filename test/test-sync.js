'use strict';
const assert = require('assert');

global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};
global.window = { addEventListener() {} };

const S = require('../sync.js');

const T = (id, text, ts) => ({
  id, text, done: false, priority: 0, notes: '', estimate: 0,
  carriedFrom: null, created: new Date().toISOString(), doneAt: null, ts: ts || {}
});

let pass = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok ' + name); }
  catch (e) { console.log('  FAIL ' + name + ': ' + e.message); process.exitCode = 1; }
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
  const local = { tasks: [T('l', 'local', { done: 1 })], tombstones: [], fieldTs: {} };
  const remote = { tasks: [T('l', 'local', { done: 1 }), T('r', 'remote task', { done: 1 })], tombstones: [], fieldTs: {} };
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 2);
  assert.ok(m.day.tasks.some(t => t.id === 'r'));
  assert.ok(m.changed);
});
check('local task absent remotely is kept', () => {
  const local = { tasks: [T('l', 'local only', { done: 1 })], tombstones: [], fieldTs: {} };
  const remote = { tasks: [T('r', 'remote', { done: 1 })], tombstones: [], fieldTs: {} };
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 2);
});
check('tombstone newer than task ts removes it', () => {
  const local = { tasks: [], tombstones: [{ id: 'dead', deletedAt: 2000 }], fieldTs: {} };
  const remote = { tasks: [T('dead', 'deleted on other device', { done: 1500, text: 1500 })], tombstones: [], fieldTs: {} };
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 0);
});
check('tombstone older than task update keeps task', () => {
  const local = { tasks: [T('alive', 'edited after delete', { done: 3000, text: 3000 })], tombstones: [{ id: 'alive', deletedAt: 2000 }], fieldTs: {} };
  const remote = { tasks: [], tombstones: [], fieldTs: {} };
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 1);
});
check('tombstone union takes max deletedAt', () => {
  const a = [{ id: 'x', deletedAt: 100 }, { id: 'y', deletedAt: 100 }];
  const b = [{ id: 'x', deletedAt: 500 }];
  const m = S.mergeTombstones(a, b);
  assert.deepEqual(m, [{ id: 'x', deletedAt: 500 }, { id: 'y', deletedAt: 100 }]);
});
check('carried task duplicate not merged twice', () => {
  const mk = (id) => Object.assign(T(id, 'task'), { carriedFrom: { day: '2026-08-06', id: 'orig' } });
  const local = { tasks: [mk('new1')], tombstones: [], fieldTs: {} };
  const remote = { tasks: [mk('new2')], tombstones: [], fieldTs: {} };
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.tasks.length, 2);
  assert.equal(m.day.tasks.filter(t => t.carriedFrom && t.carriedFrom.id === 'orig').length, 2);
});

console.log('mergeDay: note/focus/reflection LWW');
check('newer remote note wins', () => {
  const local = { tasks: [], tombstones: [], note: 'old', fieldTs: { note: 1000 } };
  const remote = { tasks: [], tombstones: [], note: 'new', fieldTs: { note: 2000 } };
  const m = S.mergeDay(local, remote);
  assert.equal(m.day.note, 'new');
});

console.log('pushDay: unchanged fields keep remote ts, changed get now');
check('stamps now only on differences', () => {
  const now = 50000;
  const local = { tasks: [T('a', 'same text', {})], tombstones: [], note: '', fieldTs: {} };
  local.tasks[0].done = true; local.tasks[0].doneAt = 123;
  const remote = { tasks: [T('a', 'same text', {})], tombstones: [], note: '', fieldTs: {} };
  remote.tasks[0].done = false; remote.tasks[0].ts.done = 1000; remote.tasks[0].ts.text = 2000;
  const doc = S.pushDay(local, remote, now);
  assert.equal(doc.tasks[0].ts.done, now);      // local changed done -> now
  assert.equal(doc.tasks[0].ts.text, 2000);     // text unchanged -> keep remote ts
});
check('pushDay includes tombstones', () => {
  const local = { tasks: [], tombstones: [{ id: 'g', deletedAt: 999 }], note: '', fieldTs: {} };
  const remote = { tasks: [T('g', 'gone', {})], tombstones: [], note: '', fieldTs: {} };
  const doc = S.pushDay(local, remote, Date.now());
  assert.equal(doc.tombstones.length, 1);
});

console.log('readLocalMeta: tomorrow LWW inference');
check('equal tomorrow keeps remote ts, differing stamps now', () => {
  global.localStorage.setItem('daily-fresh-sync-v1', JSON.stringify({ code: 'ABC', hash: S.hashCode('ABC'), paired: true }));
  const state = { settings: { name: '' }, tomorrow: [{ id: 't1', text: 'plan' }], tomorrowTs: 0, nameTs: 0 };
  const remoteMeta = { owner: S.hashCode('ABC'), name: '', nameTs: 1000, tomorrow: [{ id: 't1', text: 'plan' }], tomorrowTs: 1000 };
  const m1 = S.readLocalMeta(state, 5000, remoteMeta);
  assert.equal(m1.tomorrowTs, 1000);
  state.tomorrow[0].text = 'changed plan';
  const m2 = S.readLocalMeta(state, 5000);
  assert.equal(m2.tomorrowTs, 5000);
});

console.log('mergeMeta');
check('newer remote tomorrow replaces; newer remote name merges', () => {
  const state = { settings: { name: 'Avi' }, tomorrow: [{ id: 'l', text: 'local' }], tomorrowTs: 500, nameTs: 500 };
  const rm = { tomorrow: [{ id: 'r', text: 'remote' }], tomorrowTs: 900, name: 'Other', nameTs: 900 };
  const m = S.mergeMeta(state, rm);
  assert.equal(m.tomorrow[0].id, 'r');
  assert.equal(state.settings.name, 'Other');
  assert.equal(state.nameTs, 900);
});
check('older remote name is ignored', () => {
  const state = { settings: { name: 'Avi' }, tomorrow: [], tomorrowTs: 0, nameTs: 500 };
  const rm = { tomorrow: [], tomorrowTs: 0, name: 'Stale', nameTs: 100 };
  S.mergeMeta(state, rm);
  assert.equal(state.settings.name, 'Avi');
  assert.equal(state.nameTs, 500);
});

console.log(pass + ' checks passed');
