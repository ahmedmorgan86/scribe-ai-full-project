import { NextRequest, NextResponse } from 'next/server';
import {
  createPost,
  listPosts,
  countPosts,
  CreatePostInput,
  ListPostsOptions,
} from '@/db/models/posts';
import { Post, PostStatus, PostType } from '@/types';

interface ListPostsResponse {
  posts: Post[];
  total: number;
  hasMore: boolean;
}

interface ErrorResponse {
  error: string;
}

const VALID_STATUSES: PostStatus[] = ['draft', 'pending', 'approved', 'rejected', 'posted'];
const VALID_TYPES: PostType[] = ['single', 'thread', 'quote', 'reply'];
const VALID_ORDER_BY: ListPostsOptions['orderBy'][] = ['created_at', 'confidence_score'];
const VALID_ORDER_DIR: ListPostsOptions['orderDir'][] = ['asc', 'desc'];

export function GET(request: NextRequest): NextResponse<ListPostsResponse | ErrorResponse> {
  try {
    const { searchParams } = new URL(request.url);

    const statusParam = searchParams.get('status');
    const status =
      statusParam && VALID_STATUSES.includes(statusParam as PostStatus)
        ? (statusParam as PostStatus)
        : undefined;

    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10), 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

    const orderByParam = searchParams.get('orderBy');
    const orderBy =
      orderByParam && VALID_ORDER_BY.includes(orderByParam as ListPostsOptions['orderBy'])
        ? (orderByParam as ListPostsOptions['orderBy'])
        : 'created_at';

    const orderDirParam = searchParams.get('orderDir');
    const orderDir =
      orderDirParam && VALID_ORDER_DIR.includes(orderDirParam as ListPostsOptions['orderDir'])
        ? (orderDirParam as ListPostsOptions['orderDir'])
        : 'desc';

    const posts = listPosts({ status, limit, offset, orderBy, orderDir });
    const total = countPosts(status);

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

interface CreatePostBody {
  content: string;
  type: PostType;
  status?: PostStatus;
  confidenceScore?: number;
  reasoning?: {
    source?: string;
    whyItWorks?: string;
    voiceMatch?: number;
    timing?: string;
    concerns?: string[];
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<Post | ErrorResponse>> {
  try {
    const body = (await request.json()) as CreatePostBody;

    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json(
        { error: 'content is required and must be a string' },
        { status: 400 }
      );
    }

    if (!body.type || !VALID_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `type is required and must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (body.status && !VALID_STATUSES.includes(body.status)) {
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

    const input: CreatePostInput = {
      content: body.content,
      type: body.type,
      status: body.status,
      confidenceScore: body.confidenceScore,
      reasoning: body.reasoning
        ? {
            source: body.reasoning.source ?? '',
            whyItWorks: body.reasoning.whyItWorks ?? '',
            voiceMatch: body.reasoning.voiceMatch ?? 0,
            timing: body.reasoning.timing ?? '',
            concerns: body.reasoning.concerns ?? [],
          }
        : undefined,
    };

    const post = createPost(input);
    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
