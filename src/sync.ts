(function () {
  'use strict';

function newDay(): DayShape {
  return { tasks: [], note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0 };
}

interface SyncState {
  code: string;
  hash: string;
  paired: boolean;
}

interface ArchiveMap {
  [quarter: string]: Record<string, DayShape>;
}

const SYNC_KEY = 'daily-fresh-sync-v1';
const STORAGE_KEY = 'daily-fresh-state-v2';
const LOG_KEY = 'daily-fresh-sync-log-v1';
const MAX_LOG = 200;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FIELDS: Array<'done' | 'text' | 'carriedFrom' | 'estimate' | 'order'> =
  ['done', 'text', 'carriedFrom', 'estimate', 'order'];
const OPEN_DOC = 'open';
const ARCHIVE_COL = 'archive';
const RECENT_DAYS = 31;
const DAY_MS = 86400000;

let app: any = null;
let auth: any = null;
let db: any = null;
let user: any = null;
let metaRef: any = null;
let openDoc: any = null;
let archiveCol: any = null;
let unsubs: Array<() => void> = [];
let remoteOpenDays: Record<string, DayShape> = {};
let remoteArchives: ArchiveMap = {};
let remoteMeta: RemoteMeta | null = null;
let pushTimer: number | null = null;
let initialized = false;
let onRemoteCb: (() => void) | null = null;
let onStatusCb: (() => void) | null = null;
let initError: string | null = null;
let syncLog: SyncLogEntry[] | null = null;
let dirty = false;
let syncError: string | null = null;
let Sync: any = { online: true };

/* ================= Server contact tracking ================= */

const STALE_MS = 60000;
const HEARTBEAT_MS = 30000;
let lastContact = 0;
let pendingSyncWrites = false;

function touch(): void {
  lastContact = Date.now();
  notifyStatus();
}

function heartbeat(): void {
  if (!isPaired() || !initialized) return;
  metaRef.get({ source: 'server' }).then(() => { touch(); }).catch(() => { notifyStatus(); });
}

/* ================= Hash ================= */

function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + '-' + (h1 >>> 0).toString(36);
}

function hashCode(code: string): string {
  return cyrb53(code, 7) + '-' + cyrb53(code, 19);
}

/* ================= Storage ================= */

function getSync(): SyncState | null {
  if (!Sync.state) {
    try { Sync.state = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { Sync.state = null; }
  }
  return Sync.state as SyncState | null;
}

function setSyncState(s: SyncState | null): void {
  Sync.state = s;
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) {}
}

function readLocal(): AppState | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as AppState | null; } catch (e) { return null; }
}

function writeLocal(s: AppState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
}

/* ================= Sync log ================= */

function readSyncLog(): SyncLogEntry[] {
  if (!syncLog) {
    try { syncLog = JSON.parse(localStorage.getItem(LOG_KEY) || 'null') as SyncLogEntry[] | null; } catch (e) { syncLog = null; }
    if (!syncLog) syncLog = [];
  }
  return syncLog;
}

function logEvent(type: string, msg: string, data?: unknown): void {
  const entry: SyncLogEntry = { t: Date.now(), type, msg };
  if (data !== undefined) entry.d = data;
  const log = readSyncLog();
  log.push(entry);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) {}
  const st = getSync();
  if (db && st && st.paired) {
    try {
      db.collection('users/' + st.hash + '/logs').add(entry).catch(function () {});
    } catch (e) {}
  }
}

function isPaired(): boolean {
  const st = getSync();
  return !!(st && st.paired && db);
}

/* ================= Utils ================= */

function copyObj(o: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  Object.keys(o || {}).forEach((k) => { out[k] = o[k]; });
  return out;
}

function deepEq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
      if (!(ka[i] in b) || !deepEq(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }
  return false;
}

function cloneTask(t: TaskShape): TaskShape {
  return {
    id: t.id,
    text: t.text,
    done: !!t.done,
    estimate: t.estimate || 0,
    order: typeof t.order === 'number' ? t.order : 0,
    carriedFrom: t.carriedFrom ? { day: t.carriedFrom.day, id: t.carriedFrom.id } : null,
    created: t.created || new Date().toISOString(),
    doneAt: t.doneAt || null,
    ts: t.ts ? copyObj(t.ts) : null
  };
}

