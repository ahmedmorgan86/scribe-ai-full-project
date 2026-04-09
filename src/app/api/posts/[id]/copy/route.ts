import { NextRequest, NextResponse } from 'next/server';
import { getPostById } from '@/db/models/posts';
import { recordCopy, getCopiedAt } from '@/lib/copy/clipboard';

interface ErrorResponse {
  error: string;
}

interface CopyResponse {
  postId: number;
  copiedAt: string | null;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseId(idStr: string): number | null {
  const id = parseInt(idStr, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

export async function POST(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<CopyResponse | ErrorResponse>> {
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

    recordCopy(id);
    const copiedAt = getCopiedAt(id);

    return NextResponse.json({ postId: id, copiedAt });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
