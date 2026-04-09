import { NextRequest, NextResponse } from 'next/server';
import {
  listPatterns,
  countPatterns,
  deletePattern,
  ListPatternsOptions,
} from '@/db/models/patterns';
import { Pattern, PatternType } from '@/types';

interface ListPatternsResponse {
  patterns: Pattern[];
  total: number;
  hasMore: boolean;
}

interface DeleteResponse {
  success: boolean;
  deletedCount: number;
}

interface ErrorResponse {
  error: string;
}

const VALID_PATTERN_TYPES: PatternType[] = ['voice', 'hook', 'topic', 'rejection', 'edit'];
const VALID_ORDER_BY: ListPatternsOptions['orderBy'][] = [
  'created_at',
  'updated_at',
  'evidence_count',
];
const VALID_ORDER_DIR: ListPatternsOptions['orderDir'][] = ['asc', 'desc'];

export function GET(request: NextRequest): NextResponse<ListPatternsResponse | ErrorResponse> {
  try {
    const { searchParams } = new URL(request.url);

    const patternTypeParam = searchParams.get('patternType');
    const patternType =
      patternTypeParam && VALID_PATTERN_TYPES.includes(patternTypeParam as PatternType)
        ? (patternTypeParam as PatternType)
        : undefined;

    const minEvidenceCountParam = searchParams.get('minEvidenceCount');
    const minEvidenceCount =
      minEvidenceCountParam !== null ? Math.max(parseInt(minEvidenceCountParam, 10), 0) : undefined;

    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10), 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

    const orderByParam = searchParams.get('orderBy');
    const orderBy =
      orderByParam && VALID_ORDER_BY.includes(orderByParam as ListPatternsOptions['orderBy'])
        ? (orderByParam as ListPatternsOptions['orderBy'])
        : 'evidence_count';

    const orderDirParam = searchParams.get('orderDir');
    const orderDir =
      orderDirParam && VALID_ORDER_DIR.includes(orderDirParam as ListPatternsOptions['orderDir'])
        ? (orderDirParam as ListPatternsOptions['orderDir'])
        : 'desc';

    const patterns = listPatterns({
      patternType,
      minEvidenceCount,
      limit,
      offset,
      orderBy,
      orderDir,
    });
    const total = countPatterns({ patternType });

    return NextResponse.json({
      patterns,
      total,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

interface DeleteBody {
  ids?: unknown;
}

export async function DELETE(
  request: NextRequest
): Promise<NextResponse<DeleteResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as DeleteBody;

    if (!Array.isArray(body.ids)) {
      return NextResponse.json(
        { error: 'ids is required and must be an array of pattern IDs' },
        { status: 400 }
      );
    }

    if (body.ids.length === 0) {
      return NextResponse.json({ error: 'ids array cannot be empty' }, { status: 400 });
    }

    if (body.ids.length > 100) {
      return NextResponse.json(
        { error: 'Cannot delete more than 100 patterns at once' },
        { status: 400 }
      );
    }

    const isValidId = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id);

    const invalidIds = body.ids.filter((id) => !isValidId(id));
    if (invalidIds.length !== 0) {
      return NextResponse.json({ error: 'All ids must be integers' }, { status: 400 });
    }

    const validIds = body.ids.filter(isValidId);
    let deletedCount = 0;
    for (const id of validIds) {
      if (deletePattern(id)) {
        deletedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      deletedCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
