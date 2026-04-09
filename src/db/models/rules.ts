import { getDb } from '../connection';
import type { Rule, RuleType, RuleSource } from '@/types';

interface RuleRow {
  id: number;
  rule_type: string;
  description: string;
  source: string;
  source_contradiction_id: number | null;
  priority: number;
  is_active: number;
  context: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    ruleType: row.rule_type as RuleType,
    description: row.description,
    source: row.source as RuleSource,
    sourceContradictionId: row.source_contradiction_id,
    priority: row.priority,
    isActive: row.is_active === 1,
    context: row.context,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateRuleInput {
  ruleType: RuleType;
  description: string;
  source: RuleSource;
  sourceContradictionId?: number | null;
  priority?: number;
  isActive?: boolean;
  context?: string | null;
}

export interface UpdateRuleInput {
  ruleType?: RuleType;
  description?: string;
  priority?: number;
  isActive?: boolean;
  context?: string | null;
}

export interface ListRulesOptions {
  ruleType?: RuleType;
  source?: RuleSource;
  isActive?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'updated_at' | 'priority';
  orderDir?: 'asc' | 'desc';
}

export function createRule(input: CreateRuleInput): Rule {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO rules (rule_type, description, source, source_contradiction_id, priority, is_active, context)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.ruleType,
    input.description,
    input.source,
    input.sourceContradictionId ?? null,
    input.priority ?? 1,
    input.isActive !== false ? 1 : 0,
    input.context ?? null
  );

  const rule = getRuleById(result.lastInsertRowid as number);
  if (!rule) {
    throw new Error('Failed to create rule');
  }
  return rule;
}

export function getRuleById(id: number): Rule | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM rules WHERE id = ?`);
  const row = stmt.get(id) as RuleRow | undefined;
  return row ? rowToRule(row) : null;
}

export function updateRule(id: number, input: UpdateRuleInput): Rule | null {
  const db = getDb();
  const setClauses: string[] = ["updated_at = datetime('now')"];
  const values: (string | number | null)[] = [];

  if (input.ruleType !== undefined) {
    setClauses.push('rule_type = ?');
    values.push(input.ruleType);
  }
  if (input.description !== undefined) {
    setClauses.push('description = ?');
    values.push(input.description);
  }
  if (input.priority !== undefined) {
    setClauses.push('priority = ?');
    values.push(input.priority);
  }
  if (input.isActive !== undefined) {
    setClauses.push('is_active = ?');
    values.push(input.isActive ? 1 : 0);
  }
  if (input.context !== undefined) {
    setClauses.push('context = ?');
    values.push(input.context);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE rules SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getRuleById(id) : null;
}

export function deleteRule(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM rules WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listRules(options: ListRulesOptions = {}): Rule[] {
  const db = getDb();
  const {
    ruleType,
    source,
    isActive,
    limit = 50,
    offset = 0,
    orderBy = 'priority',
    orderDir = 'desc',
  } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (ruleType !== undefined) {
    whereClauses.push('rule_type = ?');
    params.push(ruleType);
  }
  if (source !== undefined) {
    whereClauses.push('source = ?');
    params.push(source);
  }
  if (isActive !== undefined) {
    whereClauses.push('is_active = ?');
    params.push(isActive ? 1 : 0);
  }

  let query = `SELECT * FROM rules`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as RuleRow[];
  return rows.map(rowToRule);
}

export function countRules(options: { ruleType?: RuleType; isActive?: boolean } = {}): number {
  const db = getDb();
  const { ruleType, isActive } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (ruleType !== undefined) {
    whereClauses.push('rule_type = ?');
    params.push(ruleType);
  }
  if (isActive !== undefined) {
    whereClauses.push('is_active = ?');
    params.push(isActive ? 1 : 0);
  }

  let query = `SELECT COUNT(*) as count FROM rules`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getActiveRules(): Rule[] {
  return listRules({ isActive: true, orderBy: 'priority', orderDir: 'desc' });
}

export function getRulesByType(ruleType: RuleType): Rule[] {
  return listRules({ ruleType, isActive: true });
}

export function getActiveRulesForGeneration(): Rule[] {
  return listRules({ isActive: true, orderBy: 'priority', orderDir: 'desc', limit: 100 });
}

export function deactivateRule(id: number): Rule | null {
  return updateRule(id, { isActive: false });
}

export function activateRule(id: number): Rule | null {
  return updateRule(id, { isActive: true });
}

export function findRuleByDescription(description: string): Rule | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM rules WHERE description = ? AND is_active = 1`);
  const row = stmt.get(description) as RuleRow | undefined;
  return row ? rowToRule(row) : null;
}

export function ruleExists(description: string): boolean {
  return findRuleByDescription(description) !== null;
}
