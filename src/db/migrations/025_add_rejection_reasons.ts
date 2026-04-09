import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Adds rejection reason tracking to posts.
 * Enables pattern learning from rejected content.
 */
registerMigration({
  id: '025',
  name: 'add_rejection_reasons',
  up: (db: DatabaseType): void => {
    // Add rejection columns to posts
    db.exec(`ALTER TABLE posts ADD COLUMN rejection_reason TEXT`);
    db.exec(`ALTER TABLE posts ADD COLUMN rejection_comment TEXT`);
    db.exec(`ALTER TABLE posts ADD COLUMN rejected_at TEXT`);

    // Create rejection stats table for aggregated analytics
    db.exec(`
      CREATE TABLE IF NOT EXISTS rejection_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reason TEXT NOT NULL UNIQUE,
        count INTEGER DEFAULT 0,
        last_occurrence TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Create index for querying rejections
    db.exec(`CREATE INDEX idx_posts_rejection_reason ON posts(rejection_reason)`);
    db.exec(`CREATE INDEX idx_posts_rejected_at ON posts(rejected_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_posts_rejection_reason`);
    db.exec(`DROP INDEX IF EXISTS idx_posts_rejected_at`);
    db.exec(`DROP TABLE IF EXISTS rejection_stats`);
    // SQLite doesn't support DROP COLUMN directly before 3.35.0
  },
});
