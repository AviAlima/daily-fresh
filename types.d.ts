// Shared type shapes for the JSDoc-checked app code (checkJs mode).
// These are global interfaces consumed from sync.js / app.js via JSDoc tags.

/** Per-field change timestamps for a task. */
interface TsMap {
  [field: string]: number;
}

/** A task as stored locally and in Firestore day docs. */
interface TaskShape {
  id: string;
  text: string;
  done: boolean;
  priority: number;
  notes: string;
  estimate: number;
  order: number;
  carriedFrom: { day: string; id: string } | null;
  created: string;
  doneAt: number | null;
  ts: TsMap | null;
}

/** A per-day document: local state shape and Firestore doc shape. */
interface DayShape {
  tasks: TaskShape[];
  note: string;
  focus: string | null;
  reflection: string;
  tombstones: { id: string; deletedAt: number }[];
  fieldTs: TsMap;
  orderTs: number;
}

/** A sync log entry. */
interface SyncLogEntry {
  t: number;
  type: string;
  msg: string;
  d?: unknown;
}

// ---- Globals not covered by lib.dom (vendored scripts / non-DOM contexts) ----

declare var firebase: any;
declare var qrcode: any;
declare var module: any;
declare var global: any;

interface Window {
  Sync: any;
  webkitAudioContext?: typeof AudioContext;
}

interface Navigator {
  standalone?: boolean;
}
