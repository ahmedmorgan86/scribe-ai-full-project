import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '003',
  name: 'create_patterns_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_type TEXT NOT NULL CHECK (pattern_type IN ('voice', 'hook', 'topic', 'rejection', 'edit')),
        description TEXT NOT NULL,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX idx_patterns_pattern_type ON patterns(pattern_type)`);
    db.exec(`CREATE INDEX idx_patterns_evidence_count ON patterns(evidence_count)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS patterns`);
  },
});
