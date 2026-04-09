import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '013',
  name: 'add_model_id_to_cost_tracking',
  up: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE cost_tracking ADD COLUMN model_id TEXT`);
    db.exec(`CREATE INDEX idx_cost_tracking_model_id ON cost_tracking(model_id)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_cost_tracking_model_id`);
    db.exec(`ALTER TABLE cost_tracking DROP COLUMN model_id`);
  },
});
