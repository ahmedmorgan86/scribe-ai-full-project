import { NextResponse } from 'next/server';
import { getSchedulerConfig, type SchedulerConfig } from '@/db/models/scheduler-config';
import {
  getRecentSchedulerRuns,
  getSchedulerRunStats,
  type SchedulerRun,
} from '@/db/models/scheduler-runs';
import { getSourceUsageStats } from '@/lib/scheduler/source-selector';
import { countQueue } from '@/db/models/queue';
import { shouldRunNow } from '@/lib/scheduler/worker';

export const dynamic = 'force-dynamic';

interface SchedulerStatusResponse {
  config: SchedulerConfig;
  shouldRunNow: boolean;
  currentQueueSize: number;
  recentRuns: SchedulerRun[];
  stats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    skippedRuns: number;
    totalPostsGenerated: number;
    totalPostsQueued: number;
    avgDurationMs: number;
  };
  sourceUsage: Array<{
    sourceId: number;
    useCount: number;
    lastUsedAt: string | null;
  }>;
}

interface ErrorResponse {
  error: string;
}

export function GET(): NextResponse<SchedulerStatusResponse | ErrorResponse> {
  try {
    const config = getSchedulerConfig();
    const recentRuns = getRecentSchedulerRuns(10);
    const stats = getSchedulerRunStats(7);
    const sourceUsage = getSourceUsageStats();
    const currentQueueSize = countQueue();
    const shouldRun = shouldRunNow();

    return NextResponse.json({
      config,
      shouldRunNow: shouldRun,
      currentQueueSize,
      recentRuns,
      stats,
      sourceUsage,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
