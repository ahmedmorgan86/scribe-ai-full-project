import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '010',
  name: 'add_pattern_weighting',
  up: (db: DatabaseType): void => {
    db.exec(`
      ALTER TABLE patterns ADD COLUMN edit_evidence_count INTEGER NOT NULL DEFAULT 0
    `);
    db.exec(`
      ALTER TABLE patterns ADD COLUMN rejection_evidence_count INTEGER NOT NULL DEFAULT 0
    `);
    db.exec(`CREATE INDEX idx_patterns_edit_evidence ON patterns(edit_evidence_count)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_patterns_edit_evidence`);
    db.exec(`ALTER TABLE patterns DROP COLUMN edit_evidence_count`);
    db.exec(`ALTER TABLE patterns DROP COLUMN rejection_evidence_count`);
  },
});
