import { NextRequest, NextResponse } from 'next/server';
import { listFeedback, countFeedback, ListFeedbackOptions } from '@/db/models/feedback';
import { Feedback, FeedbackAction, FeedbackCategory } from '@/types';

interface ListFeedbackResponse {
  feedback: Feedback[];
  total: number;
  hasMore: boolean;
}

interface ErrorResponse {
  error: string;
}

const VALID_ACTIONS: FeedbackAction[] = ['approve', 'reject', 'edit'];
const VALID_CATEGORIES: FeedbackCategory[] = [
  'generic',
  'tone',
  'hook',
  'value',
  'topic',
  'timing',
  'other',
];
const VALID_ORDER_DIR: ListFeedbackOptions['orderDir'][] = ['asc', 'desc'];

export function GET(request: NextRequest): NextResponse<ListFeedbackResponse | ErrorResponse> {
  try {
    const { searchParams } = new URL(request.url);

    const postIdParam = searchParams.get('postId');
    let postId: number | undefined;
    if (postIdParam) {
      const parsed = parseInt(postIdParam, 10);
      if (isNaN(parsed) || parsed < 1) {
        return NextResponse.json({ error: 'postId must be a positive integer' }, { status: 400 });
      }
      postId = parsed;
    }

    const actionParam = searchParams.get('action');
    const action =
      actionParam && VALID_ACTIONS.includes(actionParam as FeedbackAction)
        ? (actionParam as FeedbackAction)
        : undefined;

    const categoryParam = searchParams.get('category');
    const category =
      categoryParam && VALID_CATEGORIES.includes(categoryParam as FeedbackCategory)
        ? (categoryParam as FeedbackCategory)
        : undefined;

    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10), 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

    const orderDirParam = searchParams.get('orderDir');
    const orderDir =
      orderDirParam && VALID_ORDER_DIR.includes(orderDirParam as ListFeedbackOptions['orderDir'])
        ? (orderDirParam as ListFeedbackOptions['orderDir'])
        : 'desc';

    const feedback = listFeedback({ postId, action, category, limit, offset, orderDir });
    const total = countFeedback({ postId, action });

    return NextResponse.json({
      feedback,
      total,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
