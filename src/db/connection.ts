import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: DatabaseType | null = null;

function getDbPath(): string {
  const envPath = process.env.SQLITE_DB_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  return path.resolve(process.cwd(), 'data', 'ai-social-engine.db');
}

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDb(): DatabaseType {
  if (db) {
    return db;
  }

  const dbPath = getDbPath();
  ensureDirectoryExists(dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDb(): void {
  closeDb();
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  }
}
