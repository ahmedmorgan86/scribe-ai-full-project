import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Creates threshold_overrides table to persist custom validation threshold values.
 * Thresholds can be overridden via the dashboard and are stored here.
 * Environment variables take precedence over database values, which take precedence over defaults.
 */
registerMigration({
  id: '017',
  name: 'create_threshold_overrides_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE threshold_overrides (
        key TEXT PRIMARY KEY,
        value REAL NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX idx_threshold_overrides_updated_at ON threshold_overrides(updated_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_threshold_overrides_updated_at`);
    db.exec(`DROP TABLE IF EXISTS threshold_overrides`);
  },
});
