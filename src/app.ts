(function () {
  'use strict';

  var STORAGE_KEY = 'daily-fresh-state-v2';
  var OLD_KEY = 'daily-fresh-state';
  var BACKUP_KEYS = ['daily-fresh-state-b1', 'daily-fresh-state-b2', 'daily-fresh-state-b3'];
  var CORRUPT_KEY = 'daily-fresh-state-corrupt';
  var APP_VERSION = 'v42';

  var state: AppState = load();
  var activeDay = state.activeDay || currentDayKey();
  var currentView = 'today';
  var doneOpen = false;
  var carryOpen = true;
  var toastTimer: number | null = null;
  var noteSaveTimer: number | null = null;
  var calView = currentMonth();
  var lastGreeting = '';

  /* ================= Storage ================= */

  function load(): AppState {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) raw = localStorage.getItem(OLD_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (raw === localStorage.getItem(OLD_KEY)) localStorage.removeItem(OLD_KEY);
          return migrate(parsed);
        }
        quarantine(raw);
      }
    } catch (e) {
      if (raw) quarantine(raw);
    }
    var recovered = recoverBackup();
    if (recovered) return recovered;
    return freshState();
  }

  function quarantine(raw: string) {
    try { localStorage.setItem(CORRUPT_KEY, raw); } catch (e) {}
  }

  function recoverBackup(): AppState | null {
    for (var i = 0; i < BACKUP_KEYS.length; i++) {
      try {
        var raw = localStorage.getItem(BACKUP_KEYS[i]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.days) {
          return migrate(parsed);
        }
      } catch (e) {}
    }
    return null;
  }

  function freshState(): AppState {
    return {
      settings: { resetHour: 0, theme: 'dark', sound: true, name: '' },
      days: {},
      onboarded: false
    };
  }

  function migrate(p: any): AppState {
    var s: AppState = {
      settings: { resetHour: 0, theme: 'dark', sound: true, name: '' },
      days: {},
      onboarded: true
    };
    if (p.settings) {
      if (typeof p.settings.resetHour === 'number') s.settings.resetHour = p.settings.resetHour;
      if (typeof p.settings.theme === 'string') s.settings.theme = p.settings.theme;
      if (typeof p.settings.sound === 'boolean') s.settings.sound = p.settings.sound;
      if (p.settings.name) s.settings.name = p.settings.name;
    }
    Object.keys(p.days || {}).forEach(function (k) {
      var raw = p.days[k];
      if (!raw || typeof raw !== 'object') return;
      if (Array.isArray(raw)) {
        s.days[k] = { tasks: raw, note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0 };
      } else {
        s.days[k] = {
          tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
          note: raw.note || '',
          focus: raw.focus || null,
          reflection: raw.reflection || '',
          tombstones: Array.isArray(raw.tombstones) ? raw.tombstones : [],
          fieldTs: (raw.fieldTs && typeof raw.fieldTs === 'object') ? raw.fieldTs : {},
          orderTs: typeof raw.orderTs === 'number' ? raw.orderTs : 0
        };
      }
    });
    if (typeof p.tomorrowTs === 'number') s.tomorrowTs = p.tomorrowTs;
    if (typeof p.nameTs === 'number') s.nameTs = p.nameTs;
    if (typeof p.resetHourTs === 'number') s.resetHourTs = p.resetHourTs;
    return s;
  }

  function rotateBackups(json: string) {
    for (var i = BACKUP_KEYS.length - 1; i >= 1; i--) {
      try {
        var prev = localStorage.getItem(BACKUP_KEYS[i - 1]);
        if (prev) localStorage.setItem(BACKUP_KEYS[i], prev);
      } catch (e) {}
    }
    try { localStorage.setItem(BACKUP_KEYS[0], json); } catch (e) {}
  }

  function save() {
    try {
      var json = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, json);
      rotateBackups(json);
    } catch (e) {}
    if (window.Sync && window.Sync.onLocalChange) window.Sync.onLocalChange();
  }

  function reloadFromDisk() {
    state = load();
    activeDay = state.activeDay || currentDayKey();
    if (!state.days[activeDay]) state.days[activeDay] = newDayObj();
    ensureDay(true);
  }

  /* ================= Day logic ================= */

  function newDayObj(): DayShape {
    return { tasks: [], note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0 };
  }

  function pad(n: number) { return n < 10 ? '0' + n : '' + n; }

  function currentDayKey() {
    var now = new Date();
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (now.getHours() < state.settings.resetHour) {
      d.setDate(d.getDate() - 1);
    }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function shiftKey(key: string, days: number) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2] + days);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function dayLabel(key: string) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var today = new Date();
    var todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var diff = Math.round((+todayStart - +d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return diff + ' days ago';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function fullDateLabel(key: string) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function isFirstDay() {
    return Object.keys(state.days).length <= 1;
  }

  function ensureDay(silent?: boolean) {
    var key = currentDayKey();
    if (activeDay === key) return;
    activeDay = key;
    state.activeDay = key;
    if (!state.days[key]) state.days[key] = newDayObj();
    save();
    if (!silent) {
      toast(isFirstDay() ? 'Welcome — your page is fresh' : 'A new day has begun');
    }
    render();
  }

  function dayObj(key: string): DayShape {
    if (!state.days[key]) state.days[key] = newDayObj();
    return state.days[key];
  }

  function today() { return dayObj(activeDay); }

  /* ================= Tasks ================= */

  function uid() {
    return Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  function parseEstimate(text: string) {
    var m = text.match(/(\d+(?:\.\d+)?)\s*h\s*(?:(\d+)\s*m)?\s*$/i);
    if (m) return Math.round(parseFloat(m[1]) * 60 + parseInt(m[2] || '0', 10));
    m = text.match(/(\d+)\s*m\s*$/i);
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  function fmtEstimate(min: number) {
    if (min < 60) return '~' + min + 'm';
    var h = Math.floor(min / 60);
    var rest = min % 60;
    return '~' + h + 'h' + (rest ? ' ' + rest + 'm' : '');
  }

  function makeTask(text: string): TaskShape {
    return {
      id: uid(),
      text: text,
      done: false,
      estimate: parseEstimate(text),
      order: 0,
      carriedFrom: null,
      created: new Date().toISOString(),
      doneAt: null,
      ts: null
    };
  }

  function addTask(raw: string) {
    var lines = String(raw).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) return;
    var day = today();
    lines.forEach(function (line) {
      var t = makeTask(line);
      t.order = day.tasks.length;
      day.tasks.push(t);
    });
    save();
    render();
    toast(lines.length === 1 ? 'Task added' : lines.length + ' tasks added');
  }

  function removeTask(id: string) {
    var day = today();
    var idx = day.tasks.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;
    pushUndo();
    if (day.focus === id) day.focus = null;
    if (!day.tombstones) day.tombstones = [];
    day.tombstones.push({ id: id, deletedAt: Date.now() });
    day.tasks.splice(idx, 1);
    save();
    render();
    toast('Task deleted', { label: 'Undo', fn: doUndo });
  }

  function toggleTask(id: string) {
    var day = today();
    var task = day.tasks.find(function (t) { return t.id === id; });
    if (!task) return;
    if (!task.done) pushUndo();
    task.done = !task.done;
    if (task.done) {
      task.doneAt = Date.now();
      if (task.carriedFrom) closeOrigin(task.carriedFrom);
      if (day.focus === id) day.focus = null;
      completeChime();
      if (allDone()) setTimeout(function () { toast('All done \u2014 enjoy your day'); }, 300);
      else toast('Completed', { label: 'Undo', fn: doUndo });
    } else {
      task.doneAt = null;
    }
    save();
    render();
  }

  function closeOrigin(cf: { day: string; id: string }) {
    var originDay = state.days[cf.day];
    if (!originDay) return;
    var origin = originDay.tasks.find(function (t) { return t.id === cf.id; });
    if (!origin) return;
    origin.done = true;
    origin.doneAt = Date.now();
    if (!origin.ts) origin.ts = {};
    origin.ts.done = Date.now();
  }

  function editTask(id: string, text: string) {
    var task = today().tasks.find(function (t) { return t.id === id; });
    if (!task) return;
    task.text = text.trim();
    save();
    render();
  }

  function toggleFocus(id: string) {
    var day = today();
    day.focus = day.focus === id ? null : id;
    save();
    render();
    if (day.focus) toast('Set as today\u2019s focus');
  }

  function allDone() {
    var tasks = today().tasks;
    return tasks.length > 0 && tasks.every(function (t) { return t.done; });
  }

  function orderedTasks(arr: TaskShape[]) {
    var idx: Record<string, number> = {};
    arr.forEach(function (t, i) { idx[t.id] = i; });
    return arr.slice().sort(function (a, b) {
      var oa = typeof a.order === 'number' ? a.order : idx[a.id];
      var ob = typeof b.order === 'number' ? b.order : idx[b.id];
      return oa - ob;
    });
  }

  /* ================= Carry over ================= */

  function carryCandidates(): { day: string; task: TaskShape }[] {
    var todayTasks = today().tasks;
    var carried: Record<string, boolean> = {};
    todayTasks.forEach(function (t) {
      if (t.carriedFrom) carried[t.carriedFrom.day + ':' + t.carriedFrom.id] = true;
    });
    var keys = Object.keys(state.days)
      .filter(function (k) { return k < activeDay; })
      .sort()
      .reverse();
    var res: { day: string; task: TaskShape }[] = [];
    keys.forEach(function (k) {
      state.days[k].tasks.forEach(function (t) {
        if (!t.done && !carried[k + ':' + t.id]) {
          res.push({ day: k, task: t });
        }
      });
    });
    return res;
  }

  function carryTask(dayKey: string, task: TaskShape, silent?: boolean) {
    pushUndo();
    var t: TaskShape = {
      id: uid(),
      text: task.text,
      done: false,
      estimate: task.estimate || parseEstimate(task.text),
      carriedFrom: { day: dayKey, id: task.id },
      created: new Date().toISOString(),
      order: 0,
      doneAt: null,
      ts: null
    };
    t.order = today().tasks.length;
    today().tasks.push(t);
    save();
    render();
    if (!silent) toast('Added to today', { label: 'Undo', fn: doUndo });
  }

  function carryAll() {
    var candidates = carryCandidates();
    if (!candidates.length) return;
    pushUndo();
    candidates.forEach(function (c) { carryTask(c.day, c.task, true); });
    toast(candidates.length + (candidates.length === 1 ? ' task' : ' tasks') + ' brought to today', { label: 'Undo', fn: doUndo });
  }

  /* ================= Undo ================= */

  var undoSnapshot: { dayKey: string; tasks: string; tombstones: string } | null = null;

  function pushUndo() {
    undoSnapshot = {
      dayKey: activeDay,
      tasks: JSON.stringify(today().tasks),
      tombstones: JSON.stringify(today().tombstones || [])
    };
  }

  function doUndo() {
    if (!undoSnapshot) return;
    var snap = undoSnapshot;
    undoSnapshot = null;
    if (!state.days[snap.dayKey]) state.days[snap.dayKey] = newDayObj();
    state.days[snap.dayKey].tasks = JSON.parse(snap.tasks);
    state.days[snap.dayKey].tombstones = JSON.parse(snap.tombstones || '[]');
    save();
    render();
    toast('Restored');
  }

  /* ================= Elements ================= */

  /** @returns {any} DOM element lookup; typed loosely so UI code stays unchecked */
  function $<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }

  var els = {
    greeting: $('greeting'),
    dayDate: $('dayDate'),
    ringFg: $('ringFg'),
    ringCount: $('ringCount'),
    taskInput: $<HTMLInputElement>('taskInput'),
    addRow: $('addRow'),
    taskList: $('taskList'),
    listHead: $('listHead'),
    listTitle: $('listTitle'),
    listSub: $('listSub'),
    doneList: $('doneList'),
    doneWrap: $('doneWrap'),
    doneToggle: $('doneToggle'),
    doneCount: $('doneCount'),
    emptyToday: $('emptyToday'),
    dayCompleteCard: $('dayCompleteCard'),
    reflectionCard: $('reflectionCard'),
    reflectionInput: $<HTMLTextAreaElement>('reflectionInput'),
    focusCard: $('focusCard'),
    focusTaskText: $('focusTaskText'),
    carryWrap: $('carryWrap'),
    carryCount: $('carryCount'),
    carryList: $('carryList'),
    carryToggle: $('carryToggle'),
    noteInput: $<HTMLTextAreaElement>('noteInput'),
    streakPill: $('streakPill'),
    historyList: $('historyList'),
    emptyHistory: $('emptyHistory'),
    recapCard: $('recapCard'),
    recapLine: $('recapLine'),
    statStreak: $('statStreak'),
    statDone: $('statDone'),
    statRate: $('statRate'),
    weekChart: $('weekChart'),
    calTitle: $('calTitle'),
    calGrid: $('calGrid'),
    resetHour: $<HTMLSelectElement>('resetHour'),
    themeSelect: $<HTMLSelectElement>('themeSelect'),
    soundToggle: $<HTMLInputElement>('soundToggle'),
    nameInput: $<HTMLInputElement>('nameInput'),
    exportBtn: $<HTMLButtonElement>('exportBtn'),
    importBtn: $<HTMLButtonElement>('importBtn'),
    importFile: $<HTMLInputElement>('importFile'),
    syncRow: $('syncRow'),
    syncStatus: $('syncStatus'),
    syncPill: $('syncPill'),
    syncPillLabel: $('syncPillLabel'),
    syncStartWrap: $('syncStartWrap'),
    syncStart: $<HTMLButtonElement>('syncStart'),
    syncBody: $('syncBody'),
    syncCode: $('syncCode'),
    syncCopy: $<HTMLButtonElement>('syncCopy'),
    syncQr: $('syncQr'),
    syncPairWrap: $('syncPairWrap'),
    syncInput: $<HTMLInputElement>('syncInput'),
    syncPairBtn: $<HTMLButtonElement>('syncPairBtn'),
    syncUnpair: $<HTMLButtonElement>('syncUnpair'),
    viewLogBtn: $<HTMLButtonElement>('viewLogBtn'),
    copyLogBtn: $<HTMLButtonElement>('copyLogBtn'),
    syncLogView: $('syncLogView')
  };

  /* ================= Sounds ================= */

  var audioCtx: AudioContext | null = null;

  function ensureAudio(): AudioContext | null {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq: number, delay: number, dur: number, gain: number, type?: OscillatorType) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime + delay;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function soundOn() { return state.settings.sound; }

  function completeChime() {
    if (!soundOn()) return;
    tone(880, 0, 0.16, 0.12);
    tone(1320, 0.12, 0.22, 0.1);
  }

  function focusChime() {
    if (!soundOn()) return;
    tone(660, 0, 0.2, 0.14);
    tone(880, 0.24, 0.2, 0.14);
    tone(1320, 0.48, 0.34, 0.14);
  }

  /* ================= Theme ================= */

  function applyTheme() {
    var pref = state.settings.theme || 'dark';
    var resolved = pref;
    if (pref === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#151a21' : '#f4f5f8');
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (state.settings.theme === 'system') applyTheme();
    });
  }

  /* ================= Rendering ================= */

  function escapeHtml(s: unknown) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function checkSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  }

  function starIcon(on: boolean) {
    return on
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z"/></svg>';
  }

  function pencilIcon() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
  }

  function xIcon() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  }

  function taskHtml(t: TaskShape, dayKey: string) {
    var isToday = dayKey === activeDay;
    var carriedTag = t.carriedFrom ? '<span class="carried-tag">carried</span>' : '';
    var estChip = t.estimate ? '<span class="est-chip">' + fmtEstimate(t.estimate) + '</span>' : '';
    var actions = '';
    if (isToday) {
      actions =
        '<div class="task-actions">' +
        '<button class="icon-btn star' + (dayObj(dayKey).focus === t.id ? ' on' : '') + '" data-star="' + t.id + '" title="Set as today\u2019s focus">' + starIcon(dayObj(dayKey).focus === t.id) + '</button>' +
        '<button class="icon-btn" data-edit="' + t.id + '" title="Edit">' + pencilIcon() + '</button>' +
        '<button class="icon-btn del" data-del="' + t.id + '" title="Delete">' + xIcon() + '</button>' +
        '</div>';
    }
    return (
      '<li class="task' + (t.done ? ' done' : '') + '" data-id="' + t.id + '">' +
      '<span class="drag-handle" title="Drag to reorder"><i></i><i></i><i></i></span>' +
      '<button class="check" data-check="' + t.id + '" aria-label="Toggle done">' + checkSvg() + '</button>' +
      '<span class="task-text" dir="auto">' + escapeHtml(t.text) + '</span>' +
      estChip +
      carriedTag +
      actions +
      '</li>'
    );
  }

  function render() {
    renderToday();
    renderHistory();
    renderSettings();
    renderNavBadges();
    renderSync();
  }

  /* ================= Sync UI ================= */

  function renderQr(code: string) {
    var box = els.syncQr;
    box.innerHTML = '';
    try {
      var qr = qrcode(0, 'L');
      qr.addData(code);
      qr.make();
      box.appendChild(qr.createImgTag(4, 8));
      box.classList.remove('hidden');
    } catch (e) {
      box.classList.add('hidden');
    }
  }

  function renderSyncStatus() {
    var pill = els.syncPill;
    if (!pill || !window.Sync || !window.Sync.getStatus || !window.Sync.isConfigured()) return;
    var st = window.Sync.getStatus();
    if (st.state === 'off') { pill.classList.add('hidden'); return; }
    pill.classList.remove('hidden');
    var text = '';
    if (st.state === 'synced') {
      text = 'Synced';
    } else if (st.state === 'desync') {
      text = 'Out of sync';
    } else if (st.state === 'pending') {
      text = 'Syncing\u2026';
    } else if (st.state === 'error') {
      text = 'Sync error';
    } else {
      text = 'Offline';
    }
    pill.classList.remove('synced', 'pending', 'error', 'stale', 'desync');
    pill.classList.add(st.state);
    if (els.syncPillLabel.textContent !== text) els.syncPillLabel.textContent = text;
  }

  function renderSync() {
    if (!els.syncRow || !window.Sync) return;
    if (!window.Sync.isConfigured()) {
      els.syncRow.classList.remove('hidden');
      els.syncStartWrap.classList.add('hidden');
      els.syncBody.classList.add('hidden');
      els.syncPairWrap.style.display = 'none';
      els.syncStatus.textContent = 'Sync unavailable: ' + (window.Sync.getInitError ? window.Sync.getInitError() : 'unknown');
      els.syncStatus.classList.add('offline');
      return;
    }
    els.syncRow.classList.remove('hidden');
    var paired = window.Sync.isPaired();
    els.syncStartWrap.classList.toggle('hidden', paired);
    els.syncBody.classList.toggle('hidden', !paired);
    els.syncPairWrap.style.display = paired ? 'none' : '';
    if (!paired) {
      els.syncStatus.textContent = 'Link this device to your other one';
      return;
    }
    var st = window.Sync.getStatus ? window.Sync.getStatus() : null;
    els.syncStatus.classList.remove('offline', 'desync');
    if (st) {
      if (st.state === 'error') {
        els.syncStatus.textContent = 'Sync failed \u2014 will retry';
        els.syncStatus.classList.add('offline');
      } else if (st.state === 'desync') {
        els.syncStatus.textContent = 'Out of sync \u2014 waiting for the server to confirm your changes';
        els.syncStatus.classList.add('desync');
      } else if (st.state === 'stale') {
        els.syncStatus.textContent = st.dirty
          ? 'Offline \u2014 changes saved locally, will sync'
          : 'Offline \u2014 will sync when back online';
        els.syncStatus.classList.add('offline');
      } else if (st.state === 'pending') {
        els.syncStatus.textContent = 'Syncing \u2014 sending your changes';
      } else {
        els.syncStatus.textContent = 'Live \u2014 everything up to date';
      }
    }
    var code = window.Sync.getCode();
    if (els.syncCode.textContent !== code) {
      els.syncCode.textContent = code;
      renderQr(code);
    }
  }

  function renderToday() {
    var day = today();
    var tasks = orderedTasks(day.tasks);
    var open = tasks.filter(function (t) { return !t.done; });
    var done = tasks.filter(function (t) { return t.done; });

    var g = greeting();
    if (g !== lastGreeting) { els.greeting.textContent = g; lastGreeting = g; }
    els.dayDate.textContent = fullDateLabel(activeDay);

    els.taskList.innerHTML = open.map(function (t) { return taskHtml(t, activeDay); }).join('');

    els.doneList.innerHTML = done.map(function (t) { return taskHtml(t, activeDay); }).join('');
    els.doneCount.textContent = done.length ? ' \u00b7 ' + done.length : '';
    var hasDone = done.length > 0;
    els.doneWrap.classList.toggle('hidden', !hasDone);
    if (!hasDone) doneOpen = false;
    els.doneToggle.classList.toggle('open', doneOpen);
    els.doneList.classList.toggle('hidden', !doneOpen);

    els.emptyToday.style.display = tasks.length ? 'none' : '';

    var completed = tasks.length && allDone();
    els.dayCompleteCard.classList.toggle('hidden', !completed);
    els.reflectionCard.classList.toggle('hidden', !completed);

    var remaining = open.length;
    els.listTitle.textContent = tasks.length ? 'Tasks' : '';
    var planned = open.reduce(function (a, t) { return a + (t.estimate || 0); }, 0);
    els.listSub.textContent = tasks.length
      ? remaining + (remaining === 1 ? ' remaining' : ' remaining') + (planned ? ' \u00b7 ' + fmtEstimate(planned) + ' planned' : '')
      : '';
    els.listHead.style.display = tasks.length ? '' : 'none';

    var total = tasks.length;
    var pct = total ? Math.round((done.length / total) * 100) : 0;
    els.ringFg.style.strokeDashoffset = (100 - pct).toFixed(1);
    els.ringCount.textContent = done.length + '/' + total;

    var st = streak();
    els.streakPill.classList.toggle('hidden', st < 2);
    els.streakPill.textContent = st + '-day streak';

    renderCarry();
    renderFocus();
    renderNote();
  }

  function greeting() {
    var h = new Date().getHours();
    var name = state.settings.name;
    var suffix = name ? ', ' + name : '';
    if (h < 5) return 'Working late' + suffix + '?';
    if (h < 12) return 'Good morning' + suffix;
    if (h < 18) return 'Good afternoon' + suffix;
    return 'Good evening' + suffix;
  }

  function renderFocus() {
    var day = today();
    var task = day.focus ? day.tasks.find(function (t) { return t.id === day.focus; }) : null;
    if (!task) {
      els.focusCard.classList.add('hidden');
      return;
    }
    els.focusCard.classList.remove('hidden');
    els.focusTaskText.textContent = task.text;
  }

  function renderCarry() {
    var candidates = carryCandidates();
    els.carryWrap.classList.toggle('hidden', candidates.length === 0);
    if (!candidates.length) return;
    els.carryCount.textContent = String(candidates.length);
    els.carryList.innerHTML = candidates.map(function (c) {
      return (
        '<button class="carry-item" data-carry="' + c.day + '" data-carry-id="' + c.task.id + '">' +
        '<span class="carry-day">' + dayLabel(c.day) + '</span>' +
        '<span class="carry-text" dir="auto">' + escapeHtml(c.task.text) + '</span>' +
        '</button>'
      );
    }).join('');
    els.carryList.style.display = carryOpen ? '' : 'none';
    els.carryToggle.classList.toggle('open', carryOpen);
  }

  function renderNote() {
    var val = today().note || '';
    if (document.activeElement !== els.noteInput) {
      els.noteInput.value = val;
    }
    var reflection = today().reflection || '';
    if (document.activeElement !== els.reflectionInput) {
      els.reflectionInput.value = reflection;
    }
  }

  /* ================= Stats ================= */

  function lastKeys(n: number) {
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(shiftKey(activeDay, -i));
    return keys.reverse();
  }

  function dayStats(key: string) {
    var d = state.days[key];
    if (!d || !d.tasks.length) return { total: 0, done: 0, ratio: 0, exists: false };
    var done = d.tasks.filter(function (t) { return t.done; }).length;
    return { total: d.tasks.length, done: done, ratio: done / d.tasks.length, exists: true };
  }

  function streak() {
    var s = 0;
    var key = activeDay;
    var st = dayStats(key);
    if (!st.exists) key = shiftKey(key, -1);
    while (true) {
      var ds = dayStats(key);
      if (ds.exists && ds.total === ds.done) {
        s++;
        key = shiftKey(key, -1);
      } else {
        break;
      }
    }
    return s;
  }

  function renderHistory() {
    var last7 = lastKeys(7);
    var totals = { done: 0, total: 0 };
    els.weekChart.innerHTML = last7.map(function (key) {
      var st = dayStats(key);
      totals.done += st.done;
      totals.total += st.total;
      var pct = st.total ? Math.max(4, st.ratio * 100) : 4;
      var date = new Date(key + 'T12:00:00');
      var label = date.toLocaleDateString(undefined, { weekday: 'narrow' });
      return (
        '<div class="chart-col" title="' + fullDateLabel(key) + (st.total ? ': ' + st.done + ' of ' + st.total + ' done' : ': no tasks') + '">' +
        '<div class="chart-bar-wrap"><div class="chart-bar' + (key === activeDay ? ' today' : '') + (st.exists ? '' : ' empty') + '" style="height:' + pct + '%"></div></div>' +
        '<span class="chart-label">' + label + '</span>' +
        '</div>'
      );
    }).join('');

    els.statStreak.textContent = String(streak());
    els.statDone.textContent = String(totals.done);
    els.statRate.textContent = totals.total ? Math.round((totals.done / totals.total) * 100) + '%' : '0%';

    renderRecap();
    renderCalendar();

    var keys = Object.keys(state.days)
      .filter(function (k) { return k !== activeDay && state.days[k].tasks.length > 0; })
      .sort()
      .reverse();
    els.historyList.innerHTML = keys.map(dayCardHtml).join('');
    els.emptyHistory.style.display = keys.length ? 'none' : '';
  }

  function renderRecap() {
    var keys = lastKeys(7);
    var total = 0;
    var best: { n: number; key: string } = { n: -1, key: '' };
    keys.forEach(function (k) {
      var st = dayStats(k);
      total += st.done;
      if (st.done > best.n) { best.n = st.done; best.key = k; }
    });
    if (!total) {
      els.recapCard.classList.add('hidden');
      return;
    }
    els.recapCard.classList.remove('hidden');
    var line = 'This week: <strong>' + total + '</strong> task' + (total === 1 ? '' : 's') + ' completed';
    if (best.n > 0) line += ' \u00b7 best day: <strong>' + dayLabel(best.key) + '</strong> (' + best.n + ')';
    line += '.';
    els.recapLine.innerHTML = line;
  }

  function dayCardHtml(k: string) {
    var tasks = orderedTasks(state.days[k].tasks);
    var done = tasks.filter(function (t) { return t.done; });
    var statsCls = tasks.length && done.length === tasks.length ? 'done-full' : '';
    var lis = tasks.map(function (t) {
      var carried = t.carriedFrom ? '<span class="carried">\u00b7 carried</span>' : '';
      return (
        '<li class="' + (t.done ? 'done' : '') + '">' +
        '<span class="tick">' + checkSvg() + '</span>' +
        '<span dir="auto">' + escapeHtml(t.text) + '</span>' +
        carried +
        '</li>'
      );
    }).join('');
    var note = state.days[k].note
      ? '<div class="day-note" dir="auto">' + escapeHtml(state.days[k].note) + '</div>'
      : '';
    var reflection = state.days[k].reflection
      ? '<div class="day-note reflect" dir="auto">' + escapeHtml(state.days[k].reflection) + '</div>'
      : '';
    return (
      '<div class="day-card" data-day="' + k + '">' +
      '<div class="day-card-head">' +
      '<span class="day-name">' + fullDateLabel(k) + '</span>' +
      '<span class="day-stats ' + statsCls + '">' + done.length + ' of ' + tasks.length + ' done</span>' +
      '<button class="del-day" data-del-day="' + k + '" title="Delete this day">Delete</button>' +
      '</div>' +
      '<ul>' + lis + '</ul>' +
      note +
      reflection +
      '</div>'
    );
  }

  /* ================= Calendar ================= */

  function currentMonth() {
    var d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  }

  function calKey(y: number, m: number, d: number) {
    return y + '-' + pad(m + 1) + '-' + pad(d);
  }

  function renderCalendar() {
    els.calTitle.textContent = new Date(calView.y, calView.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    var first = new Date(calView.y, calView.m, 1);
    var startDow = first.getDay();
    var daysInMonth = new Date(calView.y, calView.m + 1, 0).getDate();
    var html = '<span class="cal-dow">Su</span><span class="cal-dow">Mo</span><span class="cal-dow">Tu</span><span class="cal-dow">We</span><span class="cal-dow">Th</span><span class="cal-dow">Fr</span><span class="cal-dow">Sa</span>';
    for (var i = 0; i < startDow; i++) html += '<span class="cal-day empty-cell">.</span>';
    for (var d = 1; d <= daysInMonth; d++) {
      var key = calKey(calView.y, calView.m, d);
      var st = dayStats(key);
      var cls = st.exists ? (st.ratio >= 1 ? 'has-all' : 'has-part') : 'has-none';
      var todayCls = key === activeDay ? ' today-cell' : '';
      html += '<span class="cal-day ' + cls + todayCls + '" data-cal-day="' + key + '" title="' + fullDateLabel(key) + (st.total ? ': ' + st.done + ' of ' + st.total + ' done' : '') + '">' + d + '<i class="cal-dot"></i></span>';
    }
    els.calGrid.innerHTML = html;
  }

  /* ================= Settings ================= */

  function renderSettings() {
    var sel = els.resetHour;
    if (sel.options.length === 0) {
      for (var h = 0; h < 24; h++) {
        var opt = document.createElement('option');
        opt.value = String(h);
        var hour12 = h % 12 === 0 ? 12 : h % 12;
        opt.textContent = hour12 + ':00 ' + (h < 12 ? 'AM' : 'PM');
        sel.appendChild(opt);
      }
    }
    sel.value = String(state.settings.resetHour);
    els.themeSelect.value = state.settings.theme || 'dark';
    els.soundToggle.checked = !!state.settings.sound;
    els.nameInput.value = state.settings.name || '';
  }

  function renderNavBadges() {
    var candidates = carryCandidates().length;
    document.querySelectorAll<HTMLElement>('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === currentView);
    });
    var navToday = $('navToday');
    var badge = navToday.querySelector('.nav-count');
    if (candidates && currentView === 'today') {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'carry-count nav-count';
        navToday.appendChild(badge);
      }
      badge.textContent = String(candidates);
    } else if (badge) {
      badge.remove();
    }
  }

  /* ================= Toast ================= */

  var toastMsg: HTMLElement | null = null;
  var toastAct: HTMLButtonElement | null = null;

  function toast(msg: string, action?: { label: string; fn: () => void }) {
    var el = $('toast');
    if (!toastMsg) {
      toastMsg = document.createElement('span');
      el.appendChild(toastMsg);
    }
    toastMsg.textContent = msg;
    if (toastAct) {
      toastAct.remove();
      toastAct = null;
    }
    if (action) {
      toastAct = document.createElement('button');
      toastAct.className = 'toast-act';
      toastAct.textContent = action.label;
      toastAct.addEventListener('click', function () {
        el.classList.remove('show');
        action.fn();
      });
      el.appendChild(toastAct);
    }
    el.classList.add('show');
    clearTimeout(toastTimer ?? undefined);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, action ? 4200 : 2400);
  }

  /* ================= View switching ================= */

  function switchView(view: string) {
    currentView = view;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
    $(view + 'View').classList.remove('hidden');
    renderNavBadges();
    if (view === 'today') {
      focusTaskInput();
    } else if (view === 'history') {
      calView = currentMonth();
      renderCalendar();
    }
  }

  document.querySelectorAll<HTMLElement>('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { switchView(btn.dataset.view || 'today'); });
  });

  els.syncPill.addEventListener('click', function () { switchView('settings'); });

  /* ================= Today events ================= */

  function addCurrentTask() {
    var text = els.taskInput.value;
    if (!text.trim()) { els.taskInput.focus(); return; }
    addTask(text);
    els.taskInput.value = '';
    els.taskInput.focus();
  }

  function setAddExpanded(open: boolean) {
    els.addRow.classList.toggle('expanded', open);
    if (!open) dismissKeyboard();
  }

  function focusTaskInput() {
    setAddExpanded(true);
    els.taskInput.focus();
  }

  $('addBtn').addEventListener('click', function () {
    if (!isTouchScreen()) { addCurrentTask(); return; }
    if (els.addRow.classList.contains('expanded')) {
      if (els.taskInput.value.trim()) addCurrentTask();
      else setAddExpanded(false);
    } else {
      focusTaskInput();
    }
  });

  els.taskInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addCurrentTask();
  });

  function onTaskClick(e: MouseEvent) {
    var t = e.target as HTMLElement | null;
    if (!t) return;
    var check = t.closest<HTMLElement>('[data-check]');
    if (check) { toggleTask(check.dataset.check || ''); return; }
    var del = t.closest<HTMLElement>('[data-del]');
    if (del) { removeTask(del.dataset.del || ''); return; }
    var edit = t.closest<HTMLElement>('[data-edit]');
    if (edit) { startEdit(edit.dataset.edit || ''); return; }
    var star = t.closest<HTMLElement>('[data-star]');
    if (star) { toggleFocus(star.dataset.star || ''); return; }
  }

  els.taskList.addEventListener('click', onTaskClick);
  els.doneList.addEventListener('click', onTaskClick);

  function startEdit(id: string) {
    var li = els.taskList.querySelector('[data-id="' + id + '"]') ||
             els.doneList.querySelector('[data-id="' + id + '"]');
    if (!li) return;
    var textEl = li.querySelector('.task-text') as HTMLElement;
    var old = textEl.textContent;
    var input = document.createElement('input');
    input.className = 'task-edit-input';
    input.dir = 'auto';
    input.value = old || '';
    textEl.replaceWith(input);
    var actions = li.querySelector('.task-actions');
    if (actions) (actions as HTMLElement).style.display = 'none';
    input.focus();
    input.select();
    bringFocusedIntoView(input);
    var done = function (commit: boolean) {
      if (commit && input.value.trim()) editTask(id, input.value);
      render();
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', function () { done(true); });
  }

  els.carryToggle.addEventListener('click', function () {
    carryOpen = !carryOpen;
    els.carryList.style.display = carryOpen ? '' : 'none';
    els.carryToggle.classList.toggle('open', carryOpen);
  });

  els.carryList.addEventListener('click', function (e) {
    var t = e.target as HTMLElement | null;
    if (!t) return;
    var btn = t.closest<HTMLElement>('[data-carry]') as HTMLElement;
    if (!btn) return;
    var dayKey = btn.dataset.carry || '';
    var day = state.days[dayKey];
    if (day) {
      var task = day.tasks.find(function (t) { return t.id === btn.dataset.carryId; });
      if (task) carryTask(dayKey, task);
    }
  });

  $('carryAll').addEventListener('click', function (e) {
    e.stopPropagation();
    carryAll();
  });

  els.doneToggle.addEventListener('click', function () {
    doneOpen = !doneOpen;
    els.doneToggle.classList.toggle('open', doneOpen);
    els.doneList.classList.toggle('hidden', !doneOpen);
  });

  $('focusClear').addEventListener('click', function () {
    today().focus = null;
    save();
    renderToday();
  });

  $('focusStartBtn').addEventListener('click', openFocusModal);

  els.noteInput.addEventListener('input', function () {
    today().note = els.noteInput.value;
    clearTimeout(noteSaveTimer ?? undefined);
    noteSaveTimer = setTimeout(save, 350);
  });

  els.reflectionInput.addEventListener('input', function () {
    today().reflection = els.reflectionInput.value;
    clearTimeout(noteSaveTimer ?? undefined);
    noteSaveTimer = setTimeout(save, 350);
  });

  /* ================= History events ================= */

  els.historyList.addEventListener('click', function (e) {
    var t = e.target as HTMLElement | null;
    if (!t) return;
    var btn = t.closest<HTMLElement>('[data-del-day]');
    if (!btn) return;
    if (confirm('Delete this day from history? This cannot be undone.')) {
      delete state.days[btn.dataset.delDay || ''];
      save();
      render();
      toast('Day deleted');
    }
  });

  els.calGrid.addEventListener('click', function (e) {
    var t = e.target as HTMLElement | null;
    if (!t) return;
    var cell = t.closest<HTMLElement>('[data-cal-day]');
    if (!cell || cell.classList.contains('empty-cell')) return;
    var key = cell.dataset.calDay;
    if (key === activeDay) {
      switchView('today');
      return;
    }
    var card = els.historyList.querySelector('[data-day="' + key + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('calPrev').addEventListener('click', function () {
    calView.m--;
    if (calView.m < 0) { calView.m = 11; calView.y--; }
    renderCalendar();
  });

  $('calNext').addEventListener('click', function () {
    calView.m++;
    if (calView.m > 11) { calView.m = 0; calView.y++; }
    renderCalendar();
  });

  /* ================= Settings events ================= */

  els.resetHour.addEventListener('change', function () {
    state.settings.resetHour = +els.resetHour.value;
    save();
    ensureDay(true);
    toast('New day starts at ' + els.resetHour.options[els.resetHour.selectedIndex].textContent);
  });

  els.themeSelect.addEventListener('change', function () {
    state.settings.theme = els.themeSelect.value;
    save();
    applyTheme();
    toast('Theme updated');
  });

  els.soundToggle.addEventListener('change', function () {
    state.settings.sound = els.soundToggle.checked;
    save();
    if (state.settings.sound) completeChime();
    toast('Sounds ' + (state.settings.sound ? 'on' : 'off'));
  });

  els.nameInput.addEventListener('change', function () {
    state.settings.name = els.nameInput.value.trim();
    save();
    lastGreeting = '';
    renderToday();
    toast('Name saved');
  });

  /* ================= Sync events ================= */

  els.syncStart.addEventListener('click', function () {
    els.syncStart.disabled = true;
    els.syncStatus.textContent = 'Pairing\u2026';
    els.syncStatus.classList.remove('offline', 'desync');
    window.Sync.start().then(function () {
      render();
      toast('Sync started \u2014 scan or enter the code on your other device');
    }).catch(function (e) {
      var msg = (e && e.code) ? e.code : ((e && e.message) ? e.message : String(e));
      els.syncStatus.textContent = 'Sync failed: ' + msg;
      els.syncStatus.classList.add('offline');
      toast('Sync failed \u2014 ' + msg);
      els.syncStart.disabled = false;
    });
  });

  els.syncPairBtn.addEventListener('click', function () {
    var v = els.syncInput.value;
    if (!v.trim()) return;
    els.syncPairBtn.disabled = true;
    els.syncStatus.textContent = 'Pairing\u2026';
    els.syncStatus.classList.remove('offline', 'desync');
    window.Sync.pair(v).then(function () {
      els.syncInput.value = '';
      render();
      toast('Paired \u2014 syncing with your other device');
    }).catch(function (e) {
      var msg = (e && e.code) ? e.code : ((e && e.message) ? e.message : String(e));
      els.syncStatus.textContent = 'Pairing failed: ' + msg;
      els.syncStatus.classList.add('offline');
      toast('Pairing failed \u2014 ' + msg);
      els.syncPairBtn.disabled = false;
    });
  });

  els.syncInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') els.syncPairBtn.click();
  });

  els.syncCopy.addEventListener('click', function () {
    var code = window.Sync.getCode();
    if (code && navigator.clipboard) navigator.clipboard.writeText(code);
    toast('Code copied');
  });

  els.syncUnpair.addEventListener('click', function () {
    if (!confirm('Stop syncing? Tasks on this device stay here.')) return;
    window.Sync.unpair();
    render();
    toast('Sync stopped');
  });

  function currentSyncLog() {
    return (window.Sync && window.Sync.getLog) ? window.Sync.getLog() : [];
  }

  function fallbackCopy(text: string, done: (ok: boolean) => void) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    done(ok);
  }

  els.copyLogBtn.addEventListener('click', function () {
    var text = JSON.stringify(currentSyncLog(), null, 2);
    function done(ok: boolean) { toast(ok ? 'Sync log copied' : 'Copy failed \u2014 select and copy manually'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  });

  els.viewLogBtn.addEventListener('click', function () {
    var el = els.syncLogView;
    var hidden = el.classList.toggle('hidden');
    els.viewLogBtn.textContent = hidden ? 'View' : 'Hide';
    if (!hidden) {
      var lines = currentSyncLog().slice(-60).map(function (e) {
        var d = new Date(e.t);
        return d.toISOString().replace('T', ' ').slice(0, 19) + '  ' + e.type + '  ' + e.msg;
      });
      el.textContent = lines.length ? lines.join('\n') : '(no sync log entries yet)';
    }
  });

  $('resetDataBtn').addEventListener('click', function () {
    if (!confirm('Erase all tasks, notes and history? This cannot be undone.')) return;
    state = {
      settings: state.settings,
      days: {},
      onboarded: true
    };
    activeDay = currentDayKey();
    state.activeDay = activeDay;
    state.days[activeDay] = newDayObj();
    save();
    render();
    toast('Everything erased — a fresh start');
  });

  /* ================= Backup ================= */

  els.exportBtn.addEventListener('click', function () {
    var payload = {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      state: state,
      syncLog: (window.Sync && window.Sync.getLog) ? window.Sync.getLog() : []
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'daily-fresh-backup-' + activeDay + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    toast('Backup downloaded (includes sync log)');
  });

  els.importBtn.addEventListener('click', function () { els.importFile.click(); });

  els.importFile.addEventListener('change', function () {
    var input = this as HTMLInputElement;
    if (!input.files || !input.files.length) return;
    var file = input.files[0];
    input.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var result = reader.result;
        var data = JSON.parse(typeof result === 'string' ? result : '');
        if (data && data.state && typeof data.state.days === 'object') data = data.state;
        if (!data || typeof data.days !== 'object') throw new Error('invalid');
        state = migrate(data);
        state.onboarded = true;
        activeDay = currentDayKey();
        state.activeDay = activeDay;
        if (!state.days[activeDay]) state.days[activeDay] = newDayObj();
        save();
        applyTheme();
        render();
        toast('Backup restored');
      } catch (err) {
        toast('Import failed \u2014 invalid file');
      }
    };
    reader.readAsText(file);
  });

  /* ================= Drag & drop (pointer events for mouse, native touch events for iOS) ================= */

  var dragState: { id: string | undefined; el: HTMLElement; startClientY: number | null; moved: boolean; startTop: number; dy: number } | null = null;
  var touchTimer: number | null = null;
  var pressOrigin: { x: number; y: number } | null = null;
  var suppressClick = false;
  var autoScrollTimer: number | null = null;
  var dragIsTouch = false;

  function beginDrag(li: HTMLElement, isTouch: boolean) {
    clearTimeout(touchTimer ?? undefined);
    pressOrigin = null;
    dragIsTouch = isTouch;
    suppressClick = true;
    dragState = { id: li.dataset.id, el: li, startClientY: null, moved: false, startTop: li.getBoundingClientRect().top, dy: 0 };
    li.classList.add('dragging');
    li.style.touchAction = 'none';
    li.style.animation = 'none';
    if (navigator.vibrate) navigator.vibrate(10);
  }

  // ----- Mouse: drag via the handle (pointer events) -----

  els.taskList.addEventListener('pointerdown', function (e) {
    suppressClick = false;
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    var t = e.target as HTMLElement | null;
    if (!t) return;
    var li = t.closest<HTMLElement>('.task');
    if (!li || li.classList.contains('done')) return;
    if (t.closest('.drag-handle')) beginDrag(li, false);
  });

  window.addEventListener('pointermove', function (e) {
    if (dragState && !dragIsTouch) applyDrag(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', function () { if (!dragIsTouch) endDrag(true); });
  window.addEventListener('pointercancel', function () { if (!dragIsTouch) endDrag(false); });

  // ----- Touch: native touch events (long-press 1.25s anywhere on a task to drag) -----
  // Swiping (vertical move) scrolls the page; only a stationary long-press starts a drag.
  // iOS/WKWebView claims touch gestures (scroll, text selection, callouts) and cancels
  // the pointer stream, so we drive the drag from native touch events directly.

  function isTouchScreen() {
    return window.matchMedia('(hover: none)').matches;
  }

  els.taskList.addEventListener('touchstart', function (e) {
    if (document.body.classList.contains('keyboard-open')) dismissKeyboard();
    var t = e.target as HTMLElement | null;
    if (!t) return;
    var li = t.closest<HTMLElement>('.task:not(.done)') as HTMLElement;
    if (!li) return;
    suppressClick = false;
    var tt = e.touches[0];
    pressOrigin = { x: tt.clientX, y: tt.clientY };
    clearTimeout(touchTimer ?? undefined);
    touchTimer = setTimeout(function () { beginDrag(li, true); }, 1250);
  }, { passive: false });

  els.taskList.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    if (!t) return;
    if (dragState) {
      if (e.cancelable) e.preventDefault();
      applyDrag(t.clientX, t.clientY);
      return;
    }
    if (pressOrigin && (Math.abs(t.clientX - pressOrigin.x) > 10 || Math.abs(t.clientY - pressOrigin.y) > 10)) {
      clearTimeout(touchTimer ?? undefined);
      pressOrigin = null;
    }
  }, { passive: false });

  els.taskList.addEventListener('touchend', function () {
    clearTimeout(touchTimer ?? undefined);
    if (dragIsTouch) endDrag(true);
  });
  els.taskList.addEventListener('touchcancel', function () {
    clearTimeout(touchTimer ?? undefined);
    if (dragIsTouch) endDrag(false);
  });
  window.addEventListener('blur', function () { endDrag(false); });

  function applyDrag(clientX: number, clientY: number) {
    if (!dragState) return;
    var startY = dragState.startClientY === null ? clientY : dragState.startClientY;
    dragState.startClientY = startY;
    var dyTotal = clientY - startY;
    if (!dragState.moved && Math.abs(dyTotal) < 7) return;
    dragState.moved = true;

    var dragged = dragState.el;
    var layoutTop = dragged.getBoundingClientRect().top - dragState.dy;
    dragState.dy = (dragState.startTop + dyTotal) - layoutTop;

    dragged.style.transition = 'none';
    dragged.style.transform = 'translateY(' + dragState.dy + 'px) scale(1.02)';
    dragged.style.zIndex = '20';
    dragged.style.position = 'relative';

    var rect = dragged.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    var targets = els.taskList.querySelectorAll('.task');
    var inserted = false;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i] === dragged) continue;
      var tr = targets[i].getBoundingClientRect();
      if (midY < tr.top + tr.height / 2) {
        if (targets[i].previousElementSibling !== dragged) {
          els.taskList.insertBefore(dragged, targets[i]);
        }
        inserted = true;
        break;
      }
    }
    if (!inserted && els.taskList.lastElementChild !== dragged) {
      els.taskList.appendChild(dragged);
    }
    edgeScroll(clientY);
  }

  function edgeScroll(clientY: number) {
    var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    var zone = 40;
    var speed = 0;
    if (clientY < zone) speed = (zone - clientY) * 0.35;
    else if (clientY > vh - zone) speed = -(clientY - (vh - zone)) * 0.35;
    clearInterval(autoScrollTimer ?? undefined);
    autoScrollTimer = null;
    if (speed !== 0) {
      autoScrollTimer = setInterval(function () { window.scrollBy(0, speed); }, 16);
    }
  }

  function stopAutoScroll() {
    clearInterval(autoScrollTimer ?? undefined);
    autoScrollTimer = null;
  }

  function endDrag(commit: boolean) {
    clearTimeout(touchTimer ?? undefined);
    pressOrigin = null;
    stopAutoScroll();
    if (!dragState) return;
    var dragged = dragState.el;
    dragged.classList.remove('dragging');
    dragged.style.touchAction = '';
    dragged.style.transition = 'transform 0.18s ease';
    dragged.style.transform = '';
    dragged.style.zIndex = '';
    if (commit && dragState.moved) {
      var order: string[] = [];
      els.taskList.querySelectorAll<HTMLElement>('.task').forEach(function (li) { order.push(li.dataset.id || ''); });
      var tasks = today().tasks;
      tasks.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
      tasks.forEach(function (t, i) { t.order = i; });
      today().orderTs = Date.now();
      save();
      suppressClick = true;
    }
    dragState = null;
    dragIsTouch = false;
    renderToday();
  }

  els.taskList.addEventListener('click', function (e) {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
    }
  }, true);

  els.taskList.addEventListener('dragstart', function (e) { e.preventDefault(); });

  /* ================= Focus timer ================= */

  var timer: { preset: number; total: number; remaining: number; running: boolean; interval: number | null; endAt: number | null } = {
    preset: 25,
    total: 1500,
    remaining: 1500,
    running: false,
    interval: null,
    endAt: null
  };

  var TIMER_C = 389.56;

  function fmtTime(s: number) {
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return pad(m) + ':' + pad(sec);
  }

  function updateTimerUI() {
    $('timerTime').textContent = fmtTime(timer.remaining);
    var fg = document.querySelector('.timer-fg') as HTMLElement;
    fg.style.strokeDashoffset = String(TIMER_C * (1 - (timer.remaining / timer.total)));
    var modal = $('focusModal');
    var timerEl = modal.querySelector('.timer') as HTMLElement;
    timerEl.classList.toggle('running', timer.running);
    var btn = $('timerStart');
    btn.classList.toggle('running', timer.running);
    btn.textContent = timer.running ? 'Pause' : (timer.remaining < timer.total ? 'Resume' : 'Start');
  }

  function openFocusModal() {
    var task = today().tasks.find(function (t) { return t.id === today().focus; });
    if (!task) return;
    $('focusTaskName').textContent = task.text;
    $('focusModal').classList.remove('hidden');
    var modalEl = $('focusModal').querySelector('.modal') as HTMLElement;
    modalEl.classList.remove('modal-zoom-out');
    updateTimerUI();
  }

  function closeFocusModal() {
    $('focusModal').classList.add('hidden');
  }

  function syncTimer() {
    if (timer.endAt === null) return;
    timer.remaining = Math.max(0, (timer.endAt - Date.now()) / 1000);
    if (timer.remaining <= 0) {
      timer.remaining = 0;
      timer.running = false;
      timer.endAt = null;
      clearInterval(timer.interval ?? undefined);
      focusChime();
      toast('Focus session complete \u2014 nice work');
    }
    updateTimerUI();
  }

  function startTimerTick() {
    clearInterval(timer.interval ?? undefined);
    timer.endAt = Date.now() + timer.remaining * 1000;
    timer.interval = setInterval(syncTimer, 250);
  }

  $('timerStart').addEventListener('click', function () {
    ensureAudio();
    if (!timer.running) {
      timer.running = true;
      startTimerTick();
    } else {
      syncTimer();
      timer.running = false;
      timer.endAt = null;
      clearInterval(timer.interval ?? undefined);
    }
    updateTimerUI();
  });

  $('timerReset').addEventListener('click', function () {
    timer.running = false;
    timer.endAt = null;
    clearInterval(timer.interval ?? undefined);
    timer.total = timer.preset * 60;
    timer.remaining = timer.total;
    updateTimerUI();
  });

  $('timerPresets').addEventListener('click', function (e) {
    var t = e.target as HTMLElement | null;
    if (!t) return;
    var btn = t.closest<HTMLElement>('[data-min]');
    if (!btn) return;
    timer.running = false;
    timer.endAt = null;
    clearInterval(timer.interval ?? undefined);
    timer.preset = +(btn.dataset.min || 0);
    timer.total = timer.preset * 60;
    timer.remaining = timer.total;
    document.querySelectorAll<HTMLElement>('#timerPresets button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    updateTimerUI();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    ensureDay(true);
    if (timer.endAt !== null) syncTimer();
  });

  window.addEventListener('focus', function () { ensureDay(true); });

  $('focusClose').addEventListener('click', closeFocusModal);

  $('focusModal').addEventListener('click', function (e) {
    if (e.target === $('focusModal')) closeFocusModal();
  });

  /* ================= Onboarding ================= */

  function openOnboarding() {
    $('onboardModal').classList.remove('hidden');
    var nameInput = $<HTMLInputElement>('onboardName');
    if (state.settings.name) nameInput.value = state.settings.name;
    setTimeout(function () { nameInput.focus(); }, 100);
  }

  $('onboardStart').addEventListener('click', function () {
    var name = $<HTMLInputElement>('onboardName').value.trim();
    if (name) state.settings.name = name;
    state.onboarded = true;
    save();
    $('onboardModal').classList.add('hidden');
    lastGreeting = '';
    render();
    focusTaskInput();
    toast('Welcome' + (name ? ', ' + name : '') + ' \u2014 a fresh page awaits');
  });

  /* ================= Keyboard ================= */

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !isTyping(e.target)) {
      e.preventDefault();
      switchView('today');
      focusTaskInput();
    }
    if (e.key === 'Escape') {
      if (!$('focusModal').classList.contains('hidden')) closeFocusModal();
    }
  });

  function isTyping(el: EventTarget | null) {
    if (!el || !('tagName' in el)) return false;
    return (el as HTMLElement).tagName === 'INPUT' || (el as HTMLElement).tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
  }

  /* ================= Keyboard symbiosis ================= */

  function kbdSpace() {
    var vv = window.visualViewport;
    if (!vv) return 0;
    var open = vv.height < window.innerHeight * 0.82;
    var space = open ? Math.max(0, Math.round(window.innerHeight - vv.height)) : 0;
    document.documentElement.style.setProperty('--kbd-space', space + 'px');
    document.body.classList.toggle('keyboard-open', open);
    return open;
  }

  function dismissKeyboard() {
    var ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
  }

  /* ================= Keyboard focus helpers ================= */

  function bringFocusedIntoView(el: Element | null) {
    if (!document.body.classList.contains('keyboard-open')) return;
    if (el && typeof el.scrollIntoView === 'function') {
      setTimeout(function () {
        if (document.activeElement === el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 220);
    }
  }

  if (window.visualViewport) {
    var kbdSettleTimer: number | null = null;
    window.visualViewport.addEventListener('resize', function () {
      clearTimeout(kbdSettleTimer ?? undefined);
      kbdSettleTimer = setTimeout(function () {
        var open = kbdSpace();
        if (open) {
          var el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 160);
    });
    kbdSpace();
  }

  document.addEventListener('focusin', function (e) {
    if (isTyping(e.target)) bringFocusedIntoView(e.target as Element);
  });

  /* ================= PWA ================= */

  var deferredPrompt: BeforeInstallPromptEvent | null = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           !!window.navigator.standalone;
  }

  function isIOS() {
    var ua = navigator.userAgent;
    return /iphone|ipod/i.test(ua) || (/ipad|macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  }

  function updateInstallRow() {
    var row = $('installRow');
    if (!row) return;
    if (isStandalone() || (deferredPrompt as unknown) === false) {
      row.classList.add('hidden');
      return;
    }
    row.classList.remove('hidden');
    if (isIOS()) {
      var btn = $('installBtn');
      btn.textContent = 'How to';
      btn.dataset.ios = '1';
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    updateInstallRow();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    updateInstallRow();
    toast('App installed — welcome to the home screen');
  });

  $('installBtn').addEventListener('click', function () {
    if (deferredPrompt && deferredPrompt.prompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        updateInstallRow();
      });
    } else if ($('installBtn').dataset.ios) {
      toast('In Safari: tap Share \u2192 Add to Home Screen');
    } else {
      toast('Use your browser\u2019s menu \u2192 Install app');
    }
  });

  /* ================= Clock & rollover ================= */

  function tick() {
    var g = greeting();
    if (g !== lastGreeting) { els.greeting.textContent = g; lastGreeting = g; }
    renderSyncStatus();
    var key = currentDayKey();
    if (key !== activeDay) ensureDay();
  }

  setInterval(tick, 1000);

  /* ================= Boot ================= */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./dist/sw.js').catch(function () {});
    });
  }

  applyTheme();
  ensureDay(true);
  render();
  switchView('today');
  updateInstallRow();
  var versionEl = $('appVersion');
  if (versionEl) versionEl.textContent = APP_VERSION;
  if (!state.onboarded) openOnboarding();
  else focusTaskInput();
  if (window.Sync) {
    window.Sync.onStatus(function () { renderSync(); renderSyncStatus(); });
    window.Sync.init({ onRemote: function () { reloadFromDisk(); render(); } });
  }
  tick();
})();