function normDay(d: DayShape): DayShape {
  if (!d.tombstones) d.tombstones = [];
  if (!d.fieldTs) d.fieldTs = {};
  if (!d.orderTs) d.orderTs = 0;
  (d.tasks || []).forEach((t) => { if (!t.ts) t.ts = {}; });
  return d;
}

function maxTs(ts: TsMap | null): number {
  let m = 0;
  Object.keys(ts || {}).forEach((k) => { if ((ts as TsMap)[k] > m) m = (ts as TsMap)[k]; });
  return m;
}

function tombstoneOf(list: Tombstone[], id: string): Tombstone | null {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function mergeTombstones(a: Tombstone[] | undefined, b: Tombstone[] | undefined): Tombstone[] {
  const byId: Record<string, number> = {};
  (a || []).forEach((t) => { byId[t.id] = t.deletedAt; });
  (b || []).forEach((t) => {
    if (t.id in byId) byId[t.id] = Math.max(byId[t.id], t.deletedAt);
    else byId[t.id] = t.deletedAt;
  });
  const out: Tombstone[] = [];
  Object.keys(byId).forEach((id) => { out.push({ id, deletedAt: byId[id] }); });
  return out;
}

function isTombstoned(list: Tombstone[], id: string, ts: TsMap | null): boolean {
  const t = tombstoneOf(list, id);
  return !!t && t.deletedAt > maxTs(ts);
}

/* ================= Merge engine ================= */

function mergeTask(lt: TaskShape, rt: TaskShape): { task: TaskShape; changed: boolean } {
  let changed = false;
  const out = cloneTask(lt);
  const lts = lt.ts || {};
  const rts = rt.ts || {};
  FIELDS.forEach((f) => {
    if ((rts[f] || 0) > (lts[f] || 0)) {
      if (f === 'carriedFrom') {
        out.carriedFrom = rt.carriedFrom ? { day: rt.carriedFrom.day, id: rt.carriedFrom.id } : null;
      } else {
        // per-field newest-wins; the union of fields is primitive-typed, so a cast is safe here
        (out as any)[f] = rt[f];
      }
      changed = true;
    }
  });
  if ((rts.done || 0) > (lts.done || 0)) out.doneAt = rt.doneAt || null;
  if (!out.ts) out.ts = {};
  Object.keys(rts).forEach((k) => {
    if ((rts[k] || 0) > ((out.ts as TsMap)[k] || 0)) (out.ts as TsMap)[k] = rts[k];
  });
  return { task: out, changed };
}

function mergeDay(local: DayShape, remote: DayShape): { day: DayShape; changed: boolean } {
  let changed = false;
  const day: DayShape = {
    tasks: (local.tasks || []).map(cloneTask),
    note: local.note || '',
    focus: local.focus || null,
    reflection: local.reflection || '',
    tombstones: mergeTombstones(local.tombstones, remote.tombstones),
    fieldTs: copyObj(local.fieldTs || {}),
    orderTs: local.orderTs || 0
  };
  const rft = remote.fieldTs || {};
  (['note', 'focus', 'reflection'] as Array<'note' | 'focus' | 'reflection'>).forEach((f) => {
    if ((rft[f] || 0) > (day.fieldTs[f] || 0)) {
      day[f] = remote[f] || '';
      day.fieldTs[f] = rft[f];
      changed = true;
    }
  });

  const localById: Record<string, TaskShape> = {};
  day.tasks.forEach((t) => { localById[t.id] = t; });
  const remoteById: Record<string, TaskShape> = {};
  (remote.tasks || []).forEach((t) => { remoteById[t.id] = t; });

  const out: TaskShape[] = [];
  day.tasks.forEach((lt) => {
    const rt = remoteById[lt.id];
    if (rt) {
      const m = mergeTask(lt, rt);
      if (m.changed) changed = true;
      out.push(m.task);
    } else {
      out.push(lt);
    }
  });
  (remote.tasks || []).forEach((rt) => {
    if (localById[rt.id]) return;
    if (isTombstoned(day.tombstones, rt.id, rt.ts)) return;
    out.push(cloneTask(rt));
    changed = true;
  });
  const pruned: TaskShape[] = [];
  out.forEach((t) => {
    if (isTombstoned(day.tombstones, t.id, t.ts)) { changed = true; return; }
    pruned.push(t);
  });
  day.tasks = pruned;
  if (day.focus && !pruned.some((t) => { return t.id === day.focus; })) {
    day.focus = null;
    changed = true;
  }
  if ((remote.orderTs || 0) > day.orderTs) {
    const pos: Record<string, number> = {};
    (remote.tasks || []).forEach((rt, i) => { pos[rt.id] = i; });
    day.tasks.sort((a, b) => {
      const pa = pos[a.id], pb = pos[b.id];
      if (pa === undefined && pb === undefined) return 0;
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pa - pb;
    });
    day.orderTs = remote.orderTs;
    changed = true;
  }
  return { day, changed };
}

function mergeMeta(state: AppState, rm: RemoteMeta): { tomorrow: { id: string; text: string }[]; changed: boolean } {
  let changed = false;
  let tomorrow = state.tomorrow || [];
  const rts = rm.tomorrowTs || 0;
  if (rts > (state.tomorrowTs || 0)) {
    tomorrow = (rm.tomorrow || []).map((t) => { return { id: t.id, text: t.text }; });
    state.tomorrowTs = rts;
    changed = true;
  }
  if ((rm.nameTs || 0) > (state.nameTs || 0) && typeof rm.name === 'string') {
    state.settings = state.settings || { resetHour: 0, theme: 'dark', sound: true, name: '' };
    state.settings.name = rm.name;
    state.nameTs = rm.nameTs;
    changed = true;
  }
  if ((rm.resetHourTs || 0) > (state.resetHourTs || 0) && typeof rm.resetHour === 'number') {
    state.settings = state.settings || { resetHour: 0, theme: 'dark', sound: true, name: '' };
    state.settings.resetHour = rm.resetHour;
    state.resetHourTs = rm.resetHourTs;
    changed = true;
  }
  return { tomorrow, changed };
}

/* ================= V3 layout helpers ================= */

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function quarterKey(day: string): string {
  const y = day.slice(0, 4);
  const m = parseInt(day.slice(5, 7), 10);
  return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
}

function isRecentDay(day: string, now: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
  const begin = new Date(now - (RECENT_DAYS - 1) * DAY_MS);
  return day >= dayKey(begin);
}

function buildOpen(state: AppState, now: number): Record<string, DayShape> {
  const out: Record<string, DayShape> = {};
  Object.keys(state.days || {}).forEach((k) => {
    if (isRecentDay(k, now)) out[k] = normDay(state.days[k]);
  });
  return out;
}

function planSweep(state: AppState, remoteArchivesIn: ArchiveMap, now: number): ArchiveMap {
  const plan: ArchiveMap = {};
  Object.keys(state.days || {}).forEach((k) => {
    if (isRecentDay(k, now)) return;
    const local = normDay(state.days[k]);
    const q = quarterKey(k);
    const arch = remoteArchivesIn[q] || {};
    const remoteDay = arch[k];
    const pushDoc = pushDay(local, remoteDay || null, now);
    if (!remoteDay || !deepEq(pushDoc, remoteDay)) {
      if (!plan[q]) plan[q] = {};
      plan[q][k] = pushDoc;
    }
  });
  return plan;
}

function planMigration(legacyDays: Record<string, DayShape>, now: number): {
  openDays: Record<string, DayShape>;
  archives: ArchiveMap;
} {
  const openDays: Record<string, DayShape> = {};
  const archives: ArchiveMap = {};
  Object.keys(legacyDays || {}).forEach((k) => {
    const day = normDay(legacyDays[k]);
    if (isRecentDay(k, now)) {
      openDays[k] = day;
    } else {
      const q = quarterKey(k);
      if (!archives[q]) archives[q] = {};
      archives[q][k] = day;
    }
  });
  return { openDays, archives };
}

/* ================= Remote apply ================= */

function applyDaysToLocal(state: AppState, days: Record<string, DayShape>): boolean {
  let changed = false;
  Object.keys(days || {}).forEach((k) => {
    let local = state.days[k];
    if (!local) local = state.days[k] = newDay();
    const r = mergeDay(local, days[k]);
    if (r.changed) { state.days[k] = r.day; changed = true; }
  });
  return changed;
}

function applyRemote(): void {
  const state = readLocal();
  if (!state) return;
  if (!state.days) state.days = {};
  if (!state.settings) state.settings = { resetHour: 0, theme: 'dark', sound: true, name: '' };
  let changed = false;

  if (applyDaysToLocal(state, remoteOpenDays)) changed = true;
  Object.keys(remoteArchives).forEach((q) => {
    if (applyDaysToLocal(state, remoteArchives[q])) changed = true;
  });

  if (remoteMeta) {
    const m = mergeMeta(state, remoteMeta);
    if (m.changed) {
      state.tomorrow = m.tomorrow;
      changed = true;
    }
  }

  if (changed) {
    writeLocal(state);
    logEvent('apply', 'merged remote changes into local');
    if (onRemoteCb) onRemoteCb();
  }
}

/* ================= Push ================= */

function pushDay(day: DayShape, remote: DayShape | null, now: number): DayShape {
  const rtsMap: Record<string, TaskShape> = {};
  ((remote && remote.tasks) || []).forEach((rt) => { rtsMap[rt.id] = rt; });
  const localOrderTs = day.orderTs || 0;
  const remoteOrderTs = (remote && remote.orderTs) || 0;
  const tasks = (day.tasks || []).map((t) => {
    const rt = rtsMap[t.id];
    const ts: TsMap = copyObj(t.ts || {});
    FIELDS.forEach((f) => {
      if (f === 'order') {
        if (rt && deepEq(t[f], rt[f])) {
          ts[f] = Math.max(ts[f] || 0, (rt.ts && rt.ts[f]) || 0);
        } else if (localOrderTs > remoteOrderTs) {
          ts[f] = now;
        } else if (rt) {
          ts[f] = (rt.ts && rt.ts[f]) || now;
        } else {
          ts[f] = now;
        }
        return;
      }
      if (rt && deepEq(t[f], rt[f])) {
        ts[f] = Math.max(ts[f] || 0, (rt.ts && rt.ts[f]) || 0);
      } else {
        ts[f] = now;
      }
    });
    const out = cloneTask(t);
    out.ts = ts;
    return out;
  });
  const doc: DayShape = {
    tasks,
    tombstones: mergeTombstones(day.tombstones, (remote && remote.tombstones) || undefined),
    note: day.note || '',
    focus: day.focus || null,
    reflection: day.reflection || '',
    fieldTs: copyObj(day.fieldTs || {}),
    orderTs: Math.max(localOrderTs, remoteOrderTs)
  };
  (['note', 'focus', 'reflection'] as Array<'note' | 'focus' | 'reflection'>).forEach((f) => {
    if (remote && deepEq(day[f] || '', remote[f] || '')) {
      doc.fieldTs[f] = Math.max(doc.fieldTs[f] || 0, (remote.fieldTs && remote.fieldTs[f]) || 0);
    } else {
      doc.fieldTs[f] = now;
    }
  });
  return doc;
}

function readLocalMeta(state: AppState, now: number, rm?: RemoteMeta | null): RemoteMeta {
  rm = rm || remoteMeta || undefined;
  const st = getSync();
  const lm: RemoteMeta = {
    owner: st ? st.hash : '',
    name: '',
    nameTs: 0,
    resetHour: 0,
    resetHourTs: 0,
    tomorrow: [],
    tomorrowTs: 0,
    schema: 'v3'
  };
  const localName = (state.settings && state.settings.name) || '';
  if (rm && typeof rm.name === 'string' && rm.name === localName) {
    lm.name = rm.name;
    lm.nameTs = rm.nameTs || 0;
  } else {
    lm.name = localName;
    lm.nameTs = now;
  }
  const localReset = (state.settings && typeof state.settings.resetHour === 'number') ? state.settings.resetHour : 0;
  if (rm && typeof rm.resetHour === 'number' && rm.resetHour === localReset) {
    lm.resetHour = rm.resetHour;
    lm.resetHourTs = rm.resetHourTs || 0;
  } else {
    lm.resetHour = localReset;
    lm.resetHourTs = now;
  }
  const localTomorrow = (state.tomorrow || []).map((t) => { return { id: t.id, text: t.text }; });
  const remoteTomorrow = (rm && rm.tomorrow || []).map((t) => { return { id: t.id, text: t.text }; });
  if (rm && deepEq(localTomorrow, remoteTomorrow)) {
    lm.tomorrow = rm.tomorrow;
    lm.tomorrowTs = rm.tomorrowTs || 0;
  } else {
    lm.tomorrow = localTomorrow;
    lm.tomorrowTs = now;
  }
  return lm;
}

function flush(): Promise<boolean> {
  if (!isPaired() || !initialized) return Promise.resolve(false);
  const state = readLocal();
  if (!state) return Promise.resolve(false);
  const st = getSync();
  if (!st) return Promise.resolve(false);
  const now = Date.now();
  const batch = db.batch();
  let ops = 0;

  const openDays = buildOpen(state, now);
  batch.set(openDoc, { days: openDays });
  ops++;
  batch.set(metaRef, readLocalMeta(state, now), { merge: true });
  ops++;

  logEvent('flush', 'open bundle with ' + Object.keys(openDays).length + ' days');
  return batch.commit().then(() => {
    dirty = false;
    syncError = null;
    touch();
    logEvent('flush-ok', '');
    notifyStatus();
  }).catch((e: any) => {
    const msg = (e && e.message) ? e.message : String(e);
    syncError = msg;
    logEvent('flush-error', msg);
    notifyStatus();
  });
}

function sweepArchives(): Promise<boolean> {
  if (!isPaired() || !initialized) return Promise.resolve(false);
  const state = readLocal();
  if (!state) return Promise.resolve(false);
  const st = getSync();
  if (!st) return Promise.resolve(false);
  const now = Date.now();
  const plan = planSweep(state, remoteArchives, now);
  const quarters = Object.keys(plan);
  if (!quarters.length) return Promise.resolve(false);
  const batch = db.batch();
  let ops = 0;
  quarters.forEach((q) => {
    batch.set(db.doc('users/' + st.hash + '/' + ARCHIVE_COL + '/' + q), { days: plan[q] }, { merge: true });
    ops++;
  });
  logEvent('sweep', 'archiving ' + Object.keys(plan).reduce((n, q) => n + Object.keys(plan[q]).length, 0) + ' day(s) into ' + quarters.join(', '));
  return batch.commit().then(() => {
    touch();
    logEvent('sweep-ok', '');
  }).catch((e: any) => {
    const msg = (e && e.message) ? e.message : String(e);
    syncError = msg;
    logEvent('sweep-error', msg);
    notifyStatus();
  });
}

function onLocalChange(): void {
  if (!isPaired()) return;
  dirty = true;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, 500);
}

