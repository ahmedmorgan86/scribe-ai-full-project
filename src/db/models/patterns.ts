import { getDb } from '../connection';
import { Pattern, PatternEvidenceSource, PatternStatus, PatternType } from '@/types';

interface PatternRow {
  id: number;
  pattern_type: string;
  description: string;
  evidence_count: number;
  edit_evidence_count: number;
  rejection_evidence_count: number;
  last_accessed_at: string | null;
  access_count: number;
  decay_score: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToPattern(row: PatternRow): Pattern {
  return {
    id: row.id,
    patternType: row.pattern_type as PatternType,
    description: row.description,
    evidenceCount: row.evidence_count,
    editEvidenceCount: row.edit_evidence_count ?? 0,
    rejectionEvidenceCount: row.rejection_evidence_count ?? 0,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count ?? 0,
    decayScore: row.decay_score ?? 1.0,
    status: (row.status as PatternStatus) ?? 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreatePatternInput {
  patternType: PatternType;
  description: string;
  evidenceCount?: number;
  editEvidenceCount?: number;
  rejectionEvidenceCount?: number;
  lastAccessedAt?: string | null;
  accessCount?: number;
  decayScore?: number;
  status?: PatternStatus;
}

export interface UpdatePatternInput {
  patternType?: PatternType;
  description?: string;
  evidenceCount?: number;
  editEvidenceCount?: number;
  rejectionEvidenceCount?: number;
  lastAccessedAt?: string | null;
  accessCount?: number;
  decayScore?: number;
  status?: PatternStatus;
}

export interface ListPatternsOptions {
  patternType?: PatternType;
  status?: PatternStatus;
  minEvidenceCount?: number;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'updated_at' | 'evidence_count' | 'decay_score';
  orderDir?: 'asc' | 'desc';
}

export function createPattern(input: CreatePatternInput): Pattern {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO patterns (
      pattern_type, description, evidence_count,
      edit_evidence_count, rejection_evidence_count,
      last_accessed_at, access_count, decay_score, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.patternType,
    input.description,
    input.evidenceCount ?? 0,
    input.editEvidenceCount ?? 0,
    input.rejectionEvidenceCount ?? 0,
    input.lastAccessedAt ?? null,
    input.accessCount ?? 0,
    input.decayScore ?? 1.0,
    input.status ?? 'active'
  );

  const pattern = getPatternById(result.lastInsertRowid as number);
  if (!pattern) {
    throw new Error('Failed to create pattern');
  }
  return pattern;
}

export function getPatternById(id: number): Pattern | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM patterns WHERE id = ?`);
  const row = stmt.get(id) as PatternRow | undefined;
  return row ? rowToPattern(row) : null;
}

export function updatePattern(id: number, input: UpdatePatternInput): Pattern | null {
  const db = getDb();
  const setClauses: string[] = ["updated_at = datetime('now')"];
  const values: (string | number | null)[] = [];

  if (input.patternType !== undefined) {
    setClauses.push('pattern_type = ?');
    values.push(input.patternType);
  }
  if (input.description !== undefined) {
    setClauses.push('description = ?');
    values.push(input.description);
  }
  if (input.evidenceCount !== undefined) {
    setClauses.push('evidence_count = ?');
    values.push(input.evidenceCount);
  }
  if (input.editEvidenceCount !== undefined) {
    setClauses.push('edit_evidence_count = ?');
    values.push(input.editEvidenceCount);
  }
  if (input.rejectionEvidenceCount !== undefined) {
    setClauses.push('rejection_evidence_count = ?');
    values.push(input.rejectionEvidenceCount);
  }
  if (input.lastAccessedAt !== undefined) {
    setClauses.push('last_accessed_at = ?');
    values.push(input.lastAccessedAt);
  }
  if (input.accessCount !== undefined) {
    setClauses.push('access_count = ?');
    values.push(input.accessCount);
  }
  if (input.decayScore !== undefined) {
    setClauses.push('decay_score = ?');
    values.push(input.decayScore);
  }
  if (input.status !== undefined) {
    setClauses.push('status = ?');
    values.push(input.status);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE patterns SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getPatternById(id) : null;
}

export function deletePattern(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM patterns WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listPatterns(options: ListPatternsOptions = {}): Pattern[] {
  const db = getDb();
  const {
    patternType,
    status,
    minEvidenceCount,
    limit = 50,
    offset = 0,
    orderBy = 'created_at',
    orderDir = 'desc',
  } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (patternType !== undefined) {
    whereClauses.push('pattern_type = ?');
    params.push(patternType);
  }
  if (status !== undefined) {
    whereClauses.push('status = ?');
    params.push(status);
  }
  if (minEvidenceCount !== undefined) {
    whereClauses.push('evidence_count >= ?');
    params.push(minEvidenceCount);
  }

  let query = `SELECT * FROM patterns`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as PatternRow[];
  return rows.map(rowToPattern);
}

export function countPatterns(options: { patternType?: PatternType } = {}): number {
  const db = getDb();
  const { patternType } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (patternType !== undefined) {
    whereClauses.push('pattern_type = ?');
    params.push(patternType);
  }

  let query = `SELECT COUNT(*) as count FROM patterns`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getPatternsByType(patternType: PatternType): Pattern[] {
  return listPatterns({ patternType, orderDir: 'desc' });
}

export function incrementEvidenceCount(id: number): Pattern | null {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE patterns
    SET evidence_count = evidence_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `);
  const result = stmt.run(id);
  return result.changes > 0 ? getPatternById(id) : null;
}

export function incrementEvidenceBySource(
  id: number,
  source: PatternEvidenceSource
): Pattern | null {
  const db = getDb();
  let stmt;

  if (source === 'edit') {
    stmt = db.prepare(`
      UPDATE patterns
      SET evidence_count = evidence_count + 1,
          edit_evidence_count = edit_evidence_count + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `);
  } else if (source === 'rejection') {
    stmt = db.prepare(`
      UPDATE patterns
      SET evidence_count = evidence_count + 1,
          rejection_evidence_count = rejection_evidence_count + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `);
  } else {
    stmt = db.prepare(`
      UPDATE patterns
      SET evidence_count = evidence_count + 1, updated_at = datetime('now')
      WHERE id = ?
    `);
  }

  const result = stmt.run(id);
  return result.changes > 0 ? getPatternById(id) : null;
}
