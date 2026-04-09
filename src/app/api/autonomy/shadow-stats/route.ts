import { NextRequest, NextResponse } from 'next/server';
import { getShadowStats, AiDecision } from '@/lib/autonomy/shadow-evaluator';

interface ShadowStatsResponse {
  total: number;
  byDecision: Record<AiDecision, number>;
  avgConfidence: number;
  agreementRate: number | null;
  agreementRateFormatted: string;
}

interface ErrorResponse {
  error: string;
}

export function GET(request: NextRequest): NextResponse<ShadowStatsResponse | ErrorResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get('since');
    const since = sinceParam ? new Date(sinceParam) : undefined;

    if (since !== undefined && isNaN(since.getTime())) {
      return NextResponse.json({ error: 'Invalid since date format' }, { status: 400 });
    }

    const stats = getShadowStats(since);

    return NextResponse.json({
      total: stats.total,
      byDecision: stats.byDecision,
      avgConfidence: stats.avgConfidence,
      agreementRate: stats.agreementRate,
      agreementRateFormatted:
        stats.agreementRate !== null
          ? `${(stats.agreementRate * 100).toFixed(1)}%`
          : 'No comparable decisions yet',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
