import { getDb } from '../connection';
import { Feedback, FeedbackAction, FeedbackCategory } from '@/types';

interface FeedbackRow {
  id: number;
  post_id: number;
  action: string;
  category: string | null;
  comment: string | null;
  diff_before: string | null;
  diff_after: string | null;
  created_at: string;
}

function rowToFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    postId: row.post_id,
    action: row.action as FeedbackAction,
    category: row.category as FeedbackCategory | null,
    comment: row.comment,
    diffBefore: row.diff_before,
    diffAfter: row.diff_after,
    createdAt: row.created_at,
  };
}

export interface CreateFeedbackInput {
  postId: number;
  action: FeedbackAction;
  category?: FeedbackCategory | null;
  comment?: string | null;
  diffBefore?: string | null;
  diffAfter?: string | null;
}

export interface UpdateFeedbackInput {
  category?: FeedbackCategory | null;
  comment?: string | null;
  diffBefore?: string | null;
  diffAfter?: string | null;
}

export interface ListFeedbackOptions {
  postId?: number;
  action?: FeedbackAction;
  category?: FeedbackCategory;
  limit?: number;
  offset?: number;
  orderDir?: 'asc' | 'desc';
}

export function createFeedback(input: CreateFeedbackInput): Feedback {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO feedback (post_id, action, category, comment, diff_before, diff_after)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.postId,
    input.action,
    input.category ?? null,
    input.comment ?? null,
    input.diffBefore ?? null,
    input.diffAfter ?? null
  );

  const feedback = getFeedbackById(result.lastInsertRowid as number);
  if (!feedback) {
    throw new Error('Failed to create feedback');
  }
  return feedback;
}

export function getFeedbackById(id: number): Feedback | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM feedback WHERE id = ?`);
  const row = stmt.get(id) as FeedbackRow | undefined;
  return row ? rowToFeedback(row) : null;
}

export function updateFeedback(id: number, input: UpdateFeedbackInput): Feedback | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | null)[] = [];

  if (input.category !== undefined) {
    setClauses.push('category = ?');
    values.push(input.category);
  }
  if (input.comment !== undefined) {
    setClauses.push('comment = ?');
    values.push(input.comment);
  }
  if (input.diffBefore !== undefined) {
    setClauses.push('diff_before = ?');
    values.push(input.diffBefore);
  }
  if (input.diffAfter !== undefined) {
    setClauses.push('diff_after = ?');
    values.push(input.diffAfter);
  }

  if (setClauses.length === 0) {
    return getFeedbackById(id);
  }

  values.push(id as unknown as string);
  const stmt = db.prepare(`UPDATE feedback SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getFeedbackById(id) : null;
}

export function deleteFeedback(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM feedback WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listFeedback(options: ListFeedbackOptions = {}): Feedback[] {
  const db = getDb();
  const { postId, action, category, limit = 50, offset = 0, orderDir = 'desc' } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (postId !== undefined) {
    whereClauses.push('post_id = ?');
    params.push(postId);
  }
  if (action !== undefined) {
    whereClauses.push('action = ?');
    params.push(action);
  }
  if (category !== undefined) {
    whereClauses.push('category = ?');
    params.push(category);
  }

  let query = `SELECT * FROM feedback`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY created_at ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as FeedbackRow[];
  return rows.map(rowToFeedback);
}

export function countFeedback(options: { postId?: number; action?: FeedbackAction } = {}): number {
  const db = getDb();
  const { postId, action } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (postId !== undefined) {
    whereClauses.push('post_id = ?');
    params.push(postId);
  }
  if (action !== undefined) {
    whereClauses.push('action = ?');
    params.push(action);
  }

  let query = `SELECT COUNT(*) as count FROM feedback`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getFeedbackByPostId(postId: number): Feedback[] {
  return listFeedback({ postId, orderDir: 'desc' });
}

export function getFeedbackByAction(action: FeedbackAction, limit = 50): Feedback[] {
  return listFeedback({ action, limit });
}
