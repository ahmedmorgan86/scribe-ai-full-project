import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '006',
  name: 'create_accounts_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handle TEXT NOT NULL UNIQUE,
        tier INTEGER NOT NULL CHECK(tier IN (1, 2)),
        last_scraped TEXT,
        health_status TEXT NOT NULL DEFAULT 'healthy' CHECK(health_status IN ('healthy', 'degraded', 'failing'))
      )
    `);
    db.exec(`CREATE INDEX idx_accounts_tier ON accounts(tier)`);
    db.exec(`CREATE INDEX idx_accounts_health_status ON accounts(health_status)`);
    db.exec(`CREATE INDEX idx_accounts_last_scraped ON accounts(last_scraped)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS accounts`);
  },
});
