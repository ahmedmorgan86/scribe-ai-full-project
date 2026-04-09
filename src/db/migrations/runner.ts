import { Database as DatabaseType } from 'better-sqlite3';
import { getDb } from '../connection';

export interface Migration {
  id: string;
  name: string;
  up: (db: DatabaseType) => void;
  down: (db: DatabaseType) => void;
}

interface MigrationRecord {
  id: string;
  name: string;
  applied_at: string;
}

const migrationRegistry: Migration[] = [];

export function registerMigration(migration: Migration): void {
  migrationRegistry.push(migration);
  migrationRegistry.sort((a, b) => a.id.localeCompare(b.id));
}

function ensureMigrationsTable(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function getAppliedMigrations(db: DatabaseType): Set<string> {
  const rows = db.prepare('SELECT id FROM _migrations ORDER BY id').all() as MigrationRecord[];
  return new Set(rows.map((r) => r.id));
}

export function runMigrations(db?: DatabaseType): { applied: string[]; skipped: string[] } {
  const database = db ?? getDb();
  ensureMigrationsTable(database);

  const applied = getAppliedMigrations(database);
  const result = { applied: [] as string[], skipped: [] as string[] };

  for (const migration of migrationRegistry) {
    if (applied.has(migration.id)) {
      result.skipped.push(`${migration.id}_${migration.name}`);
      continue;
    }

    database.transaction(() => {
      migration.up(database);
      database
        .prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)')
        .run(migration.id, migration.name);
    })();

    result.applied.push(`${migration.id}_${migration.name}`);
  }

  return result;
}

export function rollbackMigration(db?: DatabaseType): string | null {
  const database = db ?? getDb();
  ensureMigrationsTable(database);

  const lastApplied = database
    .prepare('SELECT id, name FROM _migrations ORDER BY id DESC LIMIT 1')
    .get() as MigrationRecord | undefined;

  if (!lastApplied) {
    return null;
  }

  const migration = migrationRegistry.find((m) => m.id === lastApplied.id);

  if (!migration) {
    throw new Error(`Migration not registered for ${lastApplied.id}_${lastApplied.name}`);
  }

  database.transaction(() => {
    migration.down(database);
    database.prepare('DELETE FROM _migrations WHERE id = ?').run(migration.id);
  })();

  return `${migration.id}_${migration.name}`;
}

export function getMigrationStatus(db?: DatabaseType): {
  applied: MigrationRecord[];
  pending: string[];
} {
  const database = db ?? getDb();
  ensureMigrationsTable(database);

  const appliedRows = database
    .prepare('SELECT id, name, applied_at FROM _migrations ORDER BY id')
    .all() as MigrationRecord[];

  const appliedIds = new Set(appliedRows.map((r) => r.id));
  const pending = migrationRegistry
    .filter((m) => !appliedIds.has(m.id))
    .map((m) => `${m.id}_${m.name}`);

  return { applied: appliedRows, pending };
}
