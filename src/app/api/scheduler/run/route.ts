import { NextResponse } from 'next/server';
import { runScheduler, type SchedulerRunResult } from '@/lib/scheduler/worker';

export const dynamic = 'force-dynamic';

interface ErrorResponse {
  error: string;
}

export async function POST(): Promise<NextResponse<SchedulerRunResult | ErrorResponse>> {
  try {
    const result = await runScheduler();
    return NextResponse.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
