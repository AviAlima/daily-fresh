(function () {
  'use strict';

  var STORAGE_KEY = 'daily-fresh-state-v2';
  var OLD_KEY = 'daily-fresh-state';

  var QUOTES = [
    'One task at a time is all it takes to move a mountain.',
    'The secret of getting ahead is getting started.',
    'You do not rise to the level of your goals. You fall to the level of your systems.',
    'Concentrate all your thoughts upon the work in hand.',
    'It always seems impossible until it is done.',
    'Begin with the end in mind.',
    'Small steps every day add up to big results.',
    'The best way to predict the future is to create it.',
    'Focus on being productive instead of busy.',
    'Discipline is choosing between what you want now and what you want most.',
    'Simplicity is the ultimate sophistication.',
    'Action is the foundational key to all success.',
    'How you spend your day is how you spend your life.',
    'Do the hard jobs first. The easy jobs will take care of themselves.',
    'A goal without a plan is just a wish.',
    'Every accomplishment starts with the decision to try.',
    'The shorter way to do many things is to do only one thing at a time.',
    'Well done is better than well said.'
  ];

  var state = load();
  var activeDay = state.activeDay || currentDayKey();
  var currentView = 'today';
  var doneOpen = false;
  var carryOpen = true;
  var openNoteId = null;
  var dragId = null;
  var toastTimer = null;
  var noteSaveTimer = null;
  var calView = currentMonth();
  var lastGreeting = '';

  /* ================= Storage ================= */

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) raw = localStorage.getItem(OLD_KEY);
      if (!raw) return freshState();
      var parsed = JSON.parse(raw);
      var migrated = migrate(parsed);
      if (raw === localStorage.getItem(OLD_KEY)) localStorage.removeItem(OLD_KEY);
      return migrated;
    } catch (e) {
      return freshState();
    }
  }

  function freshState() {
    return {
      settings: { resetHour: 0, theme: 'dark', sound: true, name: '' },
      days: {},
      onboarded: false
    };
  }

  function migrate(p) {
    var s = {
      settings: { resetHour: 0, theme: 'dark', sound: true, name: '' },
      days: {},
      onboarded: true
    };
    if (p.settings) {
      if (typeof p.settings.resetHour === 'number') s.settings.resetHour = p.settings.resetHour;
      if (p.settings.name) s.settings.name = p.settings.name;
    }
    Object.keys(p.days || {}).forEach(function (k) {
      var raw = p.days[k];
      if (Array.isArray(raw)) {
        s.days[k] = { tasks: raw, note: '', focus: null };
      } else {
        s.days[k] = { tasks: raw.tasks || [], note: raw.note || '', focus: raw.focus || null };
      }
    });
    return s;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  /* ================= Day logic ================= */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function currentDayKey() {
    var now = new Date();
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (now.getHours() < state.settings.resetHour) {
      d.setDate(d.getDate() - 1);
    }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function shiftKey(key, days) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2] + days);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function dayLabel(key) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var today = new Date();
    var todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var diff = Math.round((todayStart - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return diff + ' days ago';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function fullDateLabel(key) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function isFirstDay() {
    return Object.keys(state.days).length <= 1;
  }

  function ensureDay(silent) {
    var key = currentDayKey();
    if (activeDay === key) return;
    activeDay = key;
    state.activeDay = key;
    if (!state.days[key]) state.days[key] = { tasks: [], note: '', focus: null };
    save();
    if (!silent) {
      toast(isFirstDay() ? 'Welcome — your page is fresh' : 'A new day has begun');
      if (!isFirstDay()) confettiBurst();
    }
    render();
  }

  function dayObj(key) {
    if (!state.days[key]) state.days[key] = { tasks: [], note: '', focus: null };
    return state.days[key];
  }

  function today() { return dayObj(activeDay); }

  /* ================= Tasks ================= */

  function addTask(text) {
    var t = text.trim();
    if (!t) return;
    today().tasks.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      text: t,
      done: false,
      priority: 0,
      notes: '',
      carriedFrom: null,
      created: new Date().toISOString()
    });
    save();
    render();
    toast('Task added');
  }

  function removeTask(id) {
    var day = today();
    var idx = day.tasks.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;
    if (day.focus === id) day.focus = null;
    day.tasks.splice(idx, 1);
    save();
    render();
  }

  function toggleTask(id) {
    var day = today();
    var task = day.tasks.find(function (t) { return t.id === id; });
    if (!task) return;
    task.done = !task.done;
    if (task.done) {
      task.doneAt = Date.now();
      if (day.focus === id) day.focus = null;
      completeChime();
      if (allDone()) setTimeout(function () { toast('All done — enjoy your day'); }, 300);
    } else {
      task.doneAt = null;
    }
    save();
    render();
  }

  function editTask(id, text) {
    var task = today().tasks.find(function (t) { return t.id === id; });
    if (!task) return;
    task.text = text.trim();
    save();
    render();
  }

  function setPriority(id) {
    var task = today().tasks.find(function (t) { return t.id === id; });
    if (!task) return;
    task.priority = (task.priority + 1) % 4;
    save();
    render();
  }

  function setNotes(id, text) {
    var task = today().tasks.find(function (t) { return t.id === id; });
    if (!task) return;
    task.notes = text;
  }

  function toggleFocus(id) {
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

  /* ================= Carry over ================= */

  function carryCandidates() {
    var todayTasks = today().tasks;
    var carried = {};
    todayTasks.forEach(function (t) {
      if (t.carriedFrom) carried[t.carriedFrom.day + ':' + t.carriedFrom.id] = true;
    });
    var keys = Object.keys(state.days)
      .filter(function (k) { return k < activeDay; })
      .sort()
      .reverse();
    var res = [];
    keys.forEach(function (k) {
      state.days[k].tasks.forEach(function (t) {
        if (!t.done && !carried[k + ':' + t.id]) {
          res.push({ day: k, task: t });
        }
      });
    });
    return res;
  }

  function carryTask(dayKey, task) {
    today().tasks.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      text: task.text,
      done: false,
      priority: task.priority || 0,
      notes: task.notes || '',
      carriedFrom: { day: dayKey, id: task.id },
      created: new Date().toISOString()
    });
    save();
    render();
    toast('Added to today');
  }

  function carryAll() {
    var candidates = carryCandidates();
    if (!candidates.length) return;
    candidates.forEach(function (c) { carryTask(c.day, c.task); });
    toast(candidates.length + (candidates.length === 1 ? ' task' : ' tasks') + ' brought to today');
  }

  /* ================= Elements ================= */

  function $(id) { return document.getElementById(id); }

  var els = {
    greeting: $('greeting'),
    dayDate: $('dayDate'),
    clock: $('clock'),
    ringFg: document.querySelector('.ring-fg'),
    ringCount: $('ringCount'),
    taskInput: $('taskInput'),
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
    quoteCard: $('quoteCard'),
    quoteText: $('quoteText'),
    focusCard: $('focusCard'),
    focusTaskText: $('focusTaskText'),
    carryWrap: $('carryWrap'),
    carryCount: $('carryCount'),
    carryList: $('carryList'),
    carryToggle: $('carryToggle'),
    noteInput: $('noteInput'),
    historyList: $('historyList'),
    emptyHistory: $('emptyHistory'),
    statStreak: $('statStreak'),
    statDone: $('statDone'),
    statRate: $('statRate'),
    weekChart: $('weekChart'),
    calTitle: $('calTitle'),
    calGrid: $('calGrid'),
    resetHour: $('resetHour'),
    themeSelect: $('themeSelect'),
    soundToggle: $('soundToggle'),
    nameInput: $('nameInput')
  };

  /* ================= Sounds ================= */

  var audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, delay, dur, gain, type) {
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
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (state.settings.theme === 'system') applyTheme();
    });
  }

  /* ================= Rendering ================= */

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function checkSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  }

  function flagIcon(on) {
    return on
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M4 21V4.5C4 3.7 4.7 3 5.5 3h9.2c.8 0 1.5.7 1.5 1.5V7h2.3c.8 0 1.5.7 1.5 1.5v6.5c0 .8-.7 1.5-1.5 1.5H17v4.5c0 .5-.5 1-1 1H5c-.5 0-1-.5-1-1z"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4.5C4 3.7 4.7 3 5.5 3h9.2c.8 0 1.5.7 1.5 1.5V7h2.3c.8 0 1.5.7 1.5 1.5v6.5c0 .8-.7 1.5-1.5 1.5H17v4.5c0 .5-.5 1-1 1H5c-.5 0-1-.5-1-1z"/></svg>';
  }

  function starIcon(on) {
    return on
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z"/></svg>';
  }

  function noteIcon(on) {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  }

  function pencilIcon() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
  }

  function xIcon() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  }

  var PRIORITY_LABEL = ['', 'p-low', 'p-med', 'p-high'];

  function taskHtml(t, dayKey) {
    var isToday = dayKey === activeDay;
    var priorityDot = t.priority
      ? '<span class="priority-dot ' + PRIORITY_LABEL[t.priority] + '" title="Priority"></span>'
      : '';
    var carriedTag = t.carriedFrom ? '<span class="carried-tag">carried</span>' : '';
    var actions = '';
    if (isToday) {
      actions =
        '<div class="task-actions">' +
        '<button class="icon-btn star' + (dayObj(dayKey).focus === t.id ? ' on' : '') + '" data-star="' + t.id + '" title="Set as today\u2019s focus">' + starIcon(dayObj(dayKey).focus === t.id) + '</button>' +
        '<button class="icon-btn flag' + (t.priority ? ' on-' + PRIORITY_LABEL[t.priority] : '') + '" data-flag="' + t.id + '" title="Priority (cycles high \u2192 med \u2192 low)">' + flagIcon(!!t.priority) + '</button>' +
        '<button class="icon-btn note' + (openNoteId === t.id ? ' on' : '') + '" data-note="' + t.id + '" title="Notes">' + noteIcon() + '</button>' +
        '<button class="icon-btn" data-edit="' + t.id + '" title="Edit">' + pencilIcon() + '</button>' +
        '<button class="icon-btn del" data-del="' + t.id + '" title="Delete">' + xIcon() + '</button>' +
        '</div>';
    }
    var notePanel = '';
    if (isToday && openNoteId === t.id) {
      notePanel =
        '<div class="task-note-panel">' +
        '<textarea class="task-note-input" data-note-input="' + t.id + '" rows="2" placeholder="Notes for this task...">' + escapeHtml(t.notes || '') + '</textarea>' +
        '</div>';
    }
    return (
      '<li class="task' + (t.done ? ' done' : '') + '" data-id="' + t.id + '" draggable="' + (isToday && !t.done) + '">' +
      '<span class="drag-handle" title="Drag to reorder"><i></i><i></i><i></i></span>' +
      '<button class="check" data-check="' + t.id + '" aria-label="Toggle done">' + checkSvg() + '</button>' +
      priorityDot +
      '<span class="task-text">' + escapeHtml(t.text) + '</span>' +
      carriedTag +
      actions +
      notePanel +
      '</li>'
    );
  }

  function render() {
    renderToday();
    renderHistory();
    renderSettings();
    renderNavBadges();
  }

  function renderToday() {
    var day = today();
    var tasks = day.tasks;
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

    els.dayCompleteCard.classList.toggle('hidden', !(tasks.length && allDone()));

    var remaining = open.length;
    els.listTitle.textContent = tasks.length ? 'Tasks' : '';
    els.listSub.textContent = tasks.length ? remaining + (remaining === 1 ? ' remaining' : ' remaining') : '';
    els.listHead.style.display = tasks.length ? '' : 'none';

    var total = tasks.length;
    var pct = total ? Math.round((done.length / total) * 100) : 0;
    els.ringFg.style.strokeDashoffset = (100 - pct).toFixed(1);
    els.ringCount.textContent = done.length + '/' + total;

    renderCarry();
    renderFocus();
    renderQuote();
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

  function renderQuote() {
    var d = new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    var dayOfYear = Math.floor((d - start) / 86400000);
    els.quoteText.textContent = QUOTES[dayOfYear % QUOTES.length];
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
    els.carryCount.textContent = candidates.length;
    els.carryList.innerHTML = candidates.map(function (c) {
      return (
        '<button class="carry-item" data-carry="' + c.day + '" data-carry-id="' + c.task.id + '">' +
        '<span class="carry-day">' + dayLabel(c.day) + '</span>' +
        '<span class="carry-text">' + escapeHtml(c.task.text) + '</span>' +
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
  }

  /* ================= Stats ================= */

  function lastKeys(n) {
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(shiftKey(activeDay, -i));
    return keys.reverse();
  }

  function dayStats(key) {
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

    els.statStreak.textContent = streak();
    els.statDone.textContent = totals.done;
    els.statRate.textContent = totals.total ? Math.round((totals.done / totals.total) * 100) + '%' : '0%';

    renderCalendar();

    var keys = Object.keys(state.days)
      .filter(function (k) { return k !== activeDay && state.days[k].tasks.length > 0; })
      .sort()
      .reverse();
    els.historyList.innerHTML = keys.map(dayCardHtml).join('');
    els.emptyHistory.style.display = keys.length ? 'none' : '';
  }

  function dayCardHtml(k) {
    var tasks = state.days[k].tasks;
    var done = tasks.filter(function (t) { return t.done; });
    var statsCls = tasks.length && done.length === tasks.length ? 'done-full' : '';
    var lis = tasks.map(function (t) {
      var carried = t.carriedFrom ? '<span class="carried">\u00b7 carried</span>' : '';
      return (
        '<li class="' + (t.done ? 'done' : '') + '">' +
        '<span class="tick">' + checkSvg() + '</span>' +
        '<span>' + escapeHtml(t.text) + '</span>' +
        carried +
        '</li>'
      );
    }).join('');
    var note = state.days[k].note
      ? '<div class="day-note">' + escapeHtml(state.days[k].note) + '</div>'
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
      '</div>'
    );
  }

  /* ================= Calendar ================= */

  function currentMonth() {
    var d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  }

  function calKey(y, m, d) {
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
        opt.value = h;
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
    document.querySelectorAll('.nav-btn').forEach(function (b) {
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
      badge.textContent = candidates;
    } else if (badge) {
      badge.remove();
    }
  }

  /* ================= Toast ================= */

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  /* ================= Confetti ================= */

  function confettiBurst() {
    var colors = ['#4f8cff', '#4cd07d', '#ffd166', '#ff6b9d', '#9b7bff'];
    for (var i = 0; i < 42; i++) {
      (function () {
        var p = document.createElement('div');
        p.style.cssText =
          'position:fixed;z-index:200;width:8px;height:8px;border-radius:2px;' +
          'background:' + colors[i % colors.length] + ';' +
          'left:' + (25 + Math.random() * 50) + 'vw;' +
          'top:-10px;pointer-events:none;';
        document.body.appendChild(p);
        var dx = (Math.random() - 0.5) * 160;
        var rot = (Math.random() - 0.5) * 720;
        p.animate(
          [
            { transform: 'translate(0,0) rotate(0)', opacity: 1 },
            { transform: 'translate(' + dx + 'px,' + (window.innerHeight * 0.7 + Math.random() * 120) + 'px) rotate(' + rot + 'deg)', opacity: 0 }
          ],
          { duration: 1500 + Math.random() * 900, easing: 'cubic-bezier(0.2,0.6,0.4,1)' }
        ).onfinish = function () { p.remove(); };
      })();
    }
  }

  /* ================= View switching ================= */

  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
    $(view + 'View').classList.remove('hidden');
    renderNavBadges();
    if (view === 'today') {
      els.taskInput.focus();
    } else if (view === 'history') {
      calView = currentMonth();
      renderCalendar();
    }
  }

  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { switchView(btn.dataset.view); });
  });

  /* ================= Today events ================= */

  function addCurrentTask() {
    var text = els.taskInput.value;
    if (!text.trim()) { els.taskInput.focus(); return; }
    addTask(text);
    els.taskInput.value = '';
    els.taskInput.focus();
  }

  $('addBtn').addEventListener('click', addCurrentTask);

  els.taskInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addCurrentTask();
  });

  function onTaskClick(e) {
    var check = e.target.closest('[data-check]');
    if (check) { toggleTask(check.dataset.check); return; }
    var del = e.target.closest('[data-del]');
    if (del) { removeTask(del.dataset.del); return; }
    var edit = e.target.closest('[data-edit]');
    if (edit) { startEdit(edit.dataset.edit); return; }
    var star = e.target.closest('[data-star]');
    if (star) { toggleFocus(star.dataset.star); return; }
    var flag = e.target.closest('[data-flag]');
    if (flag) { setPriority(flag.dataset.flag); return; }
    var note = e.target.closest('[data-note]');
    if (note) {
      openNoteId = openNoteId === note.dataset.note ? null : note.dataset.note;
      renderToday();
      if (openNoteId) {
        var input = document.querySelector('[data-note-input="' + openNoteId + '"]');
        if (input) input.focus();
      }
      return;
    }
  }

  els.taskList.addEventListener('click', onTaskClick);
  els.doneList.addEventListener('click', onTaskClick);

  function startEdit(id) {
    var li = els.taskList.querySelector('[data-id="' + id + '"]') ||
             els.doneList.querySelector('[data-id="' + id + '"]');
    if (!li) return;
    var textEl = li.querySelector('.task-text');
    var old = textEl.textContent;
    var input = document.createElement('input');
    input.className = 'task-edit-input';
    input.value = old;
    textEl.replaceWith(input);
    var actions = li.querySelector('.task-actions');
    if (actions) actions.style.display = 'none';
    input.focus();
    input.select();
    bringFocusedIntoView(input);
    var done = function (commit) {
      if (commit && input.value.trim()) editTask(id, input.value);
      render();
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', function () { done(true); });
  }

  document.addEventListener('input', function (e) {
    if (e.target.matches('[data-note-input]')) {
      var task = today().tasks.find(function (t) { return t.id === e.target.dataset.noteInput; });
      if (task) {
        setNotes(task.id, e.target.value);
        save();
      }
    }
  });

  els.carryToggle.addEventListener('click', function () {
    carryOpen = !carryOpen;
    els.carryList.style.display = carryOpen ? '' : 'none';
    els.carryToggle.classList.toggle('open', carryOpen);
  });

  els.carryList.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-carry]');
    if (!btn) return;
    var dayKey = btn.dataset.carry;
    var task = state.days[dayKey].tasks.find(function (t) { return t.id === btn.dataset.carryId; });
    if (task) carryTask(dayKey, task);
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
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(save, 350);
  });

  /* ================= History events ================= */

  els.historyList.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del-day]');
    if (!btn) return;
    if (confirm('Delete this day from history? This cannot be undone.')) {
      delete state.days[btn.dataset.delDay];
      save();
      render();
      toast('Day deleted');
    }
  });

  els.calGrid.addEventListener('click', function (e) {
    var cell = e.target.closest('[data-cal-day]');
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

  $('resetDataBtn').addEventListener('click', function () {
    if (!confirm('Erase all tasks, notes and history? This cannot be undone.')) return;
    state = {
      settings: state.settings,
      days: {},
      onboarded: true
    };
    activeDay = currentDayKey();
    state.activeDay = activeDay;
    state.days[activeDay] = { tasks: [], note: '', focus: null };
    save();
    render();
    toast('Everything erased — a fresh start');
  });

  /* ================= Drag & drop ================= */

  els.taskList.addEventListener('dragstart', function (e) {
    var li = e.target.closest('.task');
    if (!li || li.querySelector('.task-note-input')) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    els.taskList.classList.add('dragging-list');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
  });

  els.taskList.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (!dragId) return;
    e.dataTransfer.dropEffect = 'move';
    var li = e.target.closest('.task');
    if (!li || li.dataset.id === dragId) return;
    var rect = li.getBoundingClientRect();
    var before = e.clientY < rect.top + rect.height / 2;
    var tasks = today().tasks;
    var fromIdx = tasks.findIndex(function (t) { return t.id === dragId; });
    var toIdx = tasks.findIndex(function (t) { return t.id === li.dataset.id; });
    if (fromIdx === -1 || toIdx === -1) return;
    tasks.splice(fromIdx, 1);
    toIdx = tasks.findIndex(function (t) { return t.id === li.dataset.id; });
    if (!before) toIdx++;
    tasks.splice(Math.max(0, toIdx), 0, tasks.splice(fromIdx < toIdx ? fromIdx : fromIdx, 1)[0]);
    save();
    renderToday();
  });

  els.taskList.addEventListener('dragend', function () {
    dragId = null;
    els.taskList.classList.remove('dragging-list');
    renderToday();
  });

  /* ================= Focus timer ================= */

  var timer = {
    preset: 25,
    total: 1500,
    remaining: 1500,
    running: false,
    interval: null
  };

  var TIMER_C = 389.56;

  function fmtTime(s) {
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return pad(m) + ':' + pad(sec);
  }

  function updateTimerUI() {
    $('timerTime').textContent = fmtTime(timer.remaining);
    var fg = document.querySelector('.timer-fg');
    fg.style.strokeDashoffset = TIMER_C * (1 - (timer.remaining / timer.total));
    var modal = $('focusModal');
    modal.querySelector('.timer').classList.toggle('running', timer.running);
    var btn = $('timerStart');
    btn.classList.toggle('running', timer.running);
    btn.textContent = timer.running ? 'Pause' : (timer.remaining < timer.total ? 'Resume' : 'Start');
  }

  function openFocusModal() {
    var task = today().tasks.find(function (t) { return t.id === today().focus; });
    if (!task) return;
    $('focusTaskName').textContent = task.text;
    $('focusModal').classList.remove('hidden');
    $('focusModal').querySelector('.modal').classList.remove('modal-zoom-out');
    updateTimerUI();
  }

  function closeFocusModal() {
    $('focusModal').classList.add('hidden');
  }

  function startTimerTick() {
    clearInterval(timer.interval);
    timer.interval = setInterval(function () {
      if (!timer.running) return;
      timer.remaining -= 0.25;
      if (timer.remaining <= 0) {
        timer.remaining = 0;
        timer.running = false;
        clearInterval(timer.interval);
        focusChime();
        toast('Focus session complete \u2014 nice work');
        updateTimerUI();
        return;
      }
      updateTimerUI();
    }, 250);
  }

  $('timerStart').addEventListener('click', function () {
    ensureAudio();
    timer.running = !timer.running;
    if (timer.running) startTimerTick();
    else clearInterval(timer.interval);
    updateTimerUI();
  });

  $('timerReset').addEventListener('click', function () {
    timer.running = false;
    clearInterval(timer.interval);
    timer.total = timer.preset * 60;
    timer.remaining = timer.total;
    updateTimerUI();
  });

  $('timerPresets').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-min]');
    if (!btn) return;
    timer.running = false;
    clearInterval(timer.interval);
    timer.preset = +btn.dataset.min;
    timer.total = timer.preset * 60;
    timer.remaining = timer.total;
    document.querySelectorAll('#timerPresets button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    updateTimerUI();
  });

  $('focusClose').addEventListener('click', closeFocusModal);

  $('focusModal').addEventListener('click', function (e) {
    if (e.target === $('focusModal')) closeFocusModal();
  });

  /* ================= Onboarding ================= */

  function openOnboarding() {
    $('onboardModal').classList.remove('hidden');
    var nameInput = $('onboardName');
    if (state.settings.name) nameInput.value = state.settings.name;
    setTimeout(function () { nameInput.focus(); }, 100);
  }

  $('onboardStart').addEventListener('click', function () {
    var name = $('onboardName').value.trim();
    if (name) state.settings.name = name;
    state.onboarded = true;
    save();
    $('onboardModal').classList.add('hidden');
    lastGreeting = '';
    render();
    els.taskInput.focus();
    toast('Welcome' + (name ? ', ' + name : '') + ' \u2014 a fresh page awaits');
  });

  /* ================= Keyboard ================= */

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !isTyping(e.target)) {
      e.preventDefault();
      switchView('today');
      els.taskInput.focus();
    }
    if (e.key === 'Escape') {
      if (!$('focusModal').classList.contains('hidden')) closeFocusModal();
    }
  });

  function isTyping(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
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

  function bringFocusedIntoView(el) {
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
    var kbdSettleTimer = null;
    window.visualViewport.addEventListener('resize', function () {
      clearTimeout(kbdSettleTimer);
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
    if (isTyping(e.target)) bringFocusedIntoView(e.target);
  });

  /* ================= Clock & rollover ================= */

  function tick() {
    var now = new Date();
    var time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    if (els.clock.textContent !== time) {
      els.clock.textContent = time;
      var g = greeting();
      if (g !== lastGreeting) { els.greeting.textContent = g; lastGreeting = g; }
    }
    var key = currentDayKey();
    if (key !== activeDay) ensureDay();
  }

  setInterval(tick, 1000);

  /* ================= Boot ================= */

  applyTheme();
  ensureDay(true);
  render();
  switchView('today');
  if (!state.onboarded) openOnboarding();
  else els.taskInput.focus();
  tick();
})();
