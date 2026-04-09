import { NextResponse, NextRequest } from 'next/server';
import { getPatternById, updatePattern, deletePattern } from '@/db/models/patterns';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params;
  const patternId = parseInt(id, 10);

  if (isNaN(patternId)) {
    return NextResponse.json({ error: 'Invalid pattern ID' }, { status: 400 });
  }

  const pattern = getPatternById(patternId);

  if (!pattern) {
    return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
  }

  return NextResponse.json(pattern);
}

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params;
  const patternId = parseInt(id, 10);

  if (isNaN(patternId)) {
    return NextResponse.json({ error: 'Invalid pattern ID' }, { status: 400 });
  }

  const body = (await request.json()) as { description?: string };

  if (!body.description || typeof body.description !== 'string') {
    return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  }

  const updated = updatePattern(patternId, { description: body.description.trim() });

  if (!updated) {
    return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const { id } = await params;
  const patternId = parseInt(id, 10);

  if (isNaN(patternId)) {
    return NextResponse.json({ error: 'Invalid pattern ID' }, { status: 400 });
  }

  const deleted = deletePattern(patternId);

  if (!deleted) {
    return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
