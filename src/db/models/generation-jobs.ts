import { getDb } from '../connection';
import { GenerationJob, GenerationJobPipeline, GenerationJobStatus } from '@/types';
import { randomUUID } from 'crypto';

interface GenerationJobRow {
  id: string;
  pipeline: string;
  status: string;
  source_ids: string | null;
  post_id: number | null;
  content_type: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  metadata: string | null;
}

function rowToGenerationJob(row: GenerationJobRow): GenerationJob {
  let sourceIds: number[] | null = null;
  if (row.source_ids) {
    try {
      sourceIds = JSON.parse(row.source_ids) as number[];
    } catch {
      sourceIds = null;
    }
  }

  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }

  return {
    id: row.id,
    pipeline: row.pipeline as GenerationJobPipeline,
    status: row.status as GenerationJobStatus,
    sourceIds,
    postId: row.post_id,
    contentType: row.content_type,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    metadata,
  };
}

export interface CreateGenerationJobInput {
  id?: string;
  pipeline: GenerationJobPipeline;
  sourceIds?: number[];
  contentType?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateGenerationJobInput {
  status?: GenerationJobStatus;
  postId?: number | null;
  error?: string | null;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ListGenerationJobsOptions {
  pipeline?: GenerationJobPipeline;
  status?: GenerationJobStatus;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'started_at' | 'completed_at';
  orderDir?: 'asc' | 'desc';
}

export function createGenerationJob(input: CreateGenerationJobInput): GenerationJob {
  const db = getDb();
  const id = input.id ?? randomUUID();

  const stmt = db.prepare(`
    INSERT INTO generation_jobs (id, pipeline, status, source_ids, content_type, metadata)
    VALUES (?, ?, 'pending', ?, ?, ?)
  `);

  stmt.run(
    id,
    input.pipeline,
    input.sourceIds ? JSON.stringify(input.sourceIds) : null,
    input.contentType ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null
  );

  const job = getGenerationJobById(id);
  if (!job) {
    throw new Error('Failed to create generation job');
  }
  return job;
}

export function getGenerationJobById(id: string): GenerationJob | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM generation_jobs WHERE id = ?`);
  const row = stmt.get(id) as GenerationJobRow | undefined;
  return row ? rowToGenerationJob(row) : null;
}

export function updateGenerationJob(
  id: string,
  input: UpdateGenerationJobInput
): GenerationJob | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.status !== undefined) {
    setClauses.push('status = ?');
    values.push(input.status);
  }
  if (input.postId !== undefined) {
    setClauses.push('post_id = ?');
    values.push(input.postId);
  }
  if (input.error !== undefined) {
    setClauses.push('error = ?');
    values.push(input.error);
  }
  if (input.completedAt !== undefined) {
    setClauses.push('completed_at = ?');
    values.push(input.completedAt);
  }
  if (input.metadata !== undefined) {
    setClauses.push('metadata = ?');
    values.push(JSON.stringify(input.metadata));
  }

  if (setClauses.length === 0) {
    return getGenerationJobById(id);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE generation_jobs SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getGenerationJobById(id) : null;
}

export function deleteGenerationJob(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM generation_jobs WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listGenerationJobs(options: ListGenerationJobsOptions = {}): GenerationJob[] {
  const db = getDb();
  const {
    pipeline,
    status,
    startedAfter,
    startedBefore,
    limit = 50,
    offset = 0,
    orderBy = 'started_at',
    orderDir = 'desc',
  } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (pipeline !== undefined) {
    whereClauses.push('pipeline = ?');
    params.push(pipeline);
  }
  if (status !== undefined) {
    whereClauses.push('status = ?');
    params.push(status);
  }
  if (startedAfter !== undefined) {
    whereClauses.push('started_at >= ?');
    params.push(startedAfter);
  }
  if (startedBefore !== undefined) {
    whereClauses.push('started_at < ?');
    params.push(startedBefore);
  }

  let query = `SELECT * FROM generation_jobs`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as GenerationJobRow[];
  return rows.map(rowToGenerationJob);
}

export function countGenerationJobs(
  options: { pipeline?: GenerationJobPipeline; status?: GenerationJobStatus } = {}
): number {
  const db = getDb();
  const whereClauses: string[] = [];
  const params: string[] = [];

  if (options.pipeline !== undefined) {
    whereClauses.push('pipeline = ?');
    params.push(options.pipeline);
  }
  if (options.status !== undefined) {
    whereClauses.push('status = ?');
    params.push(options.status);
  }

  let query = `SELECT COUNT(*) as count FROM generation_jobs`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function startGenerationJob(id: string): GenerationJob | null {
  return updateGenerationJob(id, { status: 'running' });
}

export function completeGenerationJob(
  id: string,
  postId: number | null = null
): GenerationJob | null {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  return updateGenerationJob(id, {
    status: 'completed',
    postId,
    completedAt: now,
  });
}

export function failGenerationJob(id: string, error: string): GenerationJob | null {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  return updateGenerationJob(id, {
    status: 'failed',
    error,
    completedAt: now,
  });
}

export function getRunningJobs(): GenerationJob[] {
  return listGenerationJobs({ status: 'running' });
}

export function getPendingJobs(): GenerationJob[] {
  return listGenerationJobs({ status: 'pending' });
}

export function getRecentJobs(limit: number = 20): GenerationJob[] {
  return listGenerationJobs({ limit, orderBy: 'started_at', orderDir: 'desc' });
}

export function getJobsByPostId(postId: number): GenerationJob[] {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT * FROM generation_jobs WHERE post_id = ? ORDER BY started_at DESC`
  );
  const rows = stmt.all(postId) as GenerationJobRow[];
  return rows.map(rowToGenerationJob);
}

