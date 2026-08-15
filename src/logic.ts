(function () {
  function pad(n: number) { return n < 10 ? '0' + n : '' + n; }

  function currentMonth(now?: Date) {
    const d = now || new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  }

  function calKey(y: number, m: number, d: number) {
    return y + '-' + pad(m + 1) + '-' + pad(d);
  }

  function shiftKey(key: string, days: number) {
    const parts = key.split('-');
    const d = new Date(+parts[0], +parts[1] - 1, +parts[2] + days);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function currentDayKey(now: Date, resetHour: number) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (now.getHours() < resetHour) {
      d.setDate(d.getDate() - 1);
    }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function dayLabel(key: string, now?: Date) {
    const parts = key.split('-');
    const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    const ref = now || new Date();
    const todayStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    const diff = Math.round((+todayStart - +d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return diff + ' days ago';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function fullDateLabel(key: string) {
    const parts = key.split('-');
    const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function newDay(): DayShape {
    return { tasks: [], note: '', focus: null, reflection: '', tombstones: [], fieldTs: {}, orderTs: 0 };
  }

  function uid() {
    return Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  function parseEstimate(text: string) {
    let m = text.match(/(\d+(?:\.\d+)?)\s*h\s*(?:(\d+)\s*m)?\s*$/i);
    if (m) return Math.round(parseFloat(m[1]) * 60 + parseInt(m[2] || '0', 10));
    m = text.match(/(\d+)\s*m\s*$/i);
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  function fmtEstimate(min: number) {
    if (min < 60) return '~' + min + 'm';
    const h = Math.floor(min / 60);
    const rest = min % 60;
    return '~' + h + 'h' + (rest ? ' ' + rest + 'm' : '');
  }

  function fmtTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return pad(m) + ':' + pad(sec);
  }

  const TIMER_C = 389.56;

  function timerStroke(remaining: number, total: number) {
    return TIMER_C * (1 - (remaining / total));
  }

  function orderedTasks(arr: TaskShape[]) {
    const idx: Record<string, number> = {};
    arr.forEach(function (t, i) { idx[t.id] = i; });
    return arr.slice().sort(function (a, b) {
      const oa = typeof a.order === 'number' ? a.order : idx[a.id];
      const ob = typeof b.order === 'number' ? b.order : idx[b.id];
      return oa - ob;
    });
  }

  function allDone(tasks: TaskShape[]) {
    return tasks.length > 0 && tasks.every(function (t) { return t.done; });
  }

  function isFirstDay(days: Record<string, DayShape>) {
    return Object.keys(days).length <= 1;
  }

  function dayStats(days: Record<string, DayShape>, key: string) {
    const d = days[key];
    if (!d || !d.tasks || !d.tasks.length) return { total: 0, done: 0, ratio: 0, exists: false };
    const done = d.tasks.filter(function (t) { return t.done; }).length;
    return { total: d.tasks.length, done: done, ratio: done / d.tasks.length, exists: true };
  }

  function lastKeys(activeDay: string, n: number) {
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(shiftKey(activeDay, -i));
    return keys.reverse();
  }

  function streak(days: Record<string, DayShape>, activeDay: string) {
    let s = 0;
    let key = activeDay;
    let st = dayStats(days, key);
    if (!st.exists) key = shiftKey(key, -1);
    while (true) {
      const ds = dayStats(days, key);
      if (ds.exists && ds.total === ds.done) {
        s++;
        key = shiftKey(key, -1);
      } else {
        break;
      }
    }
    return s;
  }

  function greeting(now: Date, name: string) {
    const h = now.getHours();
    const suffix = name ? ', ' + name : '';
    if (h < 5) return 'Working late' + suffix + '?';
    if (h < 12) return 'Good morning' + suffix;
    if (h < 18) return 'Good afternoon' + suffix;
    return 'Good evening' + suffix;
  }

  function rootOf(t: TaskShape, days: Record<string, DayShape>, dayKey: string): string {
    let d = t.carriedFrom && t.carriedFrom.day;
    let id = t.carriedFrom && t.carriedFrom.id;
    for (let hops = 0; hops < 12 && d && id; hops++) {
      const pd = days[d];
      const parent = pd && (pd.tasks || []).find(function (x) { return x && x.id === id; });
      if (!parent || !parent.carriedFrom) {
        return d + ':' + id;
      }
      d = parent.carriedFrom.day;
      id = parent.carriedFrom.id;
    }
    return (d && id) ? d + ':' + id : dayKey + ':' + t.id;
  }

  function dedupeDay(tasks: TaskShape[], days: Record<string, DayShape>, fallbackKey?: string): { tasks: TaskShape[]; dropped: boolean } {
    const seenRoot: Record<string, boolean> = {};
    const seenText: Record<string, boolean> = {};
    let dropped = false;
    const out: TaskShape[] = [];
    tasks.forEach(function (t) {
      if (!t || !t.id) { out.push(t); return; }
      const root = rootOf(t, days, fallbackKey || '');
      if (root) {
        if (seenRoot[root]) { dropped = true; return; }
        seenRoot[root] = true;
      }
      if (!t.done && t.text) {
        const normText = t.text.trim().toLowerCase();
        if (normText) {
          if (seenText[normText]) { dropped = true; return; }
          seenText[normText] = true;
        }
      }
      out.push(t);
    });
    return { tasks: out, dropped };
  }

  function carryCandidates(days: Record<string, DayShape>, activeDay: string): { day: string; task: TaskShape }[] {
    const todayTasks = days[activeDay] ? days[activeDay].tasks : [];
    const carried: Record<string, boolean> = {};
    todayTasks.forEach(function (t) {
      const r = rootOf(t, days, activeDay);
      if (r) carried[r] = true;
    });
    const keys = Object.keys(days)
      .filter(function (k) { return k < activeDay; })
      .sort()
      .reverse();
    const res: { day: string; task: TaskShape }[] = [];
    keys.forEach(function (k) {
      (days[k].tasks || []).forEach(function (t) {
        if (!t.done) {
          const r = rootOf(t, days, k);
          if (!r || !carried[r]) res.push({ day: k, task: t });
        }
      });
    });
    return res;
  }

  function migrate(p: any): AppState {
    const s: AppState = {
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
      const raw = p.days[k];
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
      const dd = dedupeDay(s.days[k].tasks, s.days, k);
      if (dd.dropped) s.days[k].tasks = dd.tasks;
    });
    if (typeof p.tomorrowTs === 'number') s.tomorrowTs = p.tomorrowTs;
    if (typeof p.nameTs === 'number') s.nameTs = p.nameTs;
    if (typeof p.resetHourTs === 'number') s.resetHourTs = p.resetHourTs;
    return s;
  }

  const root: any = typeof window !== 'undefined' ? window : global;

  root.Logic = {
    pad,
    currentMonth,
    calKey,
    shiftKey,
    currentDayKey,
    dayLabel,
    fullDateLabel,
    newDay,
    uid,
    parseEstimate,
    fmtEstimate,
    fmtTime,
    timerStroke,
    orderedTasks,
    allDone,
    isFirstDay,
    dayStats,
    lastKeys,
    streak,
    greeting,
    rootOf,
    dedupeDay,
    carryCandidates,
    migrate
  };

  if (typeof module !== 'undefined' && (module as any).exports) {
    (module as any).exports = root.Logic;
  }
})();