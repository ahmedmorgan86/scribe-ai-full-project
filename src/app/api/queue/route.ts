import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/connection';
import {
  Post,
  PostReasoning,
  PostType,
  PostStatus,
  StoredVoiceEvaluation,
  StyleSignatureData,
  QueueItem,
} from '@/types';
import { getQueueItemByPostId, createQueueItem, reorderQueue } from '@/db/models/queue';

interface QueuePost extends Post {
  queuePriority: number;
}

interface QueueResponse {
  posts: QueuePost[];
  total: number;
  hasMore: boolean;
}

interface ErrorResponse {
  error: string;
}

interface QueuePostRow {
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
  queue_priority: number;
}

interface CountResult {
  count: number;
}

function rowToQueuePost(row: QueuePostRow): QueuePost {
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
    queuePriority: row.queue_priority,
  };
}

export function GET(request: NextRequest): NextResponse<QueueResponse | ErrorResponse> {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '5', 10), 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

    const postsStmt = db.prepare(`
      SELECT
        p.id,
        p.content,
        p.type,
        p.status,
        p.confidence_score,
        p.reasoning,
        p.voice_evaluation,
        p.stylometric_signature,
        p.created_at,
        p.posted_at,
        p.copied_at,
        p.langgraph_job_id,
        p.rejection_reason,
        p.rejection_comment,
        p.rejected_at,
        COALESCE(q.priority, 0) as queue_priority
      FROM posts p
      LEFT JOIN queue q ON p.id = q.post_id
      WHERE p.status = 'pending'
      ORDER BY COALESCE(q.priority, 0) DESC, p.confidence_score DESC, p.created_at ASC
      LIMIT ? OFFSET ?
    `);

    const rows = postsStmt.all(limit, offset) as QueuePostRow[];
    const posts = rows.map(rowToQueuePost);

    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM posts WHERE status = 'pending'`);
    const countResult = countStmt.get() as CountResult;
    const total = countResult.count;

    return NextResponse.json({
      posts,
      total,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

interface ReorderBody {
  postId: number;
  priority: number;
}

interface ReorderResponse {
  item: QueueItem;
  created: boolean;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ReorderResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as ReorderBody;

    if (typeof body.postId !== 'number' || !Number.isInteger(body.postId)) {
      return NextResponse.json(
        { error: 'postId is required and must be an integer' },
        { status: 400 }
      );
    }

    if (typeof body.priority !== 'number' || !Number.isInteger(body.priority)) {
      return NextResponse.json(
        { error: 'priority is required and must be an integer' },
        { status: 400 }
      );
    }

    const existing = getQueueItemByPostId(body.postId);

    if (existing) {
      const updated = reorderQueue(existing.id, body.priority);
      if (!updated) {
        return NextResponse.json({ error: 'Failed to reorder queue item' }, { status: 500 });
      }
      return NextResponse.json({ item: updated, created: false });
    }

    const created = createQueueItem({ postId: body.postId, priority: body.priority });
    return NextResponse.json({ item: created, created: true }, { status: 201 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
