import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '014',
  name: 'add_langgraph_job_id_to_posts',
  up: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE posts ADD COLUMN langgraph_job_id TEXT`);
    db.exec(`CREATE INDEX idx_posts_langgraph_job_id ON posts(langgraph_job_id)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_posts_langgraph_job_id`);
    db.exec(`ALTER TABLE posts DROP COLUMN langgraph_job_id`);
  },
});
