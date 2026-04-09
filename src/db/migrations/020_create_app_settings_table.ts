import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Creates app_settings table to persist application settings.
 * Used for settings like auto-humanize toggle that can be changed at runtime.
 * Database values take precedence over environment variables, which take precedence over defaults.
 */
registerMigration({
  id: '020',
  name: 'create_app_settings_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX idx_app_settings_updated_at ON app_settings(updated_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_app_settings_updated_at`);
    db.exec(`DROP TABLE IF EXISTS app_settings`);
  },
});
