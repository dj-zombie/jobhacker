import type { Database } from 'better-sqlite3';
import { tableNames } from './schema.js';

export interface TableCount {
  table: string;
  rows: number;
}

/**
 * Row counts for every application table, in a stable order. Used by the CLI
 * `db:info` command and by the UI home page to prove it can read the DB.
 */
export function tableRowCounts(sqlite: Database): TableCount[] {
  return tableNames.map((table) => {
    const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
    return { table, rows: row.n };
  });
}
