interface SyncModule {
  mergeTask(lt: TaskShape, rt: TaskShape): { task: TaskShape; changed: boolean };
  mergeDay(local: DayShape, remote: DayShape): { day: DayShape; changed: boolean };
  mergeMeta(state: AppState, rm: RemoteMeta): { tomorrow: { id: string; text: string }[]; changed: boolean };
  mergeTombstones(a: Tombstone[] | undefined, b: Tombstone[] | undefined): Tombstone[];
  isTombstoned(list: Tombstone[], id: string, ts: TsMap | null): boolean;
  pushDay(day: DayShape, remote: DayShape | null, now: number): DayShape;
  readLocalMeta(state: AppState, now: number, rm?: RemoteMeta | null): RemoteMeta;
  cyrb53(str: string, seed: number): string;
  hashCode(code: string): string;
  genCode(): string;
}
