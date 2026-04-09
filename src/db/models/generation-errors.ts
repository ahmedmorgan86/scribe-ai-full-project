import { getDb } from '../connection';
import { randomUUID } from 'crypto';

export interface GenerationError {
  id: string;
  errorType: string;
  errorDetails: string | null;
  patternsUsed: string | null;
  createdAt: string;
}

interface GenerationErrorRow {
  id: string;
  error_type: string;
  error_details: string | null;
  patterns_used: string | null;
  created_at: string;
}

function rowToGenerationError(row: GenerationErrorRow): GenerationError {
  return {
    id: row.id,
    errorType: row.error_type,
    errorDetails: row.error_details,
    patternsUsed: row.patterns_used,
    createdAt: row.created_at,
  };
}

export interface CreateGenerationErrorInput {
  errorType: string;
  errorDetails?: string | null;
  patternsUsed?: string[] | null;
}

export function createGenerationError(input: CreateGenerationErrorInput): GenerationError {
  const db = getDb();
  const id = randomUUID();
  const patternsJson = input.patternsUsed ? JSON.stringify(input.patternsUsed) : null;

  const stmt = db.prepare(`
    INSERT INTO generation_errors (id, error_type, error_details, patterns_used)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(id, input.errorType, input.errorDetails ?? null, patternsJson);

  const error = getGenerationErrorById(id);
  if (!error) {
    throw new Error('Failed to create generation error');
  }
  return error;
}

export function getGenerationErrorById(id: string): GenerationError | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM generation_errors WHERE id = ?`);
  const row = stmt.get(id) as GenerationErrorRow | undefined;
  return row ? rowToGenerationError(row) : null;
}

export interface ListGenerationErrorsOptions {
  errorType?: string;
  limit?: number;
  offset?: number;
  since?: string;
}

export function listGenerationErrors(options: ListGenerationErrorsOptions = {}): GenerationError[] {
  const db = getDb();
  const { errorType, limit = 100, offset = 0, since } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (errorType !== undefined) {
    whereClauses.push('error_type = ?');
    params.push(errorType);
  }
  if (since !== undefined) {
    whereClauses.push('created_at >= ?');
    params.push(since);
  }

  let query = `SELECT * FROM generation_errors`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY created_at DESC`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as GenerationErrorRow[];
  return rows.map(rowToGenerationError);
}

export function countGenerationErrors(
  options: { errorType?: string; since?: string } = {}
): number {
  const db = getDb();
  const { errorType, since } = options;

  const whereClauses: string[] = [];
  const params: string[] = [];

  if (errorType !== undefined) {
    whereClauses.push('error_type = ?');
    params.push(errorType);
  }
  if (since !== undefined) {
    whereClauses.push('created_at >= ?');
    params.push(since);
  }

  let query = `SELECT COUNT(*) as count FROM generation_errors`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getPatternErrorRate(patternId: number): number {
  const db = getDb();
  const patternIdStr = String(patternId);

  // Count errors where this pattern was used
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM generation_errors
    WHERE patterns_used LIKE ?
  `);
  const result = stmt.get(`%${patternIdStr}%`) as { count: number };

  return result.count;
}

export function deleteOldGenerationErrors(olderThanDays: number = 30): number {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  const cutoffStr = cutoffDate.toISOString();

  const stmt = db.prepare(`DELETE FROM generation_errors WHERE created_at < ?`);
  const result = stmt.run(cutoffStr);
  return result.changes;
}