export interface JobStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  byPipeline: {
    langgraph: number;
    typescript: number;
  };
}

export function getJobStats(): JobStats {
  const db = getDb();

  const totalStmt = db.prepare(`SELECT COUNT(*) as count FROM generation_jobs`);
  const total = (totalStmt.get() as { count: number }).count;

  const pendingStmt = db.prepare(
    `SELECT COUNT(*) as count FROM generation_jobs WHERE status = 'pending'`
  );
  const pending = (pendingStmt.get() as { count: number }).count;

  const runningStmt = db.prepare(
    `SELECT COUNT(*) as count FROM generation_jobs WHERE status = 'running'`
  );
  const running = (runningStmt.get() as { count: number }).count;

  const completedStmt = db.prepare(
    `SELECT COUNT(*) as count FROM generation_jobs WHERE status = 'completed'`
  );
  const completed = (completedStmt.get() as { count: number }).count;

  const failedStmt = db.prepare(
    `SELECT COUNT(*) as count FROM generation_jobs WHERE status = 'failed'`
  );
  const failed = (failedStmt.get() as { count: number }).count;

  const langgraphStmt = db.prepare(
    `SELECT COUNT(*) as count FROM generation_jobs WHERE pipeline = 'langgraph'`
  );
  const langgraph = (langgraphStmt.get() as { count: number }).count;

  const typescriptStmt = db.prepare(
    `SELECT COUNT(*) as count FROM generation_jobs WHERE pipeline = 'typescript'`
  );
  const typescript = (typescriptStmt.get() as { count: number }).count;

  return {
    total,
    pending,
    running,
    completed,
    failed,
    byPipeline: {
      langgraph,
      typescript,
    },
  };
}

export function cleanupOldJobs(olderThanDays: number = 30): number {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const cutoffStr = cutoff.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

  const stmt = db.prepare(`
    DELETE FROM generation_jobs
    WHERE started_at < ? AND status IN ('completed', 'failed')
  `);
  const result = stmt.run(cutoffStr);
  return result.changes;
}
