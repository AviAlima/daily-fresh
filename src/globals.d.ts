// Globals provided by the vendored classic scripts and non-standard browser APIs.

declare var firebase: any;

declare var global: any;

declare var module: { exports: any };

declare var FIREBASE_CONFIG: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

declare const Logic: LogicApi;

interface SyncApi {
  state: unknown;
  online: boolean;
  isConfigured(): boolean;
  getInitError(): string | null;
  isPaired(): boolean;
  getCode(): string;
  getLog(): SyncLogEntry[];
  isDirty(): boolean;
  getSyncError(): string | null;
  getStatus(): {
    state: 'off' | 'synced' | 'pending' | 'error' | 'stale' | 'desync';
    lastContact: number;
    dirty: boolean;
    error: string | null;
  };
  init(opts?: { onRemote?: () => void }): void;
  start(): Promise<unknown>;
  pair(code: string): Promise<unknown>;
  unpair(): void;
  onLocalChange(): void;
  onStatus(cb: () => void): void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

interface LogicApi {
  pad(n: number): string;
  currentMonth(now?: Date): { y: number; m: number };
  calKey(y: number, m: number, d: number): string;
  shiftKey(key: string, days: number): string;
  currentDayKey(now: Date, resetHour: number): string;
  dayLabel(key: string, now?: Date): string;
  fullDateLabel(key: string): string;
  newDay(): DayShape;
  uid(): string;
  parseEstimate(text: string): number;
  fmtEstimate(min: number): string;
  fmtTime(s: number): string;
  timerStroke(remaining: number, total: number): number;
  orderedTasks(arr: TaskShape[]): TaskShape[];
  allDone(tasks: TaskShape[]): boolean;
  isFirstDay(days: Record<string, DayShape>): boolean;
  dayStats(days: Record<string, DayShape>, key: string): { total: number; done: number; ratio: number; exists: boolean };
  lastKeys(activeDay: string, n: number): string[];
  streak(days: Record<string, DayShape>, activeDay: string): number;
  greeting(now: Date, name: string): string;
  rootOf(t: TaskShape, days: Record<string, DayShape>, dayKey: string): string;
  dedupeDay(tasks: TaskShape[], days: Record<string, DayShape>, fallbackKey?: string): { tasks: TaskShape[]; dropped: boolean };
  carryCandidates(days: Record<string, DayShape>, activeDay: string): { day: string; task: TaskShape }[];
  migrate(p: unknown): AppState;
}

interface Window {
  Sync: SyncApi;
  Logic: LogicApi;
  webkitAudioContext?: typeof AudioContext;
}

declare function qrcode(
  typeNumber: number,
  errorCorrectionLevel: string
): {
  addData(data: string): void;
  make(): void;
  createImgTag(cellSize?: number, margin?: number): HTMLImageElement;
};

interface Navigator {
  standalone?: boolean;
}
