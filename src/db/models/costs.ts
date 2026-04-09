import { getDb } from '../connection';
import { CostEntry, ApiName } from '@/types';

interface CostRow {
  id: number;
  api_name: string;
  model_id: string | null;
  tokens_used: number;
  cost_usd: number;
  created_at: string;
}

function rowToCostEntry(row: CostRow): CostEntry {
  return {
    id: row.id,
    apiName: row.api_name as ApiName,
    modelId: row.model_id,
    tokensUsed: row.tokens_used,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

export interface CreateCostEntryInput {
  apiName: ApiName;
  modelId?: string;
  tokensUsed?: number;
  costUsd: number;
}

export interface UpdateCostEntryInput {
  tokensUsed?: number;
  costUsd?: number;
}

export interface ListCostEntriesOptions {
  apiName?: ApiName;
  modelId?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'cost_usd';
  orderDir?: 'asc' | 'desc';
}

export interface BudgetLimits {
  anthropicDailyUsd?: number;
  anthropicMonthlyUsd?: number;
  apifyDailyUsd?: number;
  apifyMonthlyUsd?: number;
  smaugMonthlyUsd?: number;
}

export interface BudgetStatus {
  apiName: ApiName;
  period: 'daily' | 'monthly';
  used: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
}

export function createCostEntry(input: CreateCostEntryInput): CostEntry {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO cost_tracking (api_name, model_id, tokens_used, cost_usd)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.apiName,
    input.modelId ?? null,
    input.tokensUsed ?? 0,
    input.costUsd
  );

  const entry = getCostEntryById(result.lastInsertRowid as number);
  if (!entry) {
    throw new Error('Failed to create cost entry');
  }
  return entry;
}

export function getCostEntryById(id: number): CostEntry | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM cost_tracking WHERE id = ?`);
  const row = stmt.get(id) as CostRow | undefined;
  return row ? rowToCostEntry(row) : null;
}

export function updateCostEntry(id: number, input: UpdateCostEntryInput): CostEntry | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: number[] = [];

  if (input.tokensUsed !== undefined) {
    setClauses.push('tokens_used = ?');
    values.push(input.tokensUsed);
  }
  if (input.costUsd !== undefined) {
    setClauses.push('cost_usd = ?');
    values.push(input.costUsd);
  }

  if (setClauses.length === 0) {
    return getCostEntryById(id);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE cost_tracking SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getCostEntryById(id) : null;
}

export function deleteCostEntry(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM cost_tracking WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listCostEntries(options: ListCostEntriesOptions = {}): CostEntry[] {
  const db = getDb();
  const {
    apiName,
    modelId,
    createdAfter,
    createdBefore,
    limit = 50,
    offset = 0,
    orderBy = 'created_at',
    orderDir = 'desc',
  } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (apiName !== undefined) {
    whereClauses.push('api_name = ?');
    params.push(apiName);
  }
  if (modelId !== undefined) {
    whereClauses.push('model_id = ?');
    params.push(modelId);
  }
  if (createdAfter !== undefined) {
    whereClauses.push('created_at >= ?');
    params.push(createdAfter);
  }
  if (createdBefore !== undefined) {
    whereClauses.push('created_at < ?');
    params.push(createdBefore);
  }

  let query = `SELECT * FROM cost_tracking`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as CostRow[];
  return rows.map(rowToCostEntry);
}

export function countCostEntries(apiName?: ApiName): number {
  const db = getDb();
  let query = `SELECT COUNT(*) as count FROM cost_tracking`;
  const params: string[] = [];

  if (apiName !== undefined) {
    query += ` WHERE api_name = ?`;
    params.push(apiName);
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getCostEntriesByApiName(apiName: ApiName): CostEntry[] {
  return listCostEntries({ apiName });
}

export function getTotalCostForPeriod(
  apiName: ApiName,
  startDate: string,
  endDate?: string
): number {
  const db = getDb();
  let query = `SELECT SUM(cost_usd) as total FROM cost_tracking WHERE api_name = ? AND created_at >= ?`;
  const params: string[] = [apiName, startDate];

  if (endDate !== undefined) {
    query += ` AND created_at < ?`;
    params.push(endDate);
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { total: number | null };
  return result.total ?? 0;
}

export function getTotalTokensForPeriod(
  apiName: ApiName,
  startDate: string,
  endDate?: string
): number {
  const db = getDb();
  let query = `SELECT SUM(tokens_used) as total FROM cost_tracking WHERE api_name = ? AND created_at >= ?`;
  const params: string[] = [apiName, startDate];

  if (endDate !== undefined) {
    query += ` AND created_at < ?`;
    params.push(endDate);
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { total: number | null };
  return result.total ?? 0;
}

function getStartOfDay(): string {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

function getStartOfMonth(): string {
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

export function getDailyCost(apiName: ApiName): number {
  return getTotalCostForPeriod(apiName, getStartOfDay());
}

export function getMonthlyCost(apiName: ApiName): number {
  return getTotalCostForPeriod(apiName, getStartOfMonth());
}

export function checkBudgetLimit(
  apiName: ApiName,
  proposedCost: number,
  limits: BudgetLimits
): BudgetStatus[] {
  const statuses: BudgetStatus[] = [];

  if (apiName === 'anthropic') {
    if (limits.anthropicDailyUsd !== undefined) {
      const dailyUsed = getDailyCost('anthropic');
      const remaining = limits.anthropicDailyUsd - dailyUsed;
      statuses.push({
        apiName: 'anthropic',
        period: 'daily',
        used: dailyUsed,
        limit: limits.anthropicDailyUsd,
        remaining,
        exceeded: proposedCost > remaining,
      });
    }
    if (limits.anthropicMonthlyUsd !== undefined) {
      const monthlyUsed = getMonthlyCost('anthropic');
      const remaining = limits.anthropicMonthlyUsd - monthlyUsed;
      statuses.push({
        apiName: 'anthropic',
        period: 'monthly',
        used: monthlyUsed,
        limit: limits.anthropicMonthlyUsd,
        remaining,
        exceeded: proposedCost > remaining,
      });
    }
  }

  if (apiName === 'apify') {
    if (limits.apifyDailyUsd !== undefined) {
      const dailyUsed = getDailyCost('apify');
      const remaining = limits.apifyDailyUsd - dailyUsed;
      statuses.push({
        apiName: 'apify',
        period: 'daily',
        used: dailyUsed,
        limit: limits.apifyDailyUsd,
        remaining,
        exceeded: proposedCost > remaining,
      });
    }
    if (limits.apifyMonthlyUsd !== undefined) {
      const monthlyUsed = getMonthlyCost('apify');
      const remaining = limits.apifyMonthlyUsd - monthlyUsed;
      statuses.push({
        apiName: 'apify',
        period: 'monthly',
        used: monthlyUsed,
        limit: limits.apifyMonthlyUsd,
        remaining,
        exceeded: proposedCost > remaining,
      });
    }
  }

  if (apiName === 'smaug' && limits.smaugMonthlyUsd !== undefined) {
    const monthlyUsed = getMonthlyCost('smaug');
    const remaining = limits.smaugMonthlyUsd - monthlyUsed;
    statuses.push({
      apiName: 'smaug',
      period: 'monthly',
      used: monthlyUsed,
      limit: limits.smaugMonthlyUsd,
      remaining,
      exceeded: proposedCost > remaining,
    });
  }

  return statuses;
}

export function isBudgetExceeded(
  apiName: ApiName,
  proposedCost: number,
  limits: BudgetLimits
): boolean {
  const statuses = checkBudgetLimit(apiName, proposedCost, limits);
  return statuses.some((status) => status.exceeded);
}

export function getBudgetSummary(limits: BudgetLimits): BudgetStatus[] {
  const statuses: BudgetStatus[] = [];

  if (limits.anthropicDailyUsd !== undefined) {
    const dailyUsed = getDailyCost('anthropic');
    statuses.push({
      apiName: 'anthropic',
      period: 'daily',
      used: dailyUsed,
      limit: limits.anthropicDailyUsd,
      remaining: limits.anthropicDailyUsd - dailyUsed,
      exceeded: dailyUsed >= limits.anthropicDailyUsd,
    });
  }

  if (limits.anthropicMonthlyUsd !== undefined) {
    const monthlyUsed = getMonthlyCost('anthropic');
    statuses.push({
      apiName: 'anthropic',
      period: 'monthly',
      used: monthlyUsed,
      limit: limits.anthropicMonthlyUsd,
      remaining: limits.anthropicMonthlyUsd - monthlyUsed,
      exceeded: monthlyUsed >= limits.anthropicMonthlyUsd,
    });
  }

  if (limits.apifyDailyUsd !== undefined) {
    const dailyUsed = getDailyCost('apify');
    statuses.push({
      apiName: 'apify',
      period: 'daily',
      used: dailyUsed,
      limit: limits.apifyDailyUsd,
      remaining: limits.apifyDailyUsd - dailyUsed,
      exceeded: dailyUsed >= limits.apifyDailyUsd,
    });
  }

  if (limits.apifyMonthlyUsd !== undefined) {
    const monthlyUsed = getMonthlyCost('apify');
    statuses.push({
      apiName: 'apify',
      period: 'monthly',
      used: monthlyUsed,
      limit: limits.apifyMonthlyUsd,
      remaining: limits.apifyMonthlyUsd - monthlyUsed,
      exceeded: monthlyUsed >= limits.apifyMonthlyUsd,
    });
  }

  if (limits.smaugMonthlyUsd !== undefined) {
    const monthlyUsed = getMonthlyCost('smaug');
    statuses.push({
      apiName: 'smaug',
      period: 'monthly',
      used: monthlyUsed,
      limit: limits.smaugMonthlyUsd,
      remaining: limits.smaugMonthlyUsd - monthlyUsed,
      exceeded: monthlyUsed >= limits.smaugMonthlyUsd,
    });
  }

  return statuses;
}

export interface ModelCostSummary {
  modelId: string;
  totalCost: number;
  totalTokens: number;
  entryCount: number;
}

export function getTotalCostForModel(
  modelId: string,
  startDate?: string,
  endDate?: string
): number {
  const db = getDb();
  let query = `SELECT SUM(cost_usd) as total FROM cost_tracking WHERE model_id = ?`;
  const params: string[] = [modelId];

  if (startDate !== undefined) {
    query += ` AND created_at >= ?`;
    params.push(startDate);
  }
  if (endDate !== undefined) {
    query += ` AND created_at < ?`;
    params.push(endDate);
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { total: number | null };
  return result.total ?? 0;
}

export function getTotalTokensForModel(
  modelId: string,
  startDate?: string,
  endDate?: string
): number {
  const db = getDb();
  let query = `SELECT SUM(tokens_used) as total FROM cost_tracking WHERE model_id = ?`;
  const params: string[] = [modelId];

  if (startDate !== undefined) {
    query += ` AND created_at >= ?`;
    params.push(startDate);
  }
  if (endDate !== undefined) {
    query += ` AND created_at < ?`;
    params.push(endDate);
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { total: number | null };
  return result.total ?? 0;
}

export function getDailyCostForModel(modelId: string): number {
  return getTotalCostForModel(modelId, getStartOfDay());
}

export function getMonthlyCostForModel(modelId: string): number {
  return getTotalCostForModel(modelId, getStartOfMonth());
}

export function getCostsByModel(startDate?: string, endDate?: string): ModelCostSummary[] {
  const db = getDb();
  let query = `
    SELECT
      model_id,
      SUM(cost_usd) as total_cost,
      SUM(tokens_used) as total_tokens,
      COUNT(*) as entry_count
    FROM cost_tracking
    WHERE model_id IS NOT NULL
  `;
  const params: string[] = [];

  if (startDate !== undefined) {
    query += ` AND created_at >= ?`;
    params.push(startDate);
  }
  if (endDate !== undefined) {
    query += ` AND created_at < ?`;
    params.push(endDate);
  }

  query += ` GROUP BY model_id ORDER BY total_cost DESC`;

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as Array<{
    model_id: string;
    total_cost: number;
    total_tokens: number;
    entry_count: number;
  }>;

  return rows.map((row) => ({
    modelId: row.model_id,
    totalCost: row.total_cost ?? 0,
    totalTokens: row.total_tokens ?? 0,
    entryCount: row.entry_count,
  }));
}

export function getDailyCostsByModel(): ModelCostSummary[] {
  return getCostsByModel(getStartOfDay());
}

export function getMonthlyCostsByModel(): ModelCostSummary[] {
  return getCostsByModel(getStartOfMonth());
}
