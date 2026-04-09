import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '015',
  name: 'add_stylometric_signature_to_posts',
  up: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE posts ADD COLUMN stylometric_signature TEXT`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE posts DROP COLUMN stylometric_signature`);
  },
});
