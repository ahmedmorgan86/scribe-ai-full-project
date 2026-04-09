import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '011',
  name: 'create_rules_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT NOT NULL CHECK (rule_type IN ('voice', 'hook', 'topic', 'style', 'format', 'general')),
        description TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('clarification', 'manual', 'bootstrap')),
        source_contradiction_id INTEGER,
        priority INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        context TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX idx_rules_rule_type ON rules(rule_type)`);
    db.exec(`CREATE INDEX idx_rules_is_active ON rules(is_active)`);
    db.exec(`CREATE INDEX idx_rules_priority ON rules(priority DESC)`);
    db.exec(`CREATE INDEX idx_rules_source ON rules(source)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS rules`);
  },
});
