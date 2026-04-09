import { NextRequest, NextResponse } from 'next/server';
import { ApiName } from '@/types';
import { getCostTracker, BudgetWarning } from './tracker';
import { BudgetStatus } from '@/db/models/costs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('costs:middleware');

export interface BudgetCheckOptions {
  apiName: ApiName;
  estimatedCost?: number;
  blockOnExceeded?: boolean;
}

export interface BudgetCheckResult {
  allowed: boolean;
  exceeded: boolean;
  warnings: BudgetWarning[];
  statuses: BudgetStatus[];
  message?: string;
}

export interface BudgetExceededResponse {
  error: string;
  code: 'BUDGET_EXCEEDED';
  details: {
    apiName: ApiName;
    exceededBudgets: Array<{
      period: 'daily' | 'monthly';
      used: number;
      limit: number;
      remaining: number;
    }>;
  };
}

function buildBudgetExceededResponse(
  apiName: ApiName,
  statuses: BudgetStatus[]
): BudgetExceededResponse {
  const exceededBudgets = statuses
    .filter((s) => s.exceeded)
    .map((s) => ({
      period: s.period,
      used: s.used,
      limit: s.limit,
      remaining: s.remaining,
    }));

  return {
    error: `Budget exceeded for ${apiName}. Operations halted until budget resets.`,
    code: 'BUDGET_EXCEEDED',
    details: {
      apiName,
      exceededBudgets,
    },
  };
}

export function checkBudget(options: BudgetCheckOptions): BudgetCheckResult {
  const { apiName, estimatedCost = 0, blockOnExceeded = true } = options;
  const tracker = getCostTracker();

  const statuses = tracker.checkBudgetBeforeOperation(apiName, estimatedCost);
  const exceeded = statuses.some((s) => s.exceeded);
  const warnings = tracker.checkBudgetWarnings(apiName);

  if (exceeded) {
    logger.warn('Budget exceeded check failed', {
      apiName,
      estimatedCost,
      statuses: statuses.filter((s) => s.exceeded),
    });
  }

  if (warnings.length > 0) {
    logger.info('Budget warnings active', { apiName, warningCount: warnings.length });
  }

  return {
    allowed: !exceeded || !blockOnExceeded,
    exceeded,
    warnings,
    statuses,
    message: exceeded
      ? `Budget exceeded for ${apiName}. ${statuses.find((s) => s.exceeded)?.period} limit reached.`
      : undefined,
  };
}

export function withBudgetCheck<T extends Record<string, unknown>>(
  options: BudgetCheckOptions,
  handler: () => Promise<NextResponse<T>>
): Promise<NextResponse<T | BudgetExceededResponse>> {
  const checkResult = checkBudget(options);

  if (!checkResult.allowed) {
    return Promise.resolve(
      NextResponse.json(buildBudgetExceededResponse(options.apiName, checkResult.statuses), {
        status: 402,
      })
    );
  }

  return handler() as Promise<NextResponse<T | BudgetExceededResponse>>;
}

export type RouteHandler<T> = (
  request: NextRequest,
  context?: { params?: Record<string, string> }
) => Promise<NextResponse<T>>;

export function createBudgetProtectedHandler<T extends Record<string, unknown>>(
  apiName: ApiName,
  handler: RouteHandler<T>,
  options: Partial<Omit<BudgetCheckOptions, 'apiName'>> = {}
): RouteHandler<T | BudgetExceededResponse> {
  return async (request, context) => {
    const checkResult = checkBudget({
      apiName,
      estimatedCost: options.estimatedCost ?? 0,
      blockOnExceeded: options.blockOnExceeded ?? true,
    });

    if (!checkResult.allowed) {
      logger.warn('Request blocked due to budget exceeded', {
        apiName,
        path: request.nextUrl.pathname,
        method: request.method,
      });

      return NextResponse.json(buildBudgetExceededResponse(apiName, checkResult.statuses), {
        status: 402,
      }) as NextResponse<T | BudgetExceededResponse>;
    }

    return handler(request, context) as Promise<NextResponse<T | BudgetExceededResponse>>;
  };
}

export function budgetCheckMiddleware(request: NextRequest, apiName: ApiName): NextResponse | null {
  const checkResult = checkBudget({ apiName, blockOnExceeded: true });

  if (!checkResult.allowed) {
    logger.warn('Middleware blocking request due to budget exceeded', {
      apiName,
      path: request.nextUrl.pathname,
      method: request.method,
    });

    return NextResponse.json(buildBudgetExceededResponse(apiName, checkResult.statuses), {
      status: 402,
    });
  }

  return null;
}

export function getBudgetHeaders(apiName: ApiName): Record<string, string> {
  const tracker = getCostTracker();
  const summary = tracker.getCostSummary(apiName);

  const headers: Record<string, string> = {
    'X-Budget-Api': apiName,
    'X-Budget-Daily-Cost': summary.dailyCost.toFixed(4),
    'X-Budget-Monthly-Cost': summary.monthlyCost.toFixed(4),
  };

  if (summary.dailyLimit !== undefined) {
    headers['X-Budget-Daily-Limit'] = summary.dailyLimit.toFixed(2);
    headers['X-Budget-Daily-Remaining'] = (summary.dailyRemaining ?? 0).toFixed(4);
    headers['X-Budget-Daily-Percent'] = (summary.dailyPercentUsed ?? 0).toFixed(1);
  }

  if (summary.monthlyLimit !== undefined) {
    headers['X-Budget-Monthly-Limit'] = summary.monthlyLimit.toFixed(2);
    headers['X-Budget-Monthly-Remaining'] = (summary.monthlyRemaining ?? 0).toFixed(4);
    headers['X-Budget-Monthly-Percent'] = (summary.monthlyPercentUsed ?? 0).toFixed(1);
  }

  return headers;
}

export function addBudgetHeadersToResponse<T>(
  response: NextResponse<T>,
  apiName: ApiName
): NextResponse<T> {
  const headers = getBudgetHeaders(apiName);

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}
