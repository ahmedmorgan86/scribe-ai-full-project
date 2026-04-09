import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Adds status column to patterns table for lifecycle management.
 * - active: Pattern is currently used for generation
 * - superseded: Replaced by newer conflicting pattern
 * - archived: Low decay score, not used
 */
registerMigration({
  id: '019',
  name: 'add_pattern_status',
  up: (db: DatabaseType): void => {
    db.exec(`
      ALTER TABLE patterns
      ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'superseded', 'archived'))
    `);
    db.exec(`CREATE INDEX idx_patterns_status ON patterns(status)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_patterns_status`);
    // SQLite doesn't support DROP COLUMN directly, need to recreate table
    // Preserve all columns from migrations 001-018
    db.exec(`
      CREATE TABLE patterns_backup AS SELECT
        id, pattern_type, description, evidence_count,
        edit_evidence_count, rejection_evidence_count,
        last_accessed_at, access_count, decay_score,
        created_at, updated_at
      FROM patterns
    `);
    db.exec(`DROP TABLE patterns`);
    db.exec(`
      CREATE TABLE patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_type TEXT NOT NULL CHECK (pattern_type IN ('voice', 'hook', 'topic', 'rejection', 'edit')),
        description TEXT NOT NULL,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        edit_evidence_count INTEGER NOT NULL DEFAULT 0,
        rejection_evidence_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        decay_score REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`INSERT INTO patterns SELECT * FROM patterns_backup`);
    db.exec(`DROP TABLE patterns_backup`);
    db.exec(`CREATE INDEX idx_patterns_pattern_type ON patterns(pattern_type)`);
    db.exec(`CREATE INDEX idx_patterns_evidence_count ON patterns(evidence_count)`);
    db.exec(`CREATE INDEX idx_patterns_edit_evidence ON patterns(edit_evidence_count)`);
    db.exec(`CREATE INDEX idx_patterns_decay_score ON patterns(decay_score)`);
    db.exec(`CREATE INDEX idx_patterns_last_accessed_at ON patterns(last_accessed_at)`);
  },
});
