import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '001',
  name: 'create_posts_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('single', 'thread', 'quote', 'reply')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'posted')),
        confidence_score REAL NOT NULL DEFAULT 0,
        reasoning TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        posted_at TEXT
      )
    `);
    db.exec(`CREATE INDEX idx_posts_status ON posts(status)`);
    db.exec(`CREATE INDEX idx_posts_created_at ON posts(created_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS posts`);
  },
});
