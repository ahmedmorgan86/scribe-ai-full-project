import { registerMigration } from './runner';
import type { Database } from 'better-sqlite3';

registerMigration({
  id: '027',
  name: 'add_sources_used_tracking',
  up: (db: Database) => {
    // Add used and used_at columns for tracking source usage
    db.exec(`ALTER TABLE sources ADD COLUMN used INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE sources ADD COLUMN used_at TEXT`);
    db.exec(`ALTER TABLE sources ADD COLUMN quality_score REAL`);

    // Create index for finding unused sources quickly
    db.exec(`CREATE INDEX idx_sources_unused ON sources(used, scraped_at DESC)`);
  },
  down: (db: Database) => {
    db.exec(`DROP INDEX IF EXISTS idx_sources_unused`);
    // SQLite doesn't support DROP COLUMN, would need to recreate table
  },
});
