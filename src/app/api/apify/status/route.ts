import { NextResponse } from 'next/server';
import { healthCheck } from '@/lib/apify/client';
import { getSourceStats, type SourceStats } from '@/db/models/sources';
import { countAccounts } from '@/db/models/accounts';
import {
  getApifyWorkerConfig,
  isApifyWorkerRunning,
  isApifyWorkerScraping,
} from '@/workers/apify-worker';

export const dynamic = 'force-dynamic';

interface ApifyStatusResponse {
  connected: boolean;
  configured: boolean;
  worker: {
    running: boolean;
    scraping: boolean;
    config: {
      tier1IntervalMs: number;
      tier2IntervalMs: number;
      maxTweetsPerAccount: number;
      enabled: boolean;
    };
  };
  sources: SourceStats;
  accounts: {
    tier1: number;
    tier2: number;
    total: number;
  };
  limits: {
    dailyBudgetUsd: number;
    monthlyBudgetUsd: number;
  };
}

interface ErrorResponse {
  error: string;
}

export async function GET(): Promise<NextResponse<ApifyStatusResponse | ErrorResponse>> {
  try {
    const hasToken = Boolean(process.env.APIFY_API_TOKEN);

    // Only check connection if token is configured
    let connected = false;
    if (hasToken) {
      try {
        connected = await healthCheck();
      } catch {
        connected = false;
      }
    }

    const sourceStats = getSourceStats();
    const workerConfig = getApifyWorkerConfig();

    const tier1Count = countAccounts(1);
    const tier2Count = countAccounts(2);

    return NextResponse.json({
      connected,
      configured: hasToken,
      worker: {
        running: isApifyWorkerRunning(),
        scraping: isApifyWorkerScraping(),
        config: {
          tier1IntervalMs: workerConfig.tier1IntervalMs,
          tier2IntervalMs: workerConfig.tier2IntervalMs,
          maxTweetsPerAccount: workerConfig.maxTweetsPerAccount,
          enabled: workerConfig.enabled,
        },
      },
      sources: sourceStats,
      accounts: {
        tier1: tier1Count,
        tier2: tier2Count,
        total: tier1Count + tier2Count,
      },
      limits: {
        dailyBudgetUsd: parseFloat(process.env.APIFY_DAILY_BUDGET_USD ?? '5'),
        monthlyBudgetUsd: parseFloat(process.env.APIFY_MONTHLY_BUDGET_USD ?? '50'),
      },
    });
  } catch (error) {
    console.error('[api/apify/status] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
