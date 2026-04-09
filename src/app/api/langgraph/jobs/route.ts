import { NextRequest, NextResponse } from 'next/server';
import { listRecentJobs, type JobInfo } from '@/lib/generation/langgraph-client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:langgraph:jobs');

interface JobListResponse {
  jobs: JobInfo[];
  total: number;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<JobListResponse | { error: string }>> {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);

    const jobs = await listRecentJobs(Math.min(limit, 100));

    return NextResponse.json({
      jobs,
      total: jobs.length,
    });
  } catch (error) {
    logger.error('Failed to list LangGraph jobs', { error });
    return NextResponse.json({ error: 'Failed to list jobs' }, { status: 500 });
  }
}
