import { getDb } from '../connection';
import { QueueItem } from '@/types';

interface QueueRow {
  id: number;
  post_id: number;
  priority: number;
  scheduled_for: string | null;
  created_at: string;
}

function rowToQueueItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    postId: row.post_id,
    priority: row.priority,
    scheduledFor: row.scheduled_for,
    createdAt: row.created_at,
  };
}

export interface CreateQueueItemInput {
  postId: number;
  priority?: number;
  scheduledFor?: string | null;
}

export interface UpdateQueueItemInput {
  priority?: number;
  scheduledFor?: string | null;
}

export interface ListQueueOptions {
  minPriority?: number;
  scheduledBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'priority' | 'scheduled_for' | 'created_at';
  orderDir?: 'asc' | 'desc';
}

export function createQueueItem(input: CreateQueueItemInput): QueueItem {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO queue (post_id, priority, scheduled_for)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(input.postId, input.priority ?? 0, input.scheduledFor ?? null);

  const item = getQueueItemById(result.lastInsertRowid as number);
  if (!item) {
    throw new Error('Failed to create queue item');
  }
  return item;
}

export function getQueueItemById(id: number): QueueItem | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM queue WHERE id = ?`);
  const row = stmt.get(id) as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}

export function getQueueItemByPostId(postId: number): QueueItem | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM queue WHERE post_id = ?`);
  const row = stmt.get(postId) as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}

export function updateQueueItem(id: number, input: UpdateQueueItemInput): QueueItem | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.priority !== undefined) {
    setClauses.push('priority = ?');
    values.push(input.priority);
  }
  if (input.scheduledFor !== undefined) {
    setClauses.push('scheduled_for = ?');
    values.push(input.scheduledFor);
  }

  if (setClauses.length === 0) {
    return getQueueItemById(id);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE queue SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getQueueItemById(id) : null;
}

export function deleteQueueItem(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM queue WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function deleteQueueItemByPostId(postId: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM queue WHERE post_id = ?`);
  const result = stmt.run(postId);
  return result.changes > 0;
}

export function listQueue(options: ListQueueOptions = {}): QueueItem[] {
  const db = getDb();
  const {
    minPriority,
    scheduledBefore,
    limit = 50,
    offset = 0,
    orderBy = 'priority',
    orderDir = 'desc',
  } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (minPriority !== undefined) {
    whereClauses.push('priority >= ?');
    params.push(minPriority);
  }
  if (scheduledBefore !== undefined) {
    whereClauses.push('(scheduled_for IS NULL OR scheduled_for <= ?)');
    params.push(scheduledBefore);
  }

  let query = `SELECT * FROM queue`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as QueueRow[];
  return rows.map(rowToQueueItem);
}

export function countQueue(): number {
  const db = getDb();
  const stmt = db.prepare(`SELECT COUNT(*) as count FROM queue`);
  const result = stmt.get() as { count: number };
  return result.count;
}

export function getNextInQueue(): QueueItem | null {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    SELECT * FROM queue
    WHERE scheduled_for IS NULL OR scheduled_for <= ?
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `);
  const row = stmt.get(now) as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}

export function reorderQueue(itemId: number, newPriority: number): QueueItem | null {
  return updateQueueItem(itemId, { priority: newPriority });
}
