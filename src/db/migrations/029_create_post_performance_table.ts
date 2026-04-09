import { registerMigration } from './runner';
import type { Database } from 'better-sqlite3';

registerMigration({
  id: '029',
  name: 'create_post_performance_table',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS post_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        tweet_id TEXT,
        tweet_url TEXT,

        likes INTEGER DEFAULT 0,
        retweets INTEGER DEFAULT 0,
        replies INTEGER DEFAULT 0,
        quotes INTEGER DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        profile_visits INTEGER DEFAULT 0,
        follows_from_post INTEGER DEFAULT 0,

        engagement_rate REAL,
        performance_score REAL,

        first_tracked_at TEXT,
        last_tracked_at TEXT,
        tracking_count INTEGER DEFAULT 0,

        created_at TEXT DEFAULT (datetime('now')),

        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);

    db.exec(`CREATE INDEX idx_post_performance_post_id ON post_performance(post_id)`);
    db.exec(`CREATE INDEX idx_post_performance_tweet_id ON post_performance(tweet_id)`);
    db.exec(`CREATE INDEX idx_post_performance_score ON post_performance(performance_score DESC)`);
  },
  down: (db: Database) => {
    db.exec(`DROP INDEX IF EXISTS idx_post_performance_score`);
    db.exec(`DROP INDEX IF EXISTS idx_post_performance_tweet_id`);
    db.exec(`DROP INDEX IF EXISTS idx_post_performance_post_id`);
    db.exec(`DROP TABLE IF EXISTS post_performance`);
  },
});
