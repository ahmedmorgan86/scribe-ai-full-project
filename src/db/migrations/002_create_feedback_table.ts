import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '002',
  name: 'create_feedback_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'edit')),
        category TEXT CHECK (category IN ('generic', 'tone', 'hook', 'value', 'topic', 'timing', 'other')),
        comment TEXT,
        diff_before TEXT,
        diff_after TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX idx_feedback_post_id ON feedback(post_id)`);
    db.exec(`CREATE INDEX idx_feedback_action ON feedback(action)`);
    db.exec(`CREATE INDEX idx_feedback_created_at ON feedback(created_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS feedback`);
  },
});
