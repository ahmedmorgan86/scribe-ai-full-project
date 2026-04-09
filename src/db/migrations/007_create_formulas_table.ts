import { Database as DatabaseType } from 'better-sqlite3';
import { registerMigration } from './runner';

registerMigration({
  id: '007',
  name: 'create_formulas_table',
  up: (db: DatabaseType): void => {
    db.exec(`
      CREATE TABLE formulas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        template TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1))
      )
    `);
    db.exec(`CREATE INDEX idx_formulas_active ON formulas(active)`);
    db.exec(`CREATE INDEX idx_formulas_success_rate ON formulas(success_rate DESC)`);
  },
  down: (db: DatabaseType): void => {
    db.exec(`DROP TABLE IF EXISTS formulas`);
  },
});
