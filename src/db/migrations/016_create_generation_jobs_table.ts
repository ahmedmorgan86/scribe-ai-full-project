import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '016',
  name: 'create_generation_jobs_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE generation_jobs (
        id TEXT PRIMARY KEY,
        pipeline TEXT NOT NULL CHECK(pipeline IN ('langgraph', 'typescript')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')),
        source_ids TEXT,
        post_id INTEGER,
        content_type TEXT,
        error TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        metadata TEXT,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
      )
    `);
    db.exec(`CREATE INDEX idx_generation_jobs_status ON generation_jobs(status)`);
    db.exec(`CREATE INDEX idx_generation_jobs_pipeline ON generation_jobs(pipeline)`);
    db.exec(`CREATE INDEX idx_generation_jobs_started_at ON generation_jobs(started_at)`);
    db.exec(`CREATE INDEX idx_generation_jobs_post_id ON generation_jobs(post_id)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_generation_jobs_post_id`);
    db.exec(`DROP INDEX IF EXISTS idx_generation_jobs_started_at`);
    db.exec(`DROP INDEX IF EXISTS idx_generation_jobs_pipeline`);
    db.exec(`DROP INDEX IF EXISTS idx_generation_jobs_status`);
    db.exec(`DROP TABLE IF EXISTS generation_jobs`);
  },
});
