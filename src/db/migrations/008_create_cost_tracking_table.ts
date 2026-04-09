import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '008',
  name: 'create_cost_tracking_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE cost_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_name TEXT NOT NULL CHECK(api_name IN ('anthropic', 'apify', 'smaug')),
        tokens_used INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX idx_cost_tracking_api_name ON cost_tracking(api_name)`);
    db.exec(`CREATE INDEX idx_cost_tracking_created_at ON cost_tracking(created_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS cost_tracking`);
  },
});
