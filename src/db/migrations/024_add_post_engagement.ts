import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Adds engagement tracking columns to posts table.
 * Tracks Twitter metrics for posted content.
 */
registerMigration({
  id: '024',
  name: 'add_post_engagement',
  up: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE posts ADD COLUMN twitter_id TEXT`);
    db.exec(`ALTER TABLE posts ADD COLUMN likes INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE posts ADD COLUMN retweets INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE posts ADD COLUMN impressions INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE posts ADD COLUMN engagement_updated_at TEXT`);
    db.exec(`CREATE INDEX idx_posts_twitter_id ON posts(twitter_id)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_posts_twitter_id`);
    // SQLite doesn't support DROP COLUMN directly before 3.35.0
    // Leave columns in place for safety
  },
});