function retryFlush(): void {
  if (!dirty || !isPaired() || !initialized) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, 300);
}

/* ================= Listeners ================= */

function stopListeners(): void {
  unsubs.forEach((u) => { try { u(); } catch (e) {} });
  unsubs = [];
}

function prime(): Promise<void> {
  return metaRef.get().then((snap: any) => {
    remoteMeta = snap.exists ? snap.data() as RemoteMeta : null;
    return openDoc.get().then((os: any) => {
      remoteOpenDays = os.exists && os.data() && os.data().days ? os.data().days as Record<string, DayShape> : {};
      return archiveCol.get().then((qs: any) => {
        remoteArchives = {};
        qs.forEach((d: any) => { remoteArchives[d.id] = d.data().days as Record<string, DayShape>; });
        initialized = true;
        touch();
        logEvent('prime', Object.keys(remoteOpenDays).length + ' open days, ' + qs.size + ' archive docs');
        applyRemote();
      });
    });
  });
}

function startListeners(): void {
  stopListeners();
  unsubs.push(openDoc.onSnapshot((snap: any) => {
    remoteOpenDays = snap.exists && snap.data() && snap.data().days ? snap.data().days as Record<string, DayShape> : {};
    pendingSyncWrites = pendingSyncWrites || !!(snap.metadata && snap.metadata.hasPendingWrites);
    if (!(snap.metadata && snap.metadata.fromCache)) touch();
    logEvent('snapshot-open', Object.keys(remoteOpenDays).length + ' days');
    applyRemote();
  }, (err: any) => {
    logEvent('snapshot-error', (err && err.message) ? err.message : String(err));
  }));
  unsubs.push(archiveCol.onSnapshot((snap: any) => {
    remoteArchives = {};
    snap.forEach((d: any) => { remoteArchives[d.id] = d.data().days as Record<string, DayShape>; });
    pendingSyncWrites = pendingSyncWrites || !!(snap.metadata && snap.metadata.hasPendingWrites);
    if (!(snap.metadata && snap.metadata.fromCache)) touch();
    logEvent('snapshot-archive', snap.size + ' docs');
    applyRemote();
  }, (err: any) => {
    logEvent('snapshot-error', (err && err.message) ? err.message : String(err));
  }));
  unsubs.push(metaRef.onSnapshot((snap: any) => {
    remoteMeta = snap.exists ? snap.data() as RemoteMeta : null;
    pendingSyncWrites = pendingSyncWrites || !!(snap.metadata && snap.metadata.hasPendingWrites);
    if (!(snap.metadata && snap.metadata.fromCache)) touch();
    logEvent('snapshot-meta', snap.exists ? 'present' : 'absent');
    applyRemote();
  }, (err: any) => {
    logEvent('snapshot-error', (err && err.message) ? err.message : String(err));
  }));
  try {
    db.onSnapshotsInSync(function () { Sync.online = true; pendingSyncWrites = false; touch(); });
  } catch (e) {}
}

