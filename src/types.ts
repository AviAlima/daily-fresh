interface TsMap {
  [field: string]: number;
}

interface CarriedFrom {
  day: string;
  id: string;
}

interface TaskShape {
  id: string;
  text: string;
  done: boolean;
  estimate: number;
  order: number;
  carriedFrom: CarriedFrom | null;
  created: string;
  doneAt: number | null;
  ts: TsMap | null;
}

interface Tombstone {
  id: string;
  deletedAt: number;
}

interface DayShape {
  tasks: TaskShape[];
  note: string;
  focus: string | null;
  reflection: string;
  tombstones: Tombstone[];
  fieldTs: TsMap;
  orderTs: number;
}

interface SettingsShape {
  resetHour: number;
  theme: string;
  sound: boolean;
  name: string;
}

interface AppState {
  settings: SettingsShape;
  days: Record<string, DayShape>;
  onboarded: boolean;
  activeDay?: string;
  tomorrow?: { id: string; text: string }[];
  tomorrowTs?: number;
  nameTs?: number;
  resetHourTs?: number;
}

interface RemoteMeta {
  owner: string;
  name: string;
  nameTs: number;
  resetHour: number;
  resetHourTs: number;
  tomorrow: { id: string; text: string }[];
  tomorrowTs: number;
}

interface SyncLogEntry {
  t: number;
  type: string;
  msg: string;
  d?: unknown;
}
