import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

/**
 * Adds decay-related fields to the patterns table for memory management.
 * - last_accessed_at: When the pattern was last used for generation
 * - access_count: How many times the pattern has been accessed
 * - decay_score: Calculated score for pattern relevance (access_count / (1 + daysSince/30))
 */
registerMigration({
  id: '018',
  name: 'add_pattern_decay',
  up: (db: DatabaseType): void => {
    db.exec(`ALTER TABLE patterns ADD COLUMN last_accessed_at TEXT`);
    db.exec(`ALTER TABLE patterns ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE patterns ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0`);
    db.exec(`CREATE INDEX idx_patterns_decay_score ON patterns(decay_score)`);
    db.exec(`CREATE INDEX idx_patterns_last_accessed_at ON patterns(last_accessed_at)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP INDEX IF EXISTS idx_patterns_last_accessed_at`);
    db.exec(`DROP INDEX IF EXISTS idx_patterns_decay_score`);
    // SQLite doesn't support DROP COLUMN directly, need to recreate table
    // Must include columns from migration 010: edit_evidence_count, rejection_evidence_count
    db.exec(`
      CREATE TABLE patterns_backup AS SELECT
        id, pattern_type, description, evidence_count,
        edit_evidence_count, rejection_evidence_count,
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`INSERT INTO patterns SELECT * FROM patterns_backup`);
    db.exec(`DROP TABLE patterns_backup`);
    db.exec(`CREATE INDEX idx_patterns_pattern_type ON patterns(pattern_type)`);
    db.exec(`CREATE INDEX idx_patterns_evidence_count ON patterns(evidence_count)`);
    db.exec(`CREATE INDEX idx_patterns_edit_evidence ON patterns(edit_evidence_count)`);
  },
});
