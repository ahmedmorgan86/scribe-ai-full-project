import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Creates queue_slots table for configurable posting times.
 * Defines when posts can be scheduled throughout the week.
 */
registerMigration({
  id: '022',
  name: 'create_queue_slots_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE queue_slots (
        id TEXT PRIMARY KEY,
        day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
        time_utc TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX idx_queue_slots_day ON queue_slots(day_of_week)`);
    db.exec(`CREATE INDEX idx_queue_slots_enabled ON queue_slots(enabled)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_queue_slots_enabled`);
    db.exec(`DROP INDEX IF EXISTS idx_queue_slots_day`);
    db.exec(`DROP TABLE IF EXISTS queue_slots`);
  },
});
