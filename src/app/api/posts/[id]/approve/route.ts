import { NextRequest, NextResponse } from 'next/server';
import { getPostById, updatePost } from '@/db/models/posts';
import { createFeedback } from '@/db/models/feedback';
import { deleteQueueItemByPostId } from '@/db/models/queue';
import { addDocument } from '@/db/qdrant/embeddings';
import { QDRANT_COLLECTION_NAMES } from '@/db/qdrant/connection';
import { generateEmbedding } from '@/lib/embeddings/service';
import { textToSparseVector } from '@/db/qdrant/sparse-vectors';
import { createLogger } from '@/lib/logger';
import { Post } from '@/types';

const logger = createLogger('api:posts:approve');

interface ErrorResponse {
  error: string;
}

interface ApproveResponse {
  post: Post;
  feedbackId: number;
  addedToVoiceCorpus: boolean;
  addedToQdrant?: boolean;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ApproveBody {
  isExceptional?: boolean;
  comment?: string;
  voiceScore?: number;
}

function parseId(idStr: string): number | null {
  const id = parseInt(idStr, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApproveResponse | ErrorResponse>> {
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

    if (post.status === 'approved') {
      return NextResponse.json({ error: 'Post is already approved' }, { status: 400 });
    }

    let body: ApproveBody = {};
    try {
      body = (await request.json()) as ApproveBody;
    } catch {
      // Empty body is valid
    }

    if (body.voiceScore !== undefined) {
      const isInvalid =
        typeof body.voiceScore !== 'number' || body.voiceScore < 0 || body.voiceScore > 100;
      if (isInvalid) {
        return NextResponse.json(
          { error: 'voiceScore must be a number between 0 and 100' },
          { status: 400 }
        );
      }
    }

    const updatedPost = updatePost(id, { status: 'approved' });
    if (!updatedPost) {
      return NextResponse.json({ error: 'Failed to update post status' }, { status: 500 });
    }

    const commentParts: string[] = [];
    if (body.isExceptional === true) {
      commentParts.push('[EXCEPTIONAL]');
    }
    if (body.comment !== undefined && body.comment !== null && body.comment !== '') {
      commentParts.push(body.comment);
    }

    const feedback = createFeedback({
      postId: id,
      action: 'approve',
      comment: commentParts.length > 0 ? commentParts.join(' ') : null,
    });

    deleteQueueItemByPostId(id);

    let addedToVoiceCorpus = false;
    try {
      const embeddingResult = await generateEmbedding(updatedPost.content);
      const sparseVector = textToSparseVector(updatedPost.content);
      const approvedAt = new Date().toISOString();
      const voiceScore = body.voiceScore ?? updatedPost.voiceEvaluation?.score?.overall;

      await addDocument(
        QDRANT_COLLECTION_NAMES.APPROVED_POSTS,
        `post-${id}`,
        updatedPost.content,
        embeddingResult.embedding,
        {
          post_id: id,
          created_at: approvedAt,
          voice_score: voiceScore ?? null,
          content_type: updatedPost.type ?? 'tweet',
          is_exceptional: body.isExceptional ?? false,
        },
        sparseVector
      );
      addedToVoiceCorpus = true;
      logger.info(`Added approved post ${id} to Qdrant voice corpus`);
    } catch (qdrantError) {
      const errorMsg = qdrantError instanceof Error ? qdrantError.message : 'Unknown error';
      logger.warn(`Failed to add post ${id} to Qdrant: ${errorMsg}`);
    }

    return NextResponse.json({
      post: updatedPost,
      feedbackId: feedback.id,
      addedToVoiceCorpus,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
