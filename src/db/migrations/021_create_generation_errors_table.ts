import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Creates generation_errors table for persistent error logging.
 * Tracks generation failures with pattern context for debugging.
 */
registerMigration({
  id: '021',
  name: 'create_generation_errors_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE generation_errors (
        id TEXT PRIMARY KEY,
        error_type TEXT NOT NULL,
        error_details TEXT,
        patterns_used TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX idx_generation_errors_type ON generation_errors(error_type)`);
    db.exec(`CREATE INDEX idx_generation_errors_created_at ON generation_errors(created_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_generation_errors_created_at`);
    db.exec(`DROP INDEX IF EXISTS idx_generation_errors_type`);
    db.exec(`DROP TABLE IF EXISTS generation_errors`);
  },
});
