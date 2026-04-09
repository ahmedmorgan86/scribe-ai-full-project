import { registerMigration } from './runner';
import type { Database } from 'better-sqlite3';

registerMigration({
  id: '028',
  name: 'create_twitter_accounts_table',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS twitter_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        profile_image_url TEXT,
        api_key TEXT,
        api_secret TEXT,
        access_token TEXT,
        access_secret TEXT,
        is_primary INTEGER DEFAULT 1,
        connected_at TEXT,
        last_sync_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.exec(`CREATE INDEX idx_twitter_accounts_username ON twitter_accounts(username)`);
    db.exec(`CREATE INDEX idx_twitter_accounts_primary ON twitter_accounts(is_primary)`);
  },
  down: (db: Database) => {
    db.exec(`DROP INDEX IF EXISTS idx_twitter_accounts_primary`);
    db.exec(`DROP INDEX IF EXISTS idx_twitter_accounts_username`);
    db.exec(`DROP TABLE IF EXISTS twitter_accounts`);
  },
});
