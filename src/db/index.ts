import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from '../config.ts';

export type DB = DatabaseSync;

export function openDb(file: string = DB_PATH): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

// Bancos criados antes de uma coluna existir: o CREATE TABLE IF NOT EXISTS não a adiciona.
const ADDED_COLUMNS: [string, string, string][] = [
  ['companies', 'discard_reason', 'TEXT'],
  ['companies', 'decided_at', 'TEXT'],
  ['companies', 'snoozed_until', 'TEXT'],
  ['scores', 'prev_total', 'INTEGER'],
  ['companies', 'outreach', 'TEXT'],
  ['companies', 'outreach_at', 'TEXT'],
  ['contacts', 'since', 'TEXT'],
  ['companies', 'receita_at', 'TEXT'],
  ['contacts', 'channel', 'TEXT'],
  ['companies', 'ats_at', 'TEXT'],
];

function migrate(db: DB) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
