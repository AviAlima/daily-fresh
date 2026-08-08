(function () {
  'use strict';

  var Sync = {
    online: true
  };

  var SYNC_KEY = 'daily-fresh-sync-v1';
  var STORAGE_KEY = 'daily-fresh-state-v2';
  var LOG_KEY = 'daily-fresh-sync-log-v1';
  var MAX_LOG = 200;
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var FIELDS = ['done', 'text', 'priority', 'notes', 'carriedFrom', 'estimate', 'order'];

  var app = null, auth = null, db = null;
  var user = null;
  var metaRef = null, daysCol = null;
  var unsubs = [];
  var remoteDays = {};
  var remoteMeta = null;
  var pushTimer = null;
  var initialized = false;
  var onRemoteCb = null;
  var onStatusCb = null;
  var initError = null;
  var syncLog = null;
  var dirty = false;
  var syncError = null;

  /* ================= Hash ================= */

  function cyrb53(str, seed) {
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + '-' + (h1 >>> 0).toString(36);
  }

  function hashCode(code) {
    return cyrb53(code, 7) + '-' + cyrb53(code, 19);
  }

  /* ================= Storage ================= */

  function getSync() {
    if (!Sync.state) {
      try { Sync.state = JSON.parse(localStorage.getItem(SYNC_KEY)) || null; } catch (e) { Sync.state = null; }
    }
    return Sync.state;
  }

  function setSyncState(s) {
    Sync.state = s;
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }

  function writeLocal(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  /* ================= Sync log ================= */

  function readSyncLog() {
    if (!syncLog) {
      try { syncLog = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) { syncLog = []; }
    }
    return syncLog;
  }

  function logEvent(type, msg, data) {
    var entry = { t: Date.now(), type: type, msg: msg };
    if (data !== undefined) entry.d = data;
    var log = readSyncLog();
    log.push(entry);
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) {}
    var st = getSync();
    if (db && st && st.paired) {
      try {
        db.collection('users/' + st.hash + '/logs').add(entry).catch(function () {});
      } catch (e) {}
    }
  }

  function isPaired() {
    var st = getSync();
    return !!(st && st.paired && db);
  }

  /* ================= Utils ================= */

  /** @param {Object} o @returns {Object<string, any>} */
  function copyObj(o) {
    var out = {};
    Object.keys(o || {}).forEach(function (k) { out[k] = o[k]; });
    return out;
  }

  function deepEq(a, b) {
    if (a === b) return true;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var i = 0; i < ka.length; i++) {
        if (!(ka[i] in b) || !deepEq(a[ka[i]], b[ka[i]])) return false;
      }
      return true;
    }
    return false;
  }

  /** @param {TaskShape} t @returns {TaskShape} */
  function cloneTask(t) {
    return {
      id: t.id,
      text: t.text,
      done: !!t.done,
      priority: t.priority || 0,
      notes: t.notes || '',
      estimate: t.estimate || 0,
      order: typeof t.order === 'number' ? t.order : 0,
      carriedFrom: t.carriedFrom ? { day: t.carriedFrom.day, id: t.carriedFrom.id } : null,
      created: t.created || new Date().toISOString(),
      doneAt: t.doneAt || null,
      ts: t.ts ? copyObj(t.ts) : null
    };
  }

  /** @param {DayShape} d @returns {DayShape} */
  function normDay(d) {
    if (!d.tombstones) d.tombstones = [];
    if (!d.fieldTs) d.fieldTs = {};
    if (!d.orderTs) d.orderTs = 0;
    (d.tasks || []).forEach(function (t) { if (!t.ts) t.ts = {}; });
    return d;
  }

  function maxTs(ts) {
    var m = 0;
    Object.keys(ts || {}).forEach(function (k) { if (ts[k] > m) m = ts[k]; });
    return m;
  }

  function tombstoneOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function mergeTombstones(a, b) {
    var byId = {};
    (a || []).forEach(function (t) { byId[t.id] = t.deletedAt; });
    (b || []).forEach(function (t) {
      if (t.id in byId) byId[t.id] = Math.max(byId[t.id], t.deletedAt);
      else byId[t.id] = t.deletedAt;
    });
    var out = [];
    Object.keys(byId).forEach(function (id) { out.push({ id: id, deletedAt: byId[id] }); });
    return out;
  }

  function isTombstoned(list, id, ts) {
    var t = tombstoneOf(list, id);
    return !!t && t.deletedAt > maxTs(ts);
  }

  /* ================= Merge engine ================= */

  /** @param {TaskShape} lt @param {TaskShape} rt @returns {{task: TaskShape, changed: boolean}} */
  function mergeTask(lt, rt) {
    var changed = false;
    var out = cloneTask(lt);
    var lts = lt.ts || {}, rts = rt.ts || {};
    FIELDS.forEach(function (f) {
      if ((rts[f] || 0) > (lts[f] || 0)) {
        if (f === 'carriedFrom') {
          out.carriedFrom = rt.carriedFrom ? { day: rt.carriedFrom.day, id: rt.carriedFrom.id } : null;
        } else {
          out[f] = rt[f];
        }
        changed = true;
      }
    });
    if ((rts.done || 0) > (lts.done || 0)) out.doneAt = rt.doneAt || null;
    if (!out.ts) out.ts = {};
    Object.keys(rts).forEach(function (k) {
      if ((rts[k] || 0) > (out.ts[k] || 0)) out.ts[k] = rts[k];
    });
    return { task: out, changed: changed };
  }

  /** @param {DayShape} local @param {DayShape} remote @returns {{day: DayShape, changed: boolean}} */
  function mergeDay(local, remote) {
    var changed = false;
    var day = {
      tasks: (local.tasks || []).map(cloneTask),
      note: local.note || '',
      focus: local.focus || null,
      reflection: local.reflection || '',
      tombstones: mergeTombstones(local.tombstones, remote.tombstones),
      fieldTs: copyObj(local.fieldTs || {}),
      orderTs: local.orderTs || 0
    };
    var rft = remote.fieldTs || {};
    ['note', 'focus', 'reflection'].forEach(function (f) {
      if ((rft[f] || 0) > (day.fieldTs[f] || 0)) {
        day[f] = remote[f] || '';
        day.fieldTs[f] = rft[f];
        changed = true;
      }
    });

    var localById = {};
    day.tasks.forEach(function (t) { localById[t.id] = t; });
    var remoteById = {};
    (remote.tasks || []).forEach(function (t) { remoteById[t.id] = t; });

    var out = [];
    day.tasks.forEach(function (lt) {
      var rt = remoteById[lt.id];
      if (rt) {
        var m = mergeTask(lt, rt);
        if (m.changed) changed = true;
        out.push(m.task);
      } else {
        out.push(lt);
      }
    });
    (remote.tasks || []).forEach(function (rt) {
      if (localById[rt.id]) return;
      if (isTombstoned(day.tombstones, rt.id, rt.ts)) return;
      out.push(cloneTask(rt));
      changed = true;
    });
    var pruned = [];
    out.forEach(function (t) {
      if (isTombstoned(day.tombstones, t.id, t.ts)) { changed = true; return; }
      pruned.push(t);
    });
    day.tasks = pruned;
    if (day.focus && !pruned.some(function (t) { return t.id === day.focus; })) {
      day.focus = null;
      changed = true;
    }
    if ((remote.orderTs || 0) > day.orderTs) {
      var pos = {};
      (remote.tasks || []).forEach(function (rt, i) { pos[rt.id] = i; });
      day.tasks.sort(function (a, b) {
        var pa = pos[a.id], pb = pos[b.id];
        if (pa === undefined && pb === undefined) return 0;
        if (pa === undefined) return 1;
        if (pb === undefined) return -1;
        return pa - pb;
      });
      day.orderTs = remote.orderTs;
      changed = true;
    }
    return { day: day, changed: changed };
  }

  function mergeMeta(state, rm) {
    var changed = false;
    var tomorrow = state.tomorrow || [];
    var rts = rm.tomorrowTs || 0;
    if (rts > (state.tomorrowTs || 0)) {
      tomorrow = (rm.tomorrow || []).map(function (t) { return { id: t.id, text: t.text }; });
      state.tomorrowTs = rts;
      changed = true;
    }
    if ((rm.nameTs || 0) > (state.nameTs || 0) && typeof rm.name === 'string') {
      state.settings = state.settings || {};
      state.settings.name = rm.name;
      state.nameTs = rm.nameTs;
      changed = true;
    }
    if ((rm.resetHourTs || 0) > (state.resetHourTs || 0) && typeof rm.resetHour === 'number') {
      state.settings = state.settings || {};
      state.settings.resetHour = rm.resetHour;
      state.resetHourTs = rm.resetHourTs;
      changed = true;
    }
    return { tomorrow: tomorrow, changed: changed };
  }

  /* ================= Remote apply ================= */

  function applyRemote() {
    var state = readLocal();
    if (!state) return;
    if (!state.days) state.days = {};
    if (!state.settings) state.settings = {};
    var changed = false;

    Object.keys(remoteDays).forEach(function (k) {
      var local = state.days[k];
      if (!local) local = state.days[k] = { tasks: [], note: '', focus: null, reflection: '', tombstones: [], fieldTs: {} };
      var r = mergeDay(local, remoteDays[k]);
      if (r.changed) { state.days[k] = r.day; changed = true; }
    });

    if (remoteMeta) {
      var m = mergeMeta(state, remoteMeta);
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

  /** @param {DayShape} day @param {DayShape|null} remote @param {number} now @returns {DayShape} */
  function pushDay(day, remote, now) {
    var rtsMap = {};
    ((remote && remote.tasks) || []).forEach(function (rt) { rtsMap[rt.id] = rt; });
    var localOrderTs = day.orderTs || 0;
    var remoteOrderTs = (remote && remote.orderTs) || 0;
    var tasks = (day.tasks || []).map(function (t) {
      var rt = rtsMap[t.id];
      var ts = copyObj(t.ts || {});
      FIELDS.forEach(function (f) {
        if (f === 'order') {
          if (rt && deepEq(t[f], rt[f])) {
            if (!ts[f]) ts[f] = (rt.ts && rt.ts[f]) || now;
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
          if (!ts[f]) ts[f] = (rt.ts && rt.ts[f]) || now;
        } else {
          ts[f] = now;
        }
      });
      var out = cloneTask(t);
      out.ts = ts;
      return out;
    });
    var doc = {
      tasks: tasks,
      tombstones: mergeTombstones(day.tombstones, remote && remote.tombstones),
      note: day.note || '',
      focus: day.focus || null,
      reflection: day.reflection || '',
      fieldTs: copyObj(day.fieldTs || {}),
      orderTs: Math.max(localOrderTs, remoteOrderTs)
    };
    ['note', 'focus', 'reflection'].forEach(function (f) {
      if (remote && deepEq(day[f] || '', remote[f] || '')) {
        if (!doc.fieldTs[f] && remote.fieldTs) doc.fieldTs[f] = remote.fieldTs[f] || now;
      } else {
        doc.fieldTs[f] = now;
      }
    });
    return doc;
  }

  function readLocalMeta(state, now, rm) {
    rm = rm || remoteMeta;
    var st = getSync();
    var lm = { owner: st.hash };
    var localName = (state.settings && state.settings.name) || '';
    if (rm && typeof rm.name === 'string' && rm.name === localName) {
      lm.name = rm.name;
      lm.nameTs = rm.nameTs || 0;
    } else {
      lm.name = localName;
      lm.nameTs = now;
    }
    var localReset = (state.settings && typeof state.settings.resetHour === 'number') ? state.settings.resetHour : 0;
    if (rm && typeof rm.resetHour === 'number' && rm.resetHour === localReset) {
      lm.resetHour = rm.resetHour;
      lm.resetHourTs = rm.resetHourTs || 0;
    } else {
      lm.resetHour = localReset;
      lm.resetHourTs = now;
    }
    var localTomorrow = (state.tomorrow || []).map(function (t) { return { id: t.id, text: t.text }; });
    var remoteTomorrow = (rm && rm.tomorrow || []).map(function (t) { return { id: t.id, text: t.text }; });
    if (rm && deepEq(localTomorrow, remoteTomorrow)) {
      lm.tomorrow = rm.tomorrow;
      lm.tomorrowTs = rm.tomorrowTs || 0;
    } else {
      lm.tomorrow = localTomorrow;
      lm.tomorrowTs = now;
    }
    return lm;
  }

  function flush() {
    if (!isPaired() || !initialized) return Promise.resolve(false);
    var state = readLocal();
    if (!state) return Promise.resolve(false);
    var st = getSync();
    var now = Date.now();
    var batch = db.batch();
    var ops = 0;
    var dayKeys = [];

    Object.keys(state.days || {}).forEach(function (k) {
      var day = normDay(state.days[k]);
      batch.set(db.doc('users/' + st.hash + '/days/' + k), pushDay(day, remoteDays[k], now));
      ops++;
      dayKeys.push(k);
    });
    Object.keys(remoteDays).forEach(function (k) {
      if (!state.days || !state.days[k]) {
        batch.delete(db.doc('users/' + st.hash + '/days/' + k));
        ops++;
        dayKeys.push(k + ' (delete)');
      }
    });
    batch.set(metaRef, readLocalMeta(state, now), { merge: true });
    ops++;

    if (!ops) return Promise.resolve(false);
    logEvent('flush', 'pushing ' + dayKeys.join(', '));
    return batch.commit().then(function () {
      dirty = false;
      syncError = null;
      logEvent('flush-ok', '');
      notifyStatus();
    }).catch(function (e) {
      var msg = (e && e.message) ? e.message : String(e);
      syncError = msg;
      logEvent('flush-error', msg);
      notifyStatus();
    });
  }

  function onLocalChange() {
    if (!isPaired()) return;
    dirty = true;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, 500);
  }

  function retryFlush() {
    if (!dirty || !isPaired() || !initialized) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, 300);
  }

  /* ================= Listeners ================= */

  function stopListeners() {
    unsubs.forEach(function (u) { try { u(); } catch (e) {} });
    unsubs = [];
  }

  function prime() {
    return metaRef.get().then(function (snap) {
      remoteMeta = snap.exists ? snap.data() : null;
      return daysCol.get().then(function (qs) {
        remoteDays = {};
        qs.forEach(function (d) { remoteDays[d.id] = d.data(); });
        initialized = true;
        logEvent('prime', qs.size + ' day docs on server');
        applyRemote();
      });
    });
  }

  function startListeners() {
    stopListeners();
    unsubs.push(daysCol.onSnapshot(function (snap) {
      remoteDays = {};
      snap.forEach(function (d) { remoteDays[d.id] = d.data(); });
      logEvent('snapshot-days', snap.size + ' docs');
      applyRemote();
    }, function (err) {
      logEvent('snapshot-error', (err && err.message) ? err.message : String(err));
    }));
    unsubs.push(metaRef.onSnapshot(function (snap) {
      remoteMeta = snap.exists ? snap.data() : null;
      logEvent('snapshot-meta', snap.exists ? 'present' : 'absent');
      applyRemote();
    }, function (err) {
      logEvent('snapshot-error', (err && err.message) ? err.message : String(err));
    }));
    try {
      db.onSnapshotsInSync(function () { Sync.online = true; notifyStatus(); });
    } catch (e) {}
  }

  function notifyStatus() {
    if (onStatusCb) onStatusCb();
  }

  /* ================= Pairing ================= */

  function genCode() {
    var c = '';
    for (var i = 0; i < 12; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }

  function ensureAuth() {
    if (user) return Promise.resolve(user);
    return auth.signInAnonymously().then(function (r) { user = r.user; return user; });
  }

  function pair(code) {
    var codeStr = String(code || '').trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (codeStr.length < 6) return Promise.reject(new Error('code-too-short'));
    var st = getSync();
    if (!st || st.code !== codeStr) setSyncState({ code: codeStr, hash: hashCode(codeStr), paired: false });
    st = getSync();
    return ensureAuth().then(function () {
      metaRef = db.doc('users/' + st.hash);
      daysCol = db.collection('users/' + st.hash + '/days');
      return metaRef.get().then(function (snap) {
        if (!snap.exists) {
          return metaRef.set({ owner: st.hash, name: '', nameTs: 0, resetHour: 0, resetHourTs: 0, tomorrow: [], tomorrowTs: 0 }, { merge: true });
        }
      });
    }).then(function () {
      st.paired = true;
      setSyncState(st);
      return prime().then(function () {
        startListeners();
        flush();
        logEvent('pair-ok', 'paired');
        return st;
      });
    });
  }

  function start() {
    var code = genCode();
    setSyncState({ code: code, hash: hashCode(code), paired: false });
    logEvent('start', 'generated new code ' + code);
    return pair(code);
  }

  function unpair() {
    stopListeners();
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
    initialized = false;
    remoteDays = {};
    remoteMeta = null;
    dirty = false;
    syncError = null;
    setSyncState(null);
    logEvent('unpair', '');
    notifyStatus();
  }

  /* ================= Init ================= */

  function init(opts) {
    onRemoteCb = (opts && opts.onRemote) || null;
    if (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG) {
      try {
        app = firebase.initializeApp(FIREBASE_CONFIG);
        auth = firebase.auth(app);
        db = firebase.firestore(app);
        db.enablePersistence().catch(function () {});
        auth.onAuthStateChanged(function (u) { user = u; });
      } catch (e) {
        initError = (e && e.message) ? e.message : String(e);
        app = null; auth = null; db = null;
      }
    } else if (typeof FIREBASE_CONFIG === 'undefined') {
      initError = 'FIREBASE_CONFIG is not defined (firebase-config.js missing)';
    } else {
      initError = 'FIREBASE_CONFIG is null';
    }
    logEvent(initError ? 'init-error' : 'init', initError ? initError : 'firebase ready');
    var st = getSync();
    if (st && st.paired && db) {
      ensureAuth().then(function () {
        metaRef = db.doc('users/' + st.hash);
        daysCol = db.collection('users/' + st.hash + '/days');
        return prime().then(function () {
          startListeners();
          flush();
        });
      }).catch(function () {});
    }
    window.addEventListener('online', function () { Sync.online = true; logEvent('online', ''); retryFlush(); notifyStatus(); });
    window.addEventListener('offline', function () { Sync.online = false; logEvent('offline', ''); notifyStatus(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) retryFlush();
    });
    setInterval(function () { retryFlush(); }, 30000);
    notifyStatus();
  }

  /* ================= Public API ================= */

  var root = typeof window !== 'undefined' ? window : global;

  root.Sync = {
    state: null,
    online: true,
    isConfigured: function () { return !!db; },
    getInitError: function () { return initError; },
    isPaired: isPaired,
    getCode: function () { var st = getSync(); return st ? st.code : ''; },
    getLog: function () { return readSyncLog(); },
    isDirty: function () { return dirty; },
    getSyncError: function () { return syncError; },
    init: init,
    start: start,
    pair: pair,
    unpair: unpair,
    onLocalChange: onLocalChange,
    onStatus: function (cb) { onStatusCb = cb; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      mergeTask: mergeTask,
      mergeDay: mergeDay,
      mergeMeta: mergeMeta,
      mergeTombstones: mergeTombstones,
      isTombstoned: isTombstoned,
      pushDay: pushDay,
      readLocalMeta: readLocalMeta,
      cyrb53: cyrb53,
      hashCode: hashCode,
      genCode: genCode
    };
  }
})();
