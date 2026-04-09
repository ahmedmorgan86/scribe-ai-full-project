import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '005',
  name: 'create_sources_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL CHECK(source_type IN ('like', 'bookmark', 'account_tweet')),
        source_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE UNIQUE INDEX idx_sources_source_id ON sources(source_type, source_id)`);
    db.exec(`CREATE INDEX idx_sources_type ON sources(source_type)`);
    db.exec(`CREATE INDEX idx_sources_scraped_at ON sources(scraped_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS sources`);
  },
});
