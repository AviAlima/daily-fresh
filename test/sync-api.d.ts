interface ArchiveMap {
  [quarter: string]: Record<string, DayShape>;
}

interface SyncModule {
  mergeTask(lt: TaskShape, rt: TaskShape): { task: TaskShape; changed: boolean };
  mergeDay(local: DayShape, remote: DayShape): { day: DayShape; changed: boolean };
  dedupeDay(tasks: TaskShape[], days: Record<string, DayShape>): { tasks: TaskShape[]; dropped: boolean };
  mergeMeta(state: AppState, rm: RemoteMeta): { tomorrow: { id: string; text: string }[]; changed: boolean };
  mergeTombstones(a: Tombstone[] | undefined, b: Tombstone[] | undefined): Tombstone[];
  isTombstoned(list: Tombstone[], id: string, ts: TsMap | null): boolean;
  pushDay(day: DayShape, remote: DayShape | null, now: number): DayShape;
  readLocalMeta(state: AppState, now: number, rm?: RemoteMeta | null): RemoteMeta;
  cyrb53(str: string, seed: number): string;
  hashCode(code: string): string;
  genCode(): string;
  dayKey(d: Date): string;
  quarterKey(day: string): string;
  isRecentDay(day: string, now: number): boolean;
  buildOpen(state: AppState, now: number): Record<string, DayShape>;
  buildPushBundle(state: AppState, remote: Record<string, DayShape>, now: number): Record<string, DayShape>;
  fingerprint(days: Record<string, DayShape>): string;
  statusState(input: {
    st: { code: string; hash: string; paired: boolean } | null;
    ready: boolean;
    error: string | null;
    online: boolean;
    lastContact: number;
    dirty: boolean;
    pending: boolean;
    pushAt: number;
    desync: boolean;
    now: number;
  }): 'off' | 'synced' | 'pending' | 'error' | 'stale' | 'desync';
  planSweep(state: AppState, remoteArchivesIn: ArchiveMap, now: number): ArchiveMap;
  planMigration(legacyDays: Record<string, DayShape>, now: number): { openDays: Record<string, DayShape>; archives: ArchiveMap };
}
