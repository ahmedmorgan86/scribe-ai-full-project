import { NextResponse } from 'next/server';
import { getAllApiHealth, type ApiHealth, type ApiName } from '@/lib/errors/graceful-degradation';

export interface ErrorSummaryResponse {
  apiHealth: ApiHealth[];
  recentErrors: RecentError[];
  errorCounts: ErrorCounts;
  timestamp: string;
}

export interface RecentError {
  id: string;
  source: ApiName | 'system';
  message: string;
  timestamp: string;
  category: 'budget' | 'rate_limit' | 'network' | 'auth' | 'server' | 'client' | 'unknown';
  retryable: boolean;
}

export interface ErrorCounts {
  last1h: number;
  last24h: number;
  last7d: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
}

function aggregateRecentErrors(apiHealthList: ApiHealth[]): RecentError[] {
  const errors: RecentError[] = [];

  for (const health of apiHealthList) {
    if (health.lastError && health.lastFailure) {
      errors.push({
        id: `${health.name}-${health.lastFailure}`,
        source: health.name,
        message: health.lastError,
        timestamp: health.lastFailure,
        category: categorizeErrorMessage(health.lastError),
        retryable: isRetryableCategory(categorizeErrorMessage(health.lastError)),
      });
    }
  }

  return errors.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function categorizeErrorMessage(
  message: string
): 'budget' | 'rate_limit' | 'network' | 'auth' | 'server' | 'client' | 'unknown' {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('budget')) {
    return 'budget';
  }
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests')) {
    return 'rate_limit';
  }
  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('fetch failed')
  ) {
    return 'network';
  }
  if (
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('403')
  ) {
    return 'auth';
  }
  if (lowerMessage.includes('500') || lowerMessage.includes('server error')) {
    return 'server';
  }
  if (lowerMessage.includes('400') || lowerMessage.includes('bad request')) {
    return 'client';
  }

  return 'unknown';
}

function isRetryableCategory(
  category: 'budget' | 'rate_limit' | 'network' | 'auth' | 'server' | 'client' | 'unknown'
): boolean {
  return ['rate_limit', 'network', 'server'].includes(category);
}

function calculateErrorCounts(apiHealthList: ApiHealth[]): ErrorCounts {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  let last1h = 0;
  let last24h = 0;
  let last7d = 0;
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const health of apiHealthList) {
    bySource[health.name] = health.totalFailures;

    if (health.lastFailure) {
      const failureTime = new Date(health.lastFailure).getTime();

      if (failureTime >= oneHourAgo) {
        last1h += health.consecutiveFailures;
      }
      if (failureTime >= oneDayAgo) {
        last24h += health.consecutiveFailures;
      }
      if (failureTime >= oneWeekAgo) {
        last7d += health.totalFailures;
      }

      if (health.lastError) {
        const category = categorizeErrorMessage(health.lastError);
        byCategory[category] = (byCategory[category] ?? 0) + health.consecutiveFailures;
      }
    }
  }

  return {
    last1h,
    last24h,
    last7d,
    bySource,
    byCategory,
  };
}

export function GET(): NextResponse<ErrorSummaryResponse> {
  try {
    const apiHealthList = getAllApiHealth();
    const recentErrors = aggregateRecentErrors(apiHealthList);
    const errorCounts = calculateErrorCounts(apiHealthList);

    const response: ErrorSummaryResponse = {
      apiHealth: apiHealthList,
      recentErrors,
      errorCounts,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        apiHealth: [],
        recentErrors: [
          {
            id: 'api-error',
            source: 'system' as const,
            message: errorMessage,
            timestamp: new Date().toISOString(),
            category: 'unknown' as const,
            retryable: false,
          },
        ],
        errorCounts: {
          last1h: 1,
          last24h: 1,
          last7d: 1,
          bySource: { system: 1 },
          byCategory: { unknown: 1 },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
