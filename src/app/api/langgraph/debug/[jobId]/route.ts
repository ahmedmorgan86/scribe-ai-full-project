import { NextRequest, NextResponse } from 'next/server';
import { getDebugTrace, type DebugTraceResponse } from '@/lib/generation/langgraph-client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:langgraph:debug');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse<DebugTraceResponse | { error: string }>> {
  try {
    const { jobId } = await params;

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const trace = await getDebugTrace(jobId);
    return NextResponse.json(trace);
  } catch (error) {
    logger.error('Failed to get LangGraph debug trace', { error });
    return NextResponse.json({ error: 'Failed to get debug trace' }, { status: 500 });
  }
}
