import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Adds shadow mode columns to posts table.
 * Tracks AI decisions for comparison against human decisions.
 */
registerMigration({
  id: '023',
  name: 'add_shadow_mode_to_posts',
  up: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE posts ADD COLUMN ai_decision TEXT`);
    db.exec(`ALTER TABLE posts ADD COLUMN ai_confidence REAL`);
    db.exec(`CREATE INDEX idx_posts_ai_decision ON posts(ai_decision)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_posts_ai_decision`);
    // SQLite doesn't support DROP COLUMN directly before 3.35.0
    // For safety, we recreate the table without the columns
    db.exec(`
      CREATE TABLE posts_backup AS SELECT
        id, content, type, status, confidence_score, reasoning,
        created_at, posted_at, voice_evaluation, stylometric_signature,
        copied_at, langgraph_job_id
      FROM posts
    `);
    db.exec(`DROP TABLE posts`);
    db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('single', 'thread', 'quote', 'reply')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'posted')),
        confidence_score REAL NOT NULL DEFAULT 0,
        reasoning TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        posted_at TEXT,
        voice_evaluation TEXT,
        stylometric_signature TEXT,
        copied_at TEXT,
        langgraph_job_id TEXT
      )
    `);
    db.exec(`INSERT INTO posts SELECT * FROM posts_backup`);
    db.exec(`DROP TABLE posts_backup`);
    db.exec(`CREATE INDEX idx_posts_status ON posts(status)`);
    db.exec(`CREATE INDEX idx_posts_created_at ON posts(created_at)`);
  },
});
