/**
 * The slice of `expo-sqlite` the swiplet runtime exposes.
 *
 * The host bridges the real module (`internal/automation/runtime/src/extension/
 * sqlite.ts` in Swipt) and the CLI keeps `expo-sqlite` external, but the package
 * is not installed here — this declaration is what makes `tsc` agree with the
 * runtime. Only the async API is declared: the sync API blocks the JS thread,
 * which is exactly what a chat UI must not do.
 */
declare module "expo-sqlite" {
  export type SQLiteBindValue = string | number | boolean | null | Uint8Array;

  export interface SQLiteRunResult {
    lastInsertRowId: number;
    changes: number;
  }

  export interface SQLiteDatabase {
    execAsync(source: string): Promise<void>;
    runAsync(
      source: string,
      params?: SQLiteBindValue | SQLiteBindValue[],
    ): Promise<SQLiteRunResult>;
    getFirstAsync<T>(
      source: string,
      params?: SQLiteBindValue | SQLiteBindValue[],
    ): Promise<T | null>;
    getAllAsync<T>(
      source: string,
      params?: SQLiteBindValue | SQLiteBindValue[],
    ): Promise<T[]>;
    withTransactionAsync(task: () => Promise<void>): Promise<void>;
    closeAsync(): Promise<void>;
  }

  export function openDatabaseAsync(
    name: string,
    options?: { enableChangeListener?: boolean; useNewConnection?: boolean },
  ): Promise<SQLiteDatabase>;
}