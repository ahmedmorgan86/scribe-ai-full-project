import { getDb } from '../connection';
import { Source, SourceType, SourceMetadata } from '@/types';

interface SourceRow {
  id: number;
  source_type: SourceType;
  source_id: string;
  content: string;
  metadata: string;
  scraped_at: string;
  used: number;
  used_at: string | null;
  quality_score: number | null;
}

export interface ExtendedSource extends Source {
  used: boolean;
  usedAt: string | null;
  qualityScore: number | null;
}

function rowToSource(row: SourceRow): Source {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    content: row.content,
    metadata: JSON.parse(row.metadata) as SourceMetadata,
    scrapedAt: row.scraped_at,
  };
}

function rowToExtendedSource(row: SourceRow): ExtendedSource {
  return {
    ...rowToSource(row),
    used: row.used === 1,
    usedAt: row.used_at,
    qualityScore: row.quality_score,
  };
}

export interface CreateSourceInput {
  sourceType: SourceType;
  sourceId: string;
  content: string;
  metadata?: SourceMetadata;
}

export interface UpdateSourceInput {
  content?: string;
  metadata?: SourceMetadata;
}

export interface ListSourcesOptions {
  sourceType?: SourceType;
  scrapedAfter?: string;
  scrapedBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'scraped_at' | 'source_type';
  orderDir?: 'asc' | 'desc';
}

export function createSource(input: CreateSourceInput): Source {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sources (source_type, source_id, content, metadata)
    VALUES (?, ?, ?, ?)
  `);

  const metadataJson = JSON.stringify(input.metadata ?? {});
  const result = stmt.run(input.sourceType, input.sourceId, input.content, metadataJson);

  const source = getSourceById(result.lastInsertRowid as number);
  if (!source) {
    throw new Error('Failed to create source');
  }
  return source;
}

export function getSourceById(id: number): Source | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM sources WHERE id = ?`);
  const row = stmt.get(id) as SourceRow | undefined;
  return row ? rowToSource(row) : null;
}

export function getSourceBySourceId(sourceType: SourceType, sourceId: string): Source | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM sources WHERE source_type = ? AND source_id = ?`);
  const row = stmt.get(sourceType, sourceId) as SourceRow | undefined;
  return row ? rowToSource(row) : null;
}

export function updateSource(id: number, input: UpdateSourceInput): Source | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | number)[] = [];

  if (input.content !== undefined) {
    setClauses.push('content = ?');
    values.push(input.content);
  }
  if (input.metadata !== undefined) {
    setClauses.push('metadata = ?');
    values.push(JSON.stringify(input.metadata));
  }

  if (setClauses.length === 0) {
    return getSourceById(id);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE sources SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getSourceById(id) : null;
}

export function deleteSource(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM sources WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listSources(options: ListSourcesOptions = {}): Source[] {
  const db = getDb();
  const {
    sourceType,
    scrapedAfter,
    scrapedBefore,
    limit = 50,
    offset = 0,
    orderBy = 'scraped_at',
    orderDir = 'desc',
  } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (sourceType !== undefined) {
    whereClauses.push('source_type = ?');
    params.push(sourceType);
  }
  if (scrapedAfter !== undefined) {
    whereClauses.push('scraped_at > ?');
    params.push(scrapedAfter);
  }
  if (scrapedBefore !== undefined) {
    whereClauses.push('scraped_at <= ?');
    params.push(scrapedBefore);
  }

  let query = `SELECT * FROM sources`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as SourceRow[];
  return rows.map(rowToSource);
}

export function countSources(sourceType?: SourceType): number {
  const db = getDb();
  let query = `SELECT COUNT(*) as count FROM sources`;
  const params: string[] = [];

  if (sourceType !== undefined) {
    query += ` WHERE source_type = ?`;
    params.push(sourceType);
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getSourcesByType(sourceType: SourceType): Source[] {
  return listSources({ sourceType });
}

export function sourceExists(sourceType: SourceType, sourceId: string): boolean {
  const db = getDb();
  const stmt = db.prepare(`SELECT 1 FROM sources WHERE source_type = ? AND source_id = ? LIMIT 1`);
  const row = stmt.get(sourceType, sourceId);
  return row !== undefined;
}

export function sourceExistsByExternalId(sourceId: string): boolean {
  const db = getDb();
  const stmt = db.prepare(`SELECT 1 FROM sources WHERE source_id = ? LIMIT 1`);
  const row = stmt.get(sourceId);
  return row !== undefined;
}

export function getUnusedSources(limit = 50): ExtendedSource[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM sources
    WHERE used = 0
    ORDER BY quality_score DESC NULLS LAST, scraped_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as SourceRow[];
  return rows.map(rowToExtendedSource);
}

export function markSourceAsUsed(id: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE sources SET used = 1, used_at = ? WHERE id = ?`).run(now, id);
}

export function updateQualityScore(id: number, score: number): void {
  const db = getDb();
  db.prepare(`UPDATE sources SET quality_score = ? WHERE id = ?`).run(score, id);
}

export interface SourceStats {
  total: number;
  unused: number;
  usedToday: number;
  byType: Record<string, number>;
}

export function getSourceStats(): SourceStats {
  const db = getDb();

  const totalResult = db.prepare(`SELECT COUNT(*) as count FROM sources`).get() as {
    count: number;
  };
  const unusedResult = db.prepare(`SELECT COUNT(*) as count FROM sources WHERE used = 0`).get() as {
    count: number;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const usedTodayResult = db
    .prepare(`SELECT COUNT(*) as count FROM sources WHERE used_at >= ?`)
    .get(today.toISOString()) as { count: number };

  const byTypeRows = db
    .prepare(`SELECT source_type, COUNT(*) as count FROM sources GROUP BY source_type`)
    .all() as Array<{ source_type: string; count: number }>;

  const byType: Record<string, number> = {};
  for (const row of byTypeRows) {
    byType[row.source_type] = row.count;
  }

  return {
    total: totalResult.count,
    unused: unusedResult.count,
    usedToday: usedTodayResult.count,
    byType,
  };
}

export function getSourcesByAccount(handle: string): ExtendedSource[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM sources
    WHERE json_extract(metadata, '$.authorHandle') = ?
    ORDER BY scraped_at DESC
  `);
  const rows = stmt.all(handle) as SourceRow[];
  return rows.map(rowToExtendedSource);
}

export function deleteOldSources(daysOld: number): number {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const result = db
    .prepare(`DELETE FROM sources WHERE used = 1 AND used_at < ?`)
    .run(cutoff.toISOString());

  return result.changes;
}
