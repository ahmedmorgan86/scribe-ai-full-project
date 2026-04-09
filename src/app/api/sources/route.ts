import { NextRequest, NextResponse } from 'next/server';
import {
  listSources,
  getUnusedSources,
  getSourceStats,
  getSourcesByAccount,
  createSource,
  type SourceStats,
  type ExtendedSource,
} from '@/db/models/sources';
import type { Source, SourceType } from '@/types';

export const dynamic = 'force-dynamic';

interface SourceResponse {
  id: number;
  sourceType: string;
  sourceId: string;
  content?: string;
  used?: boolean;
  usedAt?: string | null;
  qualityScore?: number | null;
  scrapedAt?: string;
}

interface SourcesGetResponse {
  sources: SourceResponse[];
  stats?: SourceStats;
}

interface ErrorResponse {
  error: string;
}

export function GET(
  request: NextRequest
): NextResponse<SourcesGetResponse | SourceStats | ErrorResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const handle = searchParams.get('handle');
    const unused = searchParams.get('unused') === 'true';
    const statsOnly = searchParams.get('stats') === 'true';
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const includeContent = searchParams.get('includeContent') === 'true';

    // Return only stats
    if (statsOnly) {
      const stats = getSourceStats();
      return NextResponse.json(stats);
    }

    // Get sources by account handle
    if (handle) {
      const sources = getSourcesByAccount(handle);
      return NextResponse.json({
        sources: sources.map((s) => formatSource(s, includeContent)),
      });
    }

    // Get unused sources only
    if (unused) {
      const sources = getUnusedSources(limit);
      return NextResponse.json({
        sources: sources.map((s) => formatSource(s, includeContent)),
      });
    }

    // Default: return sources with optional stats
    const sources = listSources({ limit });
    const stats = getSourceStats();

    return NextResponse.json({
      sources: sources.map((s) => formatSourceBasic(s)),
      stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch sources';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatSourceBasic(s: Source): SourceResponse {
  return {
    id: s.id,
    sourceType: s.sourceType,
    sourceId: s.sourceId,
    scrapedAt: s.scrapedAt,
  };
}

function formatSource(s: ExtendedSource, includeContent: boolean): SourceResponse {
  return {
    id: s.id,
    sourceType: s.sourceType,
    sourceId: s.sourceId,
    content: includeContent ? s.content : undefined,
    used: s.used,
    usedAt: s.usedAt,
    qualityScore: s.qualityScore,
    scrapedAt: s.scrapedAt,
  };
}

interface CreateSourceBody {
  type?: SourceType;
  sourceId?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface CreateSourceResponse {
  success: boolean;
  source: Source;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<CreateSourceResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as CreateSourceBody;

    if (!body.content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const source = createSource({
      sourceType: body.type ?? 'bookmark',
      sourceId: body.sourceId ?? `manual-${Date.now()}`,
      content: body.content,
      metadata: body.metadata,
    });

    return NextResponse.json({ success: true, source });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create source';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
