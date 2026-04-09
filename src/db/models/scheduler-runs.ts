import { getDb } from '../connection';

export type RunStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface SchedulerRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  status: RunStatus;
  sourceId: number | null;
  postsGenerated: number;
  postsQueued: number;
  error: string | null;
  durationMs: number | null;
}

interface SchedulerRunRow {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  source_id: number | null;
  posts_generated: number;
  posts_queued: number;
  error: string | null;
  duration_ms: number | null;
}

function rowToRun(row: SchedulerRunRow): SchedulerRun {
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status as RunStatus,
    sourceId: row.source_id,
    postsGenerated: row.posts_generated,
    postsQueued: row.posts_queued,
    error: row.error,
    durationMs: row.duration_ms,
  };
}

export interface CreateRunInput {
  sourceId?: number | null;
}

export function createSchedulerRun(input: CreateRunInput = {}): SchedulerRun {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO scheduler_runs (started_at, status, source_id)
    VALUES (?, 'running', ?)
  `);
  const result = stmt.run(now, input.sourceId ?? null);

  const run = getSchedulerRunById(Number(result.lastInsertRowid));
  if (!run) {
    throw new Error('Failed to create scheduler run');
  }
  return run;
}

export function getSchedulerRunById(id: number): SchedulerRun | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM scheduler_runs WHERE id = ?');
  const row = stmt.get(id) as SchedulerRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export interface UpdateRunInput {
  status?: RunStatus;
  completedAt?: string;
  postsGenerated?: number;
  postsQueued?: number;
  error?: string | null;
  durationMs?: number;
}

export function updateSchedulerRun(id: number, input: UpdateRunInput): SchedulerRun | null {
  const db = getDb();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.completedAt !== undefined) {
    updates.push('completed_at = ?');
    values.push(input.completedAt);
  }
  if (input.postsGenerated !== undefined) {
    updates.push('posts_generated = ?');
    values.push(input.postsGenerated);
  }
  if (input.postsQueued !== undefined) {
    updates.push('posts_queued = ?');
    values.push(input.postsQueued);
  }
  if (input.error !== undefined) {
    updates.push('error = ?');
    values.push(input.error);
  }
  if (input.durationMs !== undefined) {
    updates.push('duration_ms = ?');
    values.push(input.durationMs);
  }

  if (updates.length === 0) {
    return getSchedulerRunById(id);
  }

  values.push(id);
  const sql = `UPDATE scheduler_runs SET ${updates.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...values);

  return getSchedulerRunById(id);
}

export function completeSchedulerRun(
  id: number,
  status: 'completed' | 'failed' | 'skipped',
  postsGenerated: number,
  postsQueued: number,
  error?: string
): SchedulerRun | null {
  const run = getSchedulerRunById(id);
  if (!run) return null;

  const now = new Date();
  const startedAt = new Date(run.startedAt);
  const durationMs = now.getTime() - startedAt.getTime();

  return updateSchedulerRun(id, {
    status,
    completedAt: now.toISOString(),
    postsGenerated,
    postsQueued,
    error: error ?? null,
    durationMs,
  });
}

export function getRecentSchedulerRuns(limit = 10): SchedulerRun[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM scheduler_runs
    ORDER BY started_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as SchedulerRunRow[];
  return rows.map(rowToRun);
}

export function getSchedulerRunStats(days = 7): {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  skippedRuns: number;
  totalPostsGenerated: number;
  totalPostsQueued: number;
  avgDurationMs: number;
} {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total_runs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_runs,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_runs,
      SUM(posts_generated) as total_posts_generated,
      SUM(posts_queued) as total_posts_queued,
      AVG(duration_ms) as avg_duration_ms
    FROM scheduler_runs
    WHERE started_at >= ?
  `);

  const row = stmt.get(cutoff.toISOString()) as {
    total_runs: number;
    successful_runs: number;
    failed_runs: number;
    skipped_runs: number;
    total_posts_generated: number | null;
    total_posts_queued: number | null;
    avg_duration_ms: number | null;
  };

  return {
    totalRuns: row.total_runs,
    successfulRuns: row.successful_runs,
    failedRuns: row.failed_runs,
    skippedRuns: row.skipped_runs,
    totalPostsGenerated: row.total_posts_generated ?? 0,
    totalPostsQueued: row.total_posts_queued ?? 0,
    avgDurationMs: Math.round(row.avg_duration_ms ?? 0),
  };
}
