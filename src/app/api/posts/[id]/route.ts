import { NextRequest, NextResponse } from 'next/server';
import { getPostById, updatePost, deletePost, UpdatePostInput } from '@/db/models/posts';
import { Post, PostStatus, PostType } from '@/types';

interface ErrorResponse {
  error: string;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

const VALID_STATUSES: PostStatus[] = ['draft', 'pending', 'approved', 'rejected', 'posted'];
const VALID_TYPES: PostType[] = ['single', 'thread', 'quote', 'reply'];

function parseId(idStr: string): number | null {
  const id = parseInt(idStr, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<Post | ErrorResponse>> {
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

    return NextResponse.json(post);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

interface UpdatePostBody {
  content?: string;
  type?: PostType;
  status?: PostStatus;
  confidenceScore?: number;
  reasoning?: {
    source?: string;
    whyItWorks?: string;
    voiceMatch?: number;
    timing?: string;
    concerns?: string[];
  };
  postedAt?: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<Post | ErrorResponse>> {
  try {
    const { id: idStr } = await params;
    const id = parseId(idStr);
    if (id === null) {
      return NextResponse.json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const existingPost = getPostById(id);
    if (!existingPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const body = (await request.json()) as UpdatePostBody;

    if (body.content !== undefined && typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }

    if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    if (body.confidenceScore !== undefined) {
      const isInvalid =
        typeof body.confidenceScore !== 'number' ||
        body.confidenceScore < 0 ||
        body.confidenceScore > 100;
      if (isInvalid) {
        return NextResponse.json(
          { error: 'confidenceScore must be a number between 0 and 100' },
          { status: 400 }
        );
      }
    }

    const input: UpdatePostInput = {};

    if (body.content !== undefined) {
      input.content = body.content;
    }
    if (body.type !== undefined) {
      input.type = body.type;
    }
    if (body.status !== undefined) {
      input.status = body.status;
    }
    if (body.confidenceScore !== undefined) {
      input.confidenceScore = body.confidenceScore;
    }
    if (body.reasoning !== undefined) {
      input.reasoning = {
        source: body.reasoning.source ?? '',
        whyItWorks: body.reasoning.whyItWorks ?? '',
        voiceMatch: body.reasoning.voiceMatch ?? 0,
        timing: body.reasoning.timing ?? '',
        concerns: body.reasoning.concerns ?? [],
      };
    }
    if (body.postedAt !== undefined) {
      input.postedAt = body.postedAt;
    }

    const updatedPost = updatePost(id, input);
    if (!updatedPost) {
      return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
    }

    return NextResponse.json(updatedPost);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<{ success: boolean } | ErrorResponse>> {
  try {
    const { id: idStr } = await params;
    const id = parseId(idStr);
    if (id === null) {
      return NextResponse.json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const existingPost = getPostById(id);
    if (!existingPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const deleted = deletePost(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
