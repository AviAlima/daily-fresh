import * as assert from 'assert';
const updates = require('../../dist/update.js') as { refresh(options: { getRegistration(): Promise<any>; reload(): void; timeoutMs?: number }): Promise<void> };

async function main() {
  let passed = 0;
  async function check(name: string, getRegistration: () => Promise<any>, expected?: string[]) {
    const events: string[] = [];
    await updates.refresh({ getRegistration, reload: () => events.push('reload'), timeoutMs: 10 });
    assert.deepEqual(events, expected || ['reload']);
    passed++; console.log('  ok ' + name);
  }
  await check('reloads when there is no service worker', async () => undefined);
  await check('reloads when reading the registration is denied', async () => { throw new Error('SecurityError'); });
  await check('reloads when checking the worker update fails', async () => ({ update: async () => { throw new Error('network failure'); } }));
  await check('reloads when an update check never completes', async () => ({ update: () => new Promise(() => {}) }));
  await check('reloads when registration lookup never completes', () => new Promise(() => {}));
  await check('reloads when messaging the waiting worker fails', async () => ({ update: async () => {}, waiting: { postMessage() { throw new Error('worker gone'); } } }));
  const order: string[] = [];
  await updates.refresh({
    getRegistration: async () => ({ update: async () => { order.push('check'); }, waiting: { postMessage() { order.push('activate'); } } }),
    reload: () => { order.push('reload'); }
  });
  assert.deepEqual(order, ['check', 'activate', 'reload']);
  passed++; console.log('  ok waits for a successful check before activating and reloading');
  let lateResolve!: (value: any) => void;
  let reloads = 0, messages = 0;
  await updates.refresh({ getRegistration: () => new Promise((resolve) => { lateResolve = resolve; }), reload: () => { reloads++; }, timeoutMs: 10 });
  lateResolve({ update: async () => {}, waiting: { postMessage() { messages++; } } });
  await new Promise(setImmediate);
  assert.equal(reloads, 1); assert.equal(messages, 0);
  passed++; console.log('  ok late worker responses cannot activate or reload a second time');
  console.log(passed + ' update checks passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
