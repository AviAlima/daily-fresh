import * as assert from 'assert';
import * as fs from 'fs';
import * as vm from 'vm';

// Exercise real asynchronous orchestration with a controlled Firestore transport.
// Test hooks are injected into the compiled module only inside this isolated VM.
function harness() {
  let now = Date.UTC(2026, 9, 31, 12);
  let serverDays: any = {};
  let nextRead: any = null;
  const listeners: Record<string, any> = {};
  const commits: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  const data: Record<string, string> = {};
  const storage = { getItem: (k: string) => data[k] || null, setItem: (k: string, v: string) => { data[k] = v; } };
  const empty = { tasks: [], note: '', reflection: '', focus: null, tombstones: [], fieldTs: {}, orderTs: 0 };
  storage.setItem('daily-fresh-state-v2', JSON.stringify({ settings: { resetHour: 0, theme: 'dark', sound: false, name: '' }, days: { '2026-10-31': empty }, onboarded: true }));
  const snapshot = (days: any, metadata: any = {}) => ({ exists: true, metadata: { fromCache: false, hasPendingWrites: false, ...metadata }, data: () => ({ days }) });
  const ref = (name: string) => ({ name, onSnapshot(options: any, next: any, error: any) { listeners[name] = { options, next, error }; return () => {}; }, get() { return Promise.resolve(name === 'open' ? (nextRead || snapshot(serverDays)) : snapshot({})); } });
  const open = ref('open'), meta = ref('meta'), archive = ref('archive');
  const db = {
    collection: () => ({ add: () => Promise.resolve() }),
    onSnapshotsInSync: (fn: () => void) => { listeners.inSync = fn; return () => {}; },
    batch() {
      let days: any;
      return {
        set(target: any, value: any) { if (target === open) days = value.days; },
        commit: () => new Promise<void>((resolve, reject) => commits.push({ resolve: () => { serverDays = days; resolve(); }, reject }))
      };
    }
  };
  let timerId = 0;
  const context: any = { console, module: { exports: {} }, exports: {}, window: {}, localStorage: storage, Logic: require('../../dist/logic.js'), navigator: { onLine: true }, Date: class extends Date { static now() { return now; } }, setTimeout: () => ++timerId, clearTimeout() {}, setInterval: () => ++timerId };
  const code = fs.readFileSync('dist/sync.js', 'utf8');
  const end = code.lastIndexOf('})();');
  const hooks = `
    globalThis.runtime = {
      setup(database, open, meta, archive) { db = database; openDoc = open; metaRef = meta; archiveCol = archive; initialized = true; lastContact = Date.now(); setSyncState({ code: 'TEST23456789', hash: 'test', paired: true }); },
      flush, onLocalChange, checkSyncStatus, confirmPush, currentStatus, startListeners, unpair, touch,
      inspect() { return { dirty, flushing, pendingSyncWrites, syncDesync, hasPush: !!pushInFlight }; }
    };
  `;
  vm.runInNewContext(code.slice(0, end) + hooks + code.slice(end), context);
  const runtime = context.runtime;
  runtime.setup(db, open, meta, archive);
  return { runtime, commits, listeners, snapshot, read: (value: any) => { nextRead = value; }, advance: (ms: number) => { now += ms; }, edit() { const state = JSON.parse(storage.getItem('daily-fresh-state-v2')!); state.days['2026-10-31'].note += 'new edit'; storage.setItem('daily-fresh-state-v2', JSON.stringify(state)); runtime.onLocalChange(); } };
}

