import { getDb } from '../connection';

export interface RejectionStat {
  id: number;
  reason: string;
  count: number;
  lastOccurrence: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RejectionStatRow {
  id: number;
  reason: string;
  count: number;
  last_occurrence: string | null;
  created_at: string;
  updated_at: string;
}

function rowToStat(row: RejectionStatRow): RejectionStat {
  return {
    id: row.id,
    reason: row.reason,
    count: row.count,
    lastOccurrence: row.last_occurrence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function incrementRejectionStat(reason: string): RejectionStat {
  const db = getDb();
  const now = new Date().toISOString();

  // Try to update existing record
  const updateStmt = db.prepare(`
    UPDATE rejection_stats
    SET count = count + 1, last_occurrence = ?, updated_at = ?
    WHERE reason = ?
  `);
  const result = updateStmt.run(now, now, reason);

  if (result.changes === 0) {
    // Insert new record if not exists
    const insertStmt = db.prepare(`
      INSERT INTO rejection_stats (reason, count, last_occurrence, created_at, updated_at)
      VALUES (?, 1, ?, ?, ?)
    `);
    insertStmt.run(reason, now, now, now);
  }

  const stat = getRejectionStatByReason(reason);
  if (!stat) {
    throw new Error(`Failed to create rejection stat for reason: ${reason}`);
  }
  return stat;
}

export function getRejectionStatByReason(reason: string): RejectionStat | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM rejection_stats WHERE reason = ?`);
  const row = stmt.get(reason) as RejectionStatRow | undefined;
  return row ? rowToStat(row) : null;
}

export function getAllRejectionStats(): RejectionStat[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM rejection_stats ORDER BY count DESC`);
  const rows = stmt.all() as RejectionStatRow[];
  return rows.map(rowToStat);
}

export function getTopRejectionReasons(limit = 5): RejectionStat[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM rejection_stats ORDER BY count DESC LIMIT ?`);
  const rows = stmt.all(limit) as RejectionStatRow[];
  return rows.map(rowToStat);
}

export function getTotalRejections(): number {
  const db = getDb();
  const stmt = db.prepare(`SELECT SUM(count) as total FROM rejection_stats`);
  const result = stmt.get() as { total: number | null };
  return result.total ?? 0;
}

export interface RejectionTrend {
  reason: string;
  count: number;
  percentage: number;
}

export function getRejectionTrends(): RejectionTrend[] {
  const stats = getAllRejectionStats();
  const total = stats.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return [];
  }

  return stats.map((s) => ({
    reason: s.reason,
    count: s.count,
    percentage: Math.round((s.count / total) * 100),
  }));
}

export function getRecentRejectionsByReason(days = 7): RejectionStat[] {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const stmt = db.prepare(`
    SELECT * FROM rejection_stats
    WHERE last_occurrence >= ?
    ORDER BY count DESC
  `);
  const rows = stmt.all(cutoff.toISOString()) as RejectionStatRow[];
  return rows.map(rowToStat);
}