function notifyStatus(): void {
  if (onStatusCb) onStatusCb();
}

/* ================= Migration (v2 -> v3) ================= */

function migrateLegacyDays(legacy: Record<string, DayShape>): Promise<void> {
  const st = getSync();
  if (!st) return Promise.resolve();
  const now = Date.now();
  const plan = planMigration(legacy, now);
  const legacyKeys = Object.keys(legacy);
  const batch = db.batch();
  batch.set(openDoc, { days: plan.openDays });
  Object.keys(plan.archives).forEach((q) => {
    batch.set(db.doc('users/' + st.hash + '/' + ARCHIVE_COL + '/' + q), { days: plan.archives[q] }, { merge: true });
  });
  legacyKeys.forEach((k) => {
    batch.delete(db.collection('users/' + st.hash + '/days').doc(k));
  });
  batch.set(metaRef, { schema: 'v3' }, { merge: true });
  remoteOpenDays = plan.openDays;
  remoteArchives = plan.archives;
  logEvent('migrate', legacyKeys.length + ' legacy days -> open(' + Object.keys(plan.openDays).length + ') + ' + Object.keys(plan.archives).length + ' archive docs');
  return batch.commit().then(() => {
    touch();
    logEvent('migrate-ok', '');
  }).catch((e: any) => {
    const msg = (e && e.message) ? e.message : String(e);
    syncError = msg;
    logEvent('migrate-error', msg);
    notifyStatus();
  });
}

