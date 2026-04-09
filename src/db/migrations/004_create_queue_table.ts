import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '004',
  name: 'create_queue_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL UNIQUE,
        priority INTEGER NOT NULL DEFAULT 0,
        scheduled_for TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX idx_queue_priority ON queue(priority DESC)`);
    db.exec(`CREATE INDEX idx_queue_scheduled_for ON queue(scheduled_for)`);
    db.exec(`CREATE INDEX idx_queue_post_id ON queue(post_id)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS queue`);
  },
});