async function run() {
  let passed = 0;
  async function check(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log('  ok ' + name); }
  await check('a slow unacknowledged write never declares divergence', async () => {
    const h = harness(); h.edit(); const writing = h.runtime.flush(); h.advance(20000); h.runtime.checkSyncStatus();
    assert.equal(h.runtime.inspect().syncDesync, false); assert.equal(h.runtime.currentStatus().state, 'pending');
    h.commits[0].resolve(); await writing;
  });
  await check('a newer local edit stays dirty after an older write succeeds', async () => {
    const h = harness(); h.edit(); const first = h.runtime.flush(); h.edit(); await h.runtime.flush();
    assert.equal(h.commits.length, 1, 'writes must be serialized'); h.commits[0].resolve(); await first;
    assert.equal(h.runtime.inspect().dirty, true); const second = h.runtime.flush(); assert.equal(h.commits.length, 2);
    h.commits[1].resolve(); await second; assert.equal(h.runtime.inspect().dirty, false);
  });
  await check('cached or locally pending echoes cannot confirm a cloud save', async () => {
    const h = harness(); h.edit(); const writing = h.runtime.flush(); h.commits[0].resolve(); await writing;
    h.read(h.snapshot({}, { fromCache: true })); h.runtime.confirmPush(); await new Promise(setImmediate);
    assert.equal(h.runtime.inspect().hasPush, true); assert.equal(h.runtime.inspect().syncDesync, false);
    h.read(h.snapshot({}, { hasPendingWrites: true })); h.runtime.confirmPush(); await new Promise(setImmediate);
    assert.equal(h.runtime.inspect().hasPush, true);
    h.read(null); h.runtime.confirmPush(); await new Promise(setImmediate); assert.equal(h.runtime.currentStatus().state, 'synced');
  });
  await check('each listener tracks and clears its own pending writes', async () => {
    const h = harness(); h.runtime.startListeners(); assert.equal(h.listeners.meta.options.includeMetadataChanges, true);
    h.listeners.meta.next({ exists: false, metadata: { fromCache: true, hasPendingWrites: true } });
    h.listeners.open.next(h.snapshot({})); assert.equal(h.runtime.inspect().pendingSyncWrites, true);
    h.listeners.meta.next({ exists: false, metadata: { fromCache: false, hasPendingWrites: false } });
    assert.equal(h.runtime.inspect().pendingSyncWrites, false); assert.equal(h.runtime.currentStatus().state, 'synced');
  });
  await check('listener failures remain errors even if another server read succeeds', async () => {
    const h = harness(); h.runtime.startListeners(); h.listeners.open.error(new Error('permission denied')); h.runtime.touch();
    assert.equal(h.runtime.currentStatus().state, 'error');
    h.listeners.open.next(h.snapshot({})); assert.equal(h.runtime.currentStatus().state, 'synced');
  });
  await check('a failed initial write stays dirty and can be retried', async () => {
    const h = harness(); const writing = h.runtime.flush(); h.commits[0].reject(new Error('network unavailable')); await writing;
    assert.equal(h.runtime.inspect().dirty, true); assert.equal(h.runtime.currentStatus().state, 'error');
    const retry = h.runtime.flush(); h.commits[1].resolve(); await retry;
    h.runtime.confirmPush(); await new Promise(setImmediate); assert.equal(h.runtime.currentStatus().state, 'synced');
  });
  await check('a late confirmation cannot change a newer push', async () => {
    const h = harness(); h.edit(); const first = h.runtime.flush(); h.commits[0].resolve(); await first;
    let resolveRead!: (value: any) => void;
    h.read(new Promise((resolve) => { resolveRead = resolve; })); h.runtime.confirmPush();
    h.edit(); const second = h.runtime.flush(); h.commits[1].resolve(); await second;
    resolveRead(h.snapshot({})); await new Promise(setImmediate);
    assert.equal(h.runtime.inspect().dirty, false); assert.equal(h.runtime.inspect().hasPush, true);
  });
  await check('a write completing after unpair cannot revive sync', async () => {
    const h = harness(); h.edit(); const writing = h.runtime.flush(); h.runtime.unpair(); h.commits[0].resolve(); await writing;
    assert.equal(h.runtime.currentStatus().state, 'off'); assert.equal(h.runtime.inspect().dirty, false);
  });
  console.log(passed + ' sync runtime checks passed');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
