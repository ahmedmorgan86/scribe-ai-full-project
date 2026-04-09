import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '009',
  name: 'add_voice_evaluation_to_posts',
  up: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE posts ADD COLUMN voice_evaluation TEXT`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE posts DROP COLUMN voice_evaluation`);
  },
});
