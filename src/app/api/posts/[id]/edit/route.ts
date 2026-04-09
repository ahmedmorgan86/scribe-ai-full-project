import { NextRequest, NextResponse } from 'next/server';
import { getPostById, updatePost } from '@/db/models/posts';
import { createFeedback } from '@/db/models/feedback';
import { Post } from '@/types';

interface ErrorResponse {
  error: string;
}

interface EditResponse {
  post: Post;
  feedbackId: number;
  diffCaptured: boolean;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface EditBody {
  content: string;
  comment?: string;
}

function parseId(idStr: string): number | null {
  const id = parseInt(idStr, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<EditResponse | ErrorResponse>> {
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

    let body: EditBody;
    try {
      body = (await request.json()) as EditBody;
    } catch {
      return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
    }

    if (body.content === undefined || body.content === null) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }

    if (body.content.trim() === '') {
      return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 });
    }

    if (body.comment !== undefined && typeof body.comment !== 'string') {
      return NextResponse.json({ error: 'comment must be a string' }, { status: 400 });
    }

    const originalContent = post.content;
    const newContent = body.content;

    const contentChanged = originalContent !== newContent;

    const updatedPost = updatePost(id, { content: newContent });
    if (!updatedPost) {
      return NextResponse.json({ error: 'Failed to update post content' }, { status: 500 });
    }

    const feedback = createFeedback({
      postId: id,
      action: 'edit',
      comment: body.comment ?? null,
      diffBefore: contentChanged ? originalContent : null,
      diffAfter: contentChanged ? newContent : null,
    });

    return NextResponse.json({
      post: updatedPost,
      feedbackId: feedback.id,
      diffCaptured: contentChanged,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
