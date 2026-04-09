import { NextRequest, NextResponse } from 'next/server';
import { getPostById, updatePost } from '@/db/models/posts';
import { createFeedback } from '@/db/models/feedback';
import { deleteQueueItemByPostId } from '@/db/models/queue';
import { incrementRejectionStat } from '@/db/models/rejection-stats';
import { isValidRejectionReason } from '@/lib/constants/rejection-reasons';
import { Post, FeedbackCategory } from '@/types';

interface ErrorResponse {
  error: string;
}

interface RejectResponse {
  post: Post;
  feedbackId: number;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface RejectBody {
  reason: string; // Required: one of REJECTION_REASONS
  comment?: string; // Optional: additional comment
  category?: FeedbackCategory; // Legacy: maps to feedback category
}

// Map rejection reasons to feedback categories for backward compatibility
const REASON_TO_CATEGORY: Record<string, FeedbackCategory> = {
  wrong_tone: 'tone',
  too_formal: 'tone',
  too_casual: 'tone',
  ai_slop: 'generic',
  off_topic: 'topic',
  too_promotional: 'tone',
  factually_wrong: 'value',
  already_posted: 'generic',
  not_interesting: 'hook',
  too_long: 'generic',
  too_short: 'generic',
  other: 'other',
};

function parseId(idStr: string): number | null {
  const id = parseInt(idStr, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<RejectResponse | ErrorResponse>> {
  try {
    const { id: idStr } = await params;
    const id = parseId(idStr);
    if (id === null) {
      return NextResponse.json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const post = getPostById(id);
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    if (post.status === 'rejected') {
      return NextResponse.json({ error: 'Post is already rejected' }, { status: 400 });
    }

    let body: RejectBody;
    try {
      body = (await request.json()) as RejectBody;
    } catch {
      return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
    }

    if (!body.reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }

    if (!isValidRejectionReason(body.reason)) {
      return NextResponse.json(
        { error: 'Invalid rejection reason. See REJECTION_REASONS for valid values.' },
        { status: 400 }
      );
    }

    if (body.comment !== undefined && typeof body.comment !== 'string') {
      return NextResponse.json({ error: 'comment must be a string' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Update post with rejection info
    const updatedPost = updatePost(id, {
      status: 'rejected',
      rejectionReason: body.reason,
      rejectionComment: body.comment ?? null,
      rejectedAt: now,
    });

    if (!updatedPost) {
      return NextResponse.json({ error: 'Failed to update post status' }, { status: 500 });
    }

    // Determine feedback category from reason
    const category = body.category ?? REASON_TO_CATEGORY[body.reason] ?? 'other';

    // Create feedback for pattern learning
    const feedback = createFeedback({
      postId: id,
      action: 'reject',
      category: category,
      comment: body.comment ?? null,
    });

    // Update rejection stats
    incrementRejectionStat(body.reason);

    // Remove from queue
    deleteQueueItemByPostId(id);

    return NextResponse.json({
      post: updatedPost,
      feedbackId: feedback.id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
