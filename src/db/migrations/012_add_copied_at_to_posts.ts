import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '012',
  name: 'add_copied_at_to_posts',
  up: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE posts ADD COLUMN copied_at TEXT`);
    db.exec(`CREATE INDEX idx_posts_copied_at ON posts(copied_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_posts_copied_at`);
    db.exec(`ALTER TABLE posts DROP COLUMN copied_at`);
  },
});
