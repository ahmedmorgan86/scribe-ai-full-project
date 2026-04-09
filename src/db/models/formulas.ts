import { getDb } from '../connection';
import { Formula } from '@/types';

interface FormulaRow {
  id: number;
  name: string;
  template: string;
  usage_count: number;
  success_rate: number;
  active: number;
}

function rowToFormula(row: FormulaRow): Formula {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    usageCount: row.usage_count,
    successRate: row.success_rate,
    active: row.active === 1,
  };
}

export interface CreateFormulaInput {
  name: string;
  template: string;
  active?: boolean;
}

export interface UpdateFormulaInput {
  name?: string;
  template?: string;
  usageCount?: number;
  successRate?: number;
  active?: boolean;
}

export interface ListFormulasOptions {
  active?: boolean;
  minSuccessRate?: number;
  limit?: number;
  offset?: number;
  orderBy?: 'name' | 'usage_count' | 'success_rate';
  orderDir?: 'asc' | 'desc';
}

export function createFormula(input: CreateFormulaInput): Formula {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO formulas (name, template, active)
    VALUES (?, ?, ?)
  `);

  const activeValue = input.active !== false ? 1 : 0;
  const result = stmt.run(input.name, input.template, activeValue);

  const formula = getFormulaById(result.lastInsertRowid as number);
  if (!formula) {
    throw new Error('Failed to create formula');
  }
  return formula;
}

export function getFormulaById(id: number): Formula | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM formulas WHERE id = ?`);
  const row = stmt.get(id) as FormulaRow | undefined;
  return row ? rowToFormula(row) : null;
}

export function getFormulaByName(name: string): Formula | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM formulas WHERE name = ?`);
  const row = stmt.get(name) as FormulaRow | undefined;
  return row ? rowToFormula(row) : null;
}

export function updateFormula(id: number, input: UpdateFormulaInput): Formula | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | number)[] = [];

  if (input.name !== undefined) {
    setClauses.push('name = ?');
    values.push(input.name);
  }
  if (input.template !== undefined) {
    setClauses.push('template = ?');
    values.push(input.template);
  }
  if (input.usageCount !== undefined) {
    setClauses.push('usage_count = ?');
    values.push(input.usageCount);
  }
  if (input.successRate !== undefined) {
    setClauses.push('success_rate = ?');
    values.push(input.successRate);
  }
  if (input.active !== undefined) {
    setClauses.push('active = ?');
    values.push(input.active ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return getFormulaById(id);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE formulas SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getFormulaById(id) : null;
}

export function deleteFormula(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM formulas WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listFormulas(options: ListFormulasOptions = {}): Formula[] {
  const db = getDb();
  const {
    active,
    minSuccessRate,
    limit = 50,
    offset = 0,
    orderBy = 'name',
    orderDir = 'asc',
  } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (active !== undefined) {
    whereClauses.push('active = ?');
    params.push(active ? 1 : 0);
  }
  if (minSuccessRate !== undefined) {
    whereClauses.push('success_rate >= ?');
    params.push(minSuccessRate);
  }

  let query = `SELECT * FROM formulas`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as FormulaRow[];
  return rows.map(rowToFormula);
}

export function countFormulas(active?: boolean): number {
  const db = getDb();
  let query = `SELECT COUNT(*) as count FROM formulas`;
  const params: number[] = [];

  if (active !== undefined) {
    query += ` WHERE active = ?`;
    params.push(active ? 1 : 0);
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getActiveFormulas(): Formula[] {
  return listFormulas({ active: true });
}

export function incrementUsageCount(id: number): Formula | null {
  const db = getDb();
  const stmt = db.prepare(`UPDATE formulas SET usage_count = usage_count + 1 WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0 ? getFormulaById(id) : null;
}

export function updateSuccessRate(id: number, successRate: number): Formula | null {
  return updateFormula(id, { successRate });
}
