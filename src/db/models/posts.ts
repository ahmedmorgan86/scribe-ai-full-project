import { getDb } from '../connection';
import {
  Post,
  PostReasoning,
  PostStatus,
  PostType,
  StoredVoiceEvaluation,
  StyleSignatureData,
} from '@/types';

interface PostRow {
  id: number;
  content: string;
  type: string;
  status: string;
  confidence_score: number;
  reasoning: string;
  voice_evaluation: string | null;
  stylometric_signature: string | null;
  created_at: string;
  posted_at: string | null;
  copied_at: string | null;
  langgraph_job_id: string | null;
  rejection_reason: string | null;
  rejection_comment: string | null;
  rejected_at: string | null;
}

function rowToPost(row: PostRow): Post {
  return {
    id: row.id,
    content: row.content,
    type: row.type as PostType,
    status: row.status as PostStatus,
    confidenceScore: row.confidence_score,
    reasoning: JSON.parse(row.reasoning) as PostReasoning,
    voiceEvaluation: row.voice_evaluation
      ? (JSON.parse(row.voice_evaluation) as StoredVoiceEvaluation)
      : null,
    stylometricSignature: row.stylometric_signature
      ? (JSON.parse(row.stylometric_signature) as StyleSignatureData)
      : null,
    createdAt: row.created_at,
    postedAt: row.posted_at,
    copiedAt: row.copied_at,
    langGraphJobId: row.langgraph_job_id,
    rejectionReason: row.rejection_reason,
    rejectionComment: row.rejection_comment,
    rejectedAt: row.rejected_at,
  };
}

export interface CreatePostInput {
  content: string;
  type: PostType;
  status?: PostStatus;
  confidenceScore?: number;
  reasoning?: PostReasoning;
  voiceEvaluation?: StoredVoiceEvaluation;
  stylometricSignature?: StyleSignatureData;
  langGraphJobId?: string;
}

export interface UpdatePostInput {
  content?: string;
  type?: PostType;
  status?: PostStatus;
  confidenceScore?: number;
  reasoning?: PostReasoning;
  voiceEvaluation?: StoredVoiceEvaluation | null;
  stylometricSignature?: StyleSignatureData | null;
  postedAt?: string | null;
  rejectionReason?: string | null;
  rejectionComment?: string | null;
  rejectedAt?: string | null;
}

export interface ListPostsOptions {
  status?: PostStatus;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'confidence_score';
  orderDir?: 'asc' | 'desc';
}

export function createPost(input: CreatePostInput): Post {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO posts (content, type, status, confidence_score, reasoning, voice_evaluation, stylometric_signature, langgraph_job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.content,
    input.type,
    input.status ?? 'draft',
    input.confidenceScore ?? 0,
    JSON.stringify(input.reasoning ?? {}),
    input.voiceEvaluation ? JSON.stringify(input.voiceEvaluation) : null,
    input.stylometricSignature ? JSON.stringify(input.stylometricSignature) : null,
    input.langGraphJobId ?? null
  );

  const post = getPostById(result.lastInsertRowid as number);
  if (!post) {
    throw new Error('Failed to create post');
  }
  return post;
}

export function getPostById(id: number): Post | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM posts WHERE id = ?`);
  const row = stmt.get(id) as PostRow | undefined;
  return row ? rowToPost(row) : null;
}

export function updatePost(id: number, input: UpdatePostInput): Post | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.content !== undefined) {
    setClauses.push('content = ?');
    values.push(input.content);
  }
  if (input.type !== undefined) {
    setClauses.push('type = ?');
    values.push(input.type);
  }
  if (input.status !== undefined) {
    setClauses.push('status = ?');
    values.push(input.status);
  }
  if (input.confidenceScore !== undefined) {
    setClauses.push('confidence_score = ?');
    values.push(input.confidenceScore);
  }
  if (input.reasoning !== undefined) {
    setClauses.push('reasoning = ?');
    values.push(JSON.stringify(input.reasoning));
  }
  if (input.voiceEvaluation !== undefined) {
    setClauses.push('voice_evaluation = ?');
    values.push(input.voiceEvaluation ? JSON.stringify(input.voiceEvaluation) : null);
  }
  if (input.stylometricSignature !== undefined) {
    setClauses.push('stylometric_signature = ?');
    values.push(input.stylometricSignature ? JSON.stringify(input.stylometricSignature) : null);
  }
  if (input.postedAt !== undefined) {
    setClauses.push('posted_at = ?');
    values.push(input.postedAt);
  }
  if (input.rejectionReason !== undefined) {
    setClauses.push('rejection_reason = ?');
    values.push(input.rejectionReason);
  }
  if (input.rejectionComment !== undefined) {
    setClauses.push('rejection_comment = ?');
    values.push(input.rejectionComment);
  }
  if (input.rejectedAt !== undefined) {
    setClauses.push('rejected_at = ?');
    values.push(input.rejectedAt);
  }

  if (setClauses.length === 0) {
    return getPostById(id);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE posts SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getPostById(id) : null;
}

export function deletePost(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM posts WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listPosts(options: ListPostsOptions = {}): Post[] {
  const db = getDb();
  const { status, limit = 50, offset = 0, orderBy = 'created_at', orderDir = 'desc' } = options;

  let query = `SELECT * FROM posts`;
  const params: (string | number)[] = [];

  if (status) {
    query += ` WHERE status = ?`;
    params.push(status);
  }

  const orderColumn = orderBy === 'confidence_score' ? 'confidence_score' : 'created_at';
  query += ` ORDER BY ${orderColumn} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as PostRow[];
  return rows.map(rowToPost);
}

export function countPosts(status?: PostStatus): number {
  const db = getDb();
  let query = `SELECT COUNT(*) as count FROM posts`;
  const params: string[] = [];

  if (status) {
    query += ` WHERE status = ?`;
    params.push(status);
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getPostsByStatus(status: PostStatus, limit = 50): Post[] {
  return listPosts({ status, limit });
}
