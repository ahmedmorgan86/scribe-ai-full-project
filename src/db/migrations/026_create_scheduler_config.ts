import type { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from '../migrations';

registerMigration({
  id: '026',
  name: 'create_scheduler_config',
  up: (db: DatabaseType): void => {
    // Scheduler configuration table
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        max_queue_size INTEGER NOT NULL DEFAULT 10,
        source_mode TEXT NOT NULL DEFAULT 'round_robin' CHECK (source_mode IN ('round_robin', 'random', 'weighted', 'manual')),
        manual_source_ids TEXT DEFAULT NULL,
        time_slots TEXT DEFAULT NULL,
        last_run_at TEXT DEFAULT NULL,
        next_run_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Insert default config row
    db.exec(`
      INSERT INTO scheduler_config (id, enabled, interval_minutes, max_queue_size, source_mode)
      VALUES (1, 0, 60, 10, 'round_robin')
    `);

    // Scheduler run history for analytics
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
        source_id INTEGER DEFAULT NULL,
        posts_generated INTEGER DEFAULT 0,
        posts_queued INTEGER DEFAULT 0,
        error TEXT DEFAULT NULL,
        duration_ms INTEGER DEFAULT NULL,
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
      )
    `);

    // Index for finding recent runs
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_scheduler_runs_started_at
      ON scheduler_runs(started_at DESC)
    `);

    // Source rotation tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_source_rotation (
        source_id INTEGER PRIMARY KEY,
        last_used_at TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      )
    `);
  },
  down: (db: DatabaseType): void => {
    db.exec('DROP TABLE IF EXISTS scheduler_source_rotation');
    db.exec('DROP INDEX IF EXISTS idx_scheduler_runs_started_at');
    db.exec('DROP TABLE IF EXISTS scheduler_runs');
    db.exec('DROP TABLE IF EXISTS scheduler_config');
  },
});