function primeWithMigration(): Promise<void> {
  const st = getSync();
  if (!st) return Promise.resolve();
  const daysCol = db.collection('users/' + st.hash + '/days');
  return metaRef.get().then((snap: any) => {
    remoteMeta = snap.exists ? snap.data() as RemoteMeta : null;
    return daysCol.get().then((qs: any) => {
      const legacy: Record<string, DayShape> = {};
      qs.forEach((d: any) => { legacy[d.id] = d.data() as DayShape; });
      const legacyKeys = Object.keys(legacy);
      const needsMigration = !!(remoteMeta && remoteMeta.schema !== 'v3') || legacyKeys.length > 0;
      if (needsMigration) return migrateLegacyDays(legacy).then(() => prime());
      return prime();
    });
  });
}

/* ================= Pairing ================= */

function genCode(): string {
  let c = '';
  for (let i = 0; i < 12; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function ensureAuth(): Promise<any> {
  if (user) return Promise.resolve(user);
  return auth.signInAnonymously().then((r: any) => { user = r.user; return user; });
}

function pair(code: string): Promise<unknown> {
  const codeStr = String(code || '').trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
  if (codeStr.length < 6) return Promise.reject(new Error('code-too-short'));
  let st = getSync();
  if (!st || st.code !== codeStr) setSyncState({ code: codeStr, hash: hashCode(codeStr), paired: false });
  st = getSync();
  if (!st) return Promise.reject(new Error('no-sync-state'));
  return ensureAuth().then(() => {
    metaRef = db.doc('users/' + st.hash);
    openDoc = db.doc('users/' + st.hash + '/' + OPEN_DOC);
    archiveCol = db.collection('users/' + st.hash + '/' + ARCHIVE_COL);
    return metaRef.get().then((snap: any) => {
      if (!snap.exists) {
        return metaRef.set({ owner: st.hash, name: '', nameTs: 0, resetHour: 0, resetHourTs: 0, tomorrow: [], tomorrowTs: 0, schema: 'v3' }, { merge: true });
      }
    });
  }).then(() => {
    if (!st) return;
    st.paired = true;
    setSyncState(st);
    return primeWithMigration().then(() => {
      startListeners();
      flush();
      logEvent('pair-ok', 'paired');
      return st;
    });
  });
}

function start(): Promise<unknown> {
  const code = genCode();
  setSyncState({ code, hash: hashCode(code), paired: false });
  logEvent('start', 'generated new code ' + code);
  return pair(code);
}

function unpair(): void {
  stopListeners();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  initialized = false;
  remoteOpenDays = {};
  remoteArchives = {};
  remoteMeta = null;
  dirty = false;
  syncError = null;
  lastContact = 0;
  pendingSyncWrites = false;
  setSyncState(null);
  logEvent('unpair', '');
  notifyStatus();
}

/* ================= Init ================= */

function init(opts?: { onRemote?: () => void }): void {
  onRemoteCb = (opts && opts.onRemote) || null;
  try {
    app = firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth(app);
    db = firebase.firestore(app);
    db.enablePersistence().catch(() => {});
    auth.onAuthStateChanged((u: any) => { user = u; });
  } catch (e) {
    initError = (e && (e as Error).message) ? (e as Error).message : String(e);
    app = null; auth = null; db = null;
  }
  logEvent(initError ? 'init-error' : 'init', initError ? initError : 'firebase ready');
  const st = getSync();
  if (st && st.paired && db) {
    ensureAuth().then(() => {
      metaRef = db.doc('users/' + st.hash);
      openDoc = db.doc('users/' + st.hash + '/' + OPEN_DOC);
      archiveCol = db.collection('users/' + st.hash + '/' + ARCHIVE_COL);
      return primeWithMigration().then(() => {
        startListeners();
        flush();
      });
    }).catch(() => {});
  }
  window.addEventListener('online', () => { Sync.online = true; logEvent('online', ''); retryFlush(); notifyStatus(); });
  window.addEventListener('offline', () => { Sync.online = false; logEvent('offline', ''); notifyStatus(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      retryFlush();
      sweepArchives();
    }
  });
  setInterval(() => { retryFlush(); }, 30000);
  setInterval(heartbeat, HEARTBEAT_MS);
  notifyStatus();
}

/* ================= Public API ================= */

var root: any = typeof window !== 'undefined' ? window : global;

root.Sync = {
  state: null,
  online: true,
  isConfigured: () => !!db,
  getInitError: () => initError,
  isPaired,
  getCode: () => { const st = getSync(); return st ? st.code : ''; },
  getLog: readSyncLog,
  isDirty: () => dirty,
  getSyncError: () => syncError,
  getStatus: () => {
    const st = getSync();
    if (!st || !st.paired || !db) return { state: 'off', lastContact, dirty, error: null };
    if (syncError) return { state: 'error', lastContact, dirty, error: syncError };
    if (Sync.online === false || !lastContact || Date.now() - lastContact > STALE_MS) {
      return { state: 'stale', lastContact, dirty, error: null };
    }
    if (dirty || pendingSyncWrites) return { state: 'pending', lastContact, dirty, error: null };
    return { state: 'synced', lastContact, dirty, error: null };
  },
  init,
  start,
  pair,
  unpair,
  onLocalChange,
  onStatus: (cb: () => void) => { onStatusCb = cb; }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mergeTask,
    mergeDay,
    mergeMeta,
    mergeTombstones,
    isTombstoned,
    pushDay,
    readLocalMeta,
    cyrb53,
    hashCode,
    genCode,
    dayKey,
    quarterKey,
    isRecentDay,
    buildOpen,
    planSweep,
    planMigration
  };
}
})();
