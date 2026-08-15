import * as assert from 'assert';

(global as any).Logic = require('../../dist/logic.js');

const L = (global as any).Logic as any;

const T = (id: string, text: string, extra?: Partial<TaskShape>): TaskShape => ({
  id, text, done: false, estimate: 0, order: 0,
  carriedFrom: null, created: '2026-08-01T10:00:00.000Z', doneAt: null, ts: null,
  ...extra
});

const day = (o: Partial<DayShape>): DayShape => ({
  tasks: [], note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0,
  ...o
});

let pass = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log('  ok ' + name); }
  catch (e) { console.log('  FAIL ' + name + ': ' + (e as Error).message); process.exitCode = 1; }
}

console.log('day keys');
check('currentDayKey before resetHour belongs to yesterday', () => {
  const now = new Date(2026, 7, 10, 4); // Aug 10, 04:00
  assert.equal(L.currentDayKey(now, 5), '2026-08-09');
  assert.equal(L.currentDayKey(now, 3), '2026-08-10');
});
check('shiftKey crosses month/year boundaries', () => {
  assert.equal(L.shiftKey('2026-08-01', -1), '2026-07-31');
  assert.equal(L.shiftKey('2026-01-01', -1), '2025-12-31');
  assert.equal(L.shiftKey('2026-12-31', 1), '2027-01-01');
  assert.equal(L.shiftKey('2026-03-01', 0), '2026-03-01');
});
check('calKey pads month/day', () => {
  assert.equal(L.calKey(2026, 7, 5), '2026-08-05');
  assert.equal(L.calKey(2026, 0, 31), '2026-01-31');
  assert.equal(L.calKey(2026, 11, 12), '2026-12-12');
});
check('dayLabel relative labels', () => {
  const now = new Date(2026, 7, 10);
  assert.equal(L.dayLabel('2026-08-10', now), 'Today');
  assert.equal(L.dayLabel('2026-08-09', now), 'Yesterday');
  assert.equal(L.dayLabel('2026-08-05', now), '5 days ago');
  assert.equal(L.dayLabel('2026-06-01', now), new Date(2026, 5, 1).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
});

console.log('estimates');
check('parseEstimate handles h, m, and combined', () => {
  assert.equal(L.parseEstimate('Buy milk 45m'), 45);
  assert.equal(L.parseEstimate('Report 1h'), 60);
  assert.equal(L.parseEstimate('Deep work 1h 30m'), 90);
  assert.equal(L.parseEstimate('Read 2.5h'), 150);
  assert.equal(L.parseEstimate('No estimate here'), 0);
});
check('fmtEstimate formats m/h combos', () => {
  assert.equal(L.fmtEstimate(30), '~30m');
  assert.equal(L.fmtEstimate(90), '~1h 30m');
  assert.equal(L.fmtEstimate(120), '~2h');
  assert.equal(L.fmtEstimate(0), '~0m');
});

console.log('tasks');
check('orderedTasks uses order then insertion index fallback', () => {
  const a = T('a', 'a'); a.order = 1;
  const b = T('b', 'b'); b.order = 0;
  const c = { ...T('c', 'c'), order: undefined };
  assert.deepEqual(L.orderedTasks([a, b, c]).map((t: TaskShape) => t.id), ['b', 'a', 'c']);
});
check('allDone false for empty, true only when all done', () => {
  assert.equal(L.allDone([]), false);
  assert.equal(L.allDone([T('a', 'x')]), false);
  assert.equal(L.allDone([{ ...T('a', 'x'), done: true }, { ...T('b', 'y'), done: true }]), true);
});

console.log('stats');
check('dayStats ratio and missing days', () => {
  const days = { '2026-08-10': day({ tasks: [T('a', 'x'), { ...T('b', 'y'), done: true }] }) };
  const st = L.dayStats(days, '2026-08-10');
  assert.deepEqual(st, { total: 2, done: 1, ratio: 0.5, exists: true });
  const missing = L.dayStats(days, '2026-08-09');
  assert.equal(missing.exists, false);
});
check('streak counts consecutive complete days back from active', () => {
  const mkAll = (key: string) => day({ tasks: [{ ...T('t', 'x'), done: true }] });
  const days: Record<string, DayShape> = {
    '2026-08-08': mkAll('2026-08-08'),
    '2026-08-09': mkAll('2026-08-09'),
    '2026-08-10': mkAll('2026-08-10')
  };
  assert.equal(L.streak(days, '2026-08-10'), 3);
  days['2026-08-10'] = day({ tasks: [T('a', 'partial')] });
  assert.equal(L.streak(days, '2026-08-10'), 0);
  delete days['2026-08-10'];
  assert.equal(L.streak(days, '2026-08-10'), 2);
  assert.equal(L.streak({}, '2026-08-10'), 0);
});
check('lastKeys returns n consecutive keys ending at activeDay', () => {
  assert.deepEqual(L.lastKeys('2026-08-10', 3), ['2026-08-08', '2026-08-09', '2026-08-10']);
});

console.log('greeting');
check('greeting buckets by hour and appends name', () => {
  const g = (h: number) => L.greeting(new Date(2026, 7, 10, h), 'Avi');
  assert.equal(g(3), 'Working late, Avi?');
  assert.equal(g(8), 'Good morning, Avi');
  assert.equal(g(14), 'Good afternoon, Avi');
  assert.equal(g(20), 'Good evening, Avi');
  assert.equal(L.greeting(new Date(2026, 7, 10, 10), ''), 'Good morning');
});

console.log('rootOf');
check('rootOf returns carried chain origin', () => {
  const days = {
    '2026-08-07': day({ tasks: [T('o', 'origin')] }),
    '2026-08-08': day({ tasks: [{ ...T('c1', 'carried'), carriedFrom: { day: '2026-08-07', id: 'o' } }] }),
    '2026-08-09': day({ tasks: [{ ...T('c2', 'carried again'), carriedFrom: { day: '2026-08-08', id: 'c1' } }] })
  };
  assert.equal(L.rootOf(days['2026-08-09'].tasks[0], days, '2026-08-09'), '2026-08-07:o');
});
check('rootOf falls back to own key for origin tasks', () => {
  const t = T('x', 'origin');
  assert.equal(L.rootOf(t, {}, '2026-08-10'), '2026-08-10:x');
});
check('rootOf walks dangling chains to the first link', () => {
  const days = { '2026-08-09': day({ tasks: [] }) };
  const t = { ...T('c', 'orphaned'), carriedFrom: { day: '2026-08-08', id: 'gone' } };
  assert.equal(L.rootOf(t, days, '2026-08-09'), '2026-08-08:gone');
});

console.log('carry candidates');
check('carryCandidates excludes already-carried and done tasks', () => {
  const days = {
    '2026-08-07': day({ tasks: [
      T('o1', 'open yesterday'),
      { ...T('o2', 'done yesterday'), done: true },
      T('o3', 'open origin of carried today')
    ] }),
    '2026-08-09': day({ tasks: [
      { ...T('ct', 'carried today'), carriedFrom: { day: '2026-08-07', id: 'o3' } }
    ] })
  };
  const res = L.carryCandidates(days, '2026-08-09');
  assert.deepEqual(res.map((r: { task: TaskShape }) => r.task.id), ['o1']);
});
check('carryCandidates orders days newest first', () => {
  const days = {
    '2026-08-05': day({ tasks: [T('a', 'old')] }),
    '2026-08-08': day({ tasks: [T('b', 'newer')] })
  };
  const res = L.carryCandidates(days, '2026-08-09');
  assert.deepEqual(res.map((r: { task: TaskShape }) => r.task.id), ['b', 'a']);
});

console.log('migrate');
check('migrate normalizes legacy array days', () => {
  const s = L.migrate({ days: { '2026-08-10': [T('a', 'legacy task')] } });
  assert.equal(s.days['2026-08-10'].tasks.length, 1);
  assert.equal(s.days['2026-08-10'].tombstones.length, 0);
  assert.ok(s.onboarded);
});
check('migrate strips carried-chained duplicates', () => {
  const mk = (id: string) => ({ ...T(id, 'the task'), carriedFrom: { day: '2026-08-08', id: 'orig' } });
  const s = L.migrate({ days: { '2026-08-09': day({ tasks: [mk('c1'), mk('c2')] }) } });
  assert.equal(s.days['2026-08-09'].tasks.length, 1);
});
check('migrate strips same-text duplicates across carried null', () => {
  const s = L.migrate({ days: { '2026-08-10': day({ tasks: [T('a', 'Renew license'), T('b', 'Renew license')] }) } });
  assert.equal(s.days['2026-08-10'].tasks.length, 1);
  assert.equal(s.days['2026-08-10'].tasks[0].id, 'a');
});
check('migrate keeps completed same-text tasks', () => {
  const s = L.migrate({ days: { '2026-08-10': day({ tasks: [{ ...T('a', 'done twice'), done: true }, T('b', 'done twice')] }) } });
  assert.equal(s.days['2026-08-10'].tasks.length, 2);
});
check('migrate preserves settings and ts fields', () => {
  const s = L.migrate({
    settings: { resetHour: 5, theme: 'light', sound: false, name: 'Avi' },
    tomorrowTs: 111, nameTs: 222, resetHourTs: 333,
    days: { '2026-08-10': day({ note: 'n' }) }
  });
  assert.deepEqual(s.settings, { resetHour: 5, theme: 'light', sound: false, name: 'Avi' });
  assert.equal(s.tomorrowTs, 111);
  assert.equal(s.nameTs, 222);
  assert.equal(s.resetHourTs, 333);
  assert.equal(s.days['2026-08-10'].note, 'n');
});
check('migrate ignores corrupt days and keeps others', () => {
  const s = L.migrate({ days: { bad: null, '2026-08-10': day({ note: 'good' }) } });
  assert.deepEqual(Object.keys(s.days), ['2026-08-10']);
});
check('migrate dedupeDay root tracking respects same-day carriers', () => {
  const mk = (id: string) => ({ ...T(id, 'task'), carriedFrom: { day: '2026-08-07', id: 'o' } });
  const s = L.migrate({ days: { '2026-08-07': day({ tasks: [T('o', 'origin')] }), '2026-08-10': day({ tasks: [mk('c1'), T('plain', 'unique')] }) } });
  assert.equal(s.days['2026-08-10'].tasks.length, 2);
});

console.log('timer');
check('fmtTime pads and floors', () => {
  assert.equal(L.fmtTime(0), '00:00');
  assert.equal(L.fmtTime(65), '01:05');
  assert.equal(L.fmtTime(3599.9), '59:59');
});
check('timerStroke sweeps from full to empty', () => {
  assert.ok(Math.abs(L.timerStroke(1500, 1500) - 0) < 0.0001);
  assert.ok(Math.abs(L.timerStroke(0, 1500) - 389.56) < 0.0001);
  assert.ok(Math.abs(L.timerStroke(750, 1500) - 194.78) < 0.01);
});

console.log('dedupeDay');
check('dedupeDay drops second copy carried from same origin (even different text)', () => {
  const mk = (id: string, text: string) => ({ ...T(id, text), carriedFrom: { day: '2026-08-07', id: 'o' } });
  const days = { '2026-08-07': day({ tasks: [T('o', 'origin')] }) };
  const res = L.dedupeDay([mk('a', 'First'), mk('b', 'Second')], days, '2026-08-10');
  assert.equal(res.tasks.length, 1);
  assert.equal(res.tasks[0].id, 'a');
  assert.ok(res.dropped);
});
check('dedupeDay drops duplicate text with null carriedFrom', () => {
  const days = { '2026-08-10': day({}) };
  const res = L.dedupeDay([T('a', 'Same text'), T('b', ' same text ')], days, '2026-08-10');
  assert.equal(res.tasks.length, 1);
  assert.ok(res.dropped);
});

console.log(pass + ' logic checks passed');