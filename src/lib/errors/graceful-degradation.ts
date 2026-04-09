/**
 * Graceful degradation module for handling API failures.
 *
 * Provides:
 * - Retry with exponential backoff
 * - API health status tracking
 * - Fallback behavior when APIs are unavailable
 * - Circuit breaker pattern to prevent cascading failures
 */

import { createLogger } from '@/lib/logger';
import { BudgetExceededError } from '@/lib/anthropic/cost-tracking';
import { ApifyError } from '@/lib/apify/client';
import { SmaugError } from '@/lib/smaug/client';

const logger = createLogger('graceful-degradation');

export type ApiName = 'anthropic' | 'apify' | 'smaug' | 'qdrant';

export type ApiHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ApiHealth {
  name: ApiName;
  status: ApiHealthStatus;
  lastCheck: string;
  lastSuccess?: string;
  lastFailure?: string;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastError?: string;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: (error: unknown) => boolean;
}

export interface DegradedResult<T> {
  success: boolean;
  data?: T;
  usedFallback: boolean;
  fallbackReason?: string;
  error?: string;
  retryCount: number;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'retryableErrors'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RECOVERY_MS = 60000;

const apiHealthState: Map<ApiName, ApiHealth> = new Map();

function getDefaultHealth(name: ApiName): ApiHealth {
  return {
    name,
    status: 'healthy',
    lastCheck: new Date().toISOString(),
    consecutiveFailures: 0,
    totalFailures: 0,
    totalSuccesses: 0,
  };
}

export function getApiHealth(name: ApiName): ApiHealth {
  const existing = apiHealthState.get(name);
  if (!existing) {
    const defaultHealth = getDefaultHealth(name);
    apiHealthState.set(name, defaultHealth);
    return { ...defaultHealth };
  }
  return { ...existing };
}

export function getAllApiHealth(): ApiHealth[] {
  const apis: ApiName[] = ['anthropic', 'apify', 'smaug', 'qdrant'];
  return apis.map((name) => getApiHealth(name));
}

export function resetApiHealth(name?: ApiName): void {
  if (name) {
    apiHealthState.set(name, getDefaultHealth(name));
  } else {
    apiHealthState.clear();
  }
}

function updateHealthOnSuccess(name: ApiName): void {
  const current = getApiHealth(name);
  const now = new Date().toISOString();

  apiHealthState.set(name, {
    ...current,
    status: 'healthy',
    lastCheck: now,
    lastSuccess: now,
    consecutiveFailures: 0,
    totalSuccesses: current.totalSuccesses + 1,
    lastError: undefined,
  });
}

function updateHealthOnFailure(name: ApiName, error: string): void {
  const current = getApiHealth(name);
  const now = new Date().toISOString();
  const consecutiveFailures = current.consecutiveFailures + 1;

  let status: ApiHealthStatus = 'healthy';
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    status = 'unavailable';
  } else if (consecutiveFailures >= 2) {
    status = 'degraded';
  }

  apiHealthState.set(name, {
    ...current,
    status,
    lastCheck: now,
    lastFailure: now,
    consecutiveFailures,
    totalFailures: current.totalFailures + 1,
    lastError: error,
  });
}

export function isApiAvailable(name: ApiName): boolean {
  const health = getApiHealth(name);

  if (health.status !== 'unavailable') {
    return true;
  }

  if (health.lastFailure) {
    const timeSinceFailure = Date.now() - new Date(health.lastFailure).getTime();
    if (timeSinceFailure >= CIRCUIT_BREAKER_RECOVERY_MS) {
      logger.info('Circuit breaker recovery: allowing retry', { api: name });
      return true;
    }
  }

  return false;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof BudgetExceededError) {
    return false;
  }

  if (error instanceof ApifyError) {
    const retryableCodes = [429, 500, 502, 503, 504, 408];
    return retryableCodes.includes(error.statusCode);
  }

  if (error instanceof SmaugError) {
    const retryableCodes = [429, 500, 502, 503, 504, 408];
    return retryableCodes.includes(error.statusCode);
  }

  if (error instanceof Error) {
    const retryableMessages = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ENETUNREACH',
      'fetch failed',
      'network error',
      'socket hang up',
      'rate limit',
      'overloaded',
    ];
    return retryableMessages.some((msg) => error.message.toLowerCase().includes(msg.toLowerCase()));
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, 'retryableErrors'>>
): number {
  const delay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  const jitter = Math.random() * 0.2 * delay;
  return Math.min(delay + jitter, options.maxDelayMs);
}

export async function withRetry<T>(
  apiName: ApiName,
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const shouldRetry = options.retryableErrors ?? isRetryableError;

  let lastError: unknown;
  let attempt = 0;

  while (attempt <= opts.maxRetries) {
    if (attempt > 0 && !isApiAvailable(apiName)) {
      throw new Error(`API ${apiName} is unavailable (circuit breaker open)`);
    }

    try {
      const result = await operation();
      updateHealthOnSuccess(apiName);
      return result;
    } catch (error) {
      lastError = error;
      attempt++;

      const errorMessage = error instanceof Error ? error.message : String(error);
      updateHealthOnFailure(apiName, errorMessage);

      if (attempt > opts.maxRetries) {
        logger.error('Max retries exceeded', error, {
          api: apiName,
          attempts: attempt,
        });
        throw error;
      }

      if (!shouldRetry(error)) {
        logger.warn('Non-retryable error', {
          api: apiName,
          error: errorMessage,
        });
        throw error;
      }

      const delay = calculateDelay(attempt, opts);
      logger.info('Retrying after failure', {
        api: apiName,
        attempt,
        maxRetries: opts.maxRetries,
        delayMs: Math.round(delay),
        error: errorMessage,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

export async function withFallback<T>(
  apiName: ApiName,
  operation: () => Promise<T>,
  fallback: () => T | Promise<T>,
  options: RetryOptions = {}
): Promise<DegradedResult<T>> {
  let retryCount = 0;

  try {
    const data = await withRetry(
      apiName,
      async () => {
        retryCount++;
        return operation();
      },
      options
    );

    return {
      success: true,
      data,
      usedFallback: false,
      retryCount: Math.max(0, retryCount - 1),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.warn('Using fallback due to API failure', {
      api: apiName,
      error: errorMessage,
    });

    try {
      const fallbackData = await fallback();
      return {
        success: true,
        data: fallbackData,
        usedFallback: true,
        fallbackReason: errorMessage,
        retryCount: Math.max(0, retryCount - 1),
      };
    } catch (fallbackError) {
      const fallbackErrorMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return {
        success: false,
        usedFallback: true,
        fallbackReason: errorMessage,
        error: fallbackErrorMessage,
        retryCount: Math.max(0, retryCount - 1),
      };
    }
  }
}

export async function withGracefulDegradation<T>(
  apiName: ApiName,
  operation: () => Promise<T>,
  options: {
    fallback?: () => T | Promise<T>;
    onDegraded?: (health: ApiHealth) => void;
    retryOptions?: RetryOptions;
  } = {}
): Promise<DegradedResult<T>> {
  const health = getApiHealth(apiName);

  if (health.status === 'degraded' && options.onDegraded) {
    options.onDegraded(health);
  }

  if (!isApiAvailable(apiName)) {
    logger.warn('API unavailable, using fallback immediately', {
      api: apiName,
      consecutiveFailures: health.consecutiveFailures,
    });

    if (options.fallback) {
      try {
        const fallbackData = await options.fallback();
        return {
          success: true,
          data: fallbackData,
          usedFallback: true,
          fallbackReason: 'API unavailable (circuit breaker)',
          retryCount: 0,
        };
      } catch (fallbackError) {
        const errorMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return {
          success: false,
          usedFallback: true,
          fallbackReason: 'API unavailable (circuit breaker)',
          error: errorMessage,
          retryCount: 0,
        };
      }
    }

    return {
      success: false,
      usedFallback: false,
      error: `API ${apiName} is unavailable`,
      retryCount: 0,
    };
  }

  if (options.fallback) {
    return withFallback(apiName, operation, options.fallback, options.retryOptions);
  }

  let retryCount = 0;
  try {
    const data = await withRetry(
      apiName,
      async () => {
        retryCount++;
        return operation();
      },
      options.retryOptions
    );

    return {
      success: true,
      data,
      usedFallback: false,
      retryCount: Math.max(0, retryCount - 1),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      usedFallback: false,
      error: errorMessage,
      retryCount: Math.max(0, retryCount - 1),
    };
  }
}

export function categorizeError(error: unknown): {
  category: 'budget' | 'rate_limit' | 'network' | 'auth' | 'server' | 'client' | 'unknown';
  retryable: boolean;
  message: string;
} {
  if (error instanceof BudgetExceededError) {
    return {
      category: 'budget',
      retryable: false,
      message: error.message,
    };
  }

  const errorMessage =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const statusCode = getErrorStatusCode(error);

  if (
    statusCode === 429 ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests')
  ) {
    return {
      category: 'rate_limit',
      retryable: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('forbidden')
  ) {
    return {
      category: 'auth',
      retryable: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const networkPatterns = [
    'econnrefused',
    'etimedout',
    'enotfound',
    'enetunreach',
    'fetch failed',
    'network',
  ];
  if (networkPatterns.some((p) => errorMessage.includes(p))) {
    return {
      category: 'network',
      retryable: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (statusCode !== undefined && statusCode >= 500) {
    return {
      category: 'server',
      retryable: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return {
      category: 'client',
      retryable: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    category: 'unknown',
    retryable: false,
    message: error instanceof Error ? error.message : String(error),
  };
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (error instanceof ApifyError || error instanceof SmaugError) {
    return error.statusCode;
  }
  return undefined;
}

export function formatApiHealthStatus(health: ApiHealth): string {
  const lines: string[] = [];
  lines.push(`${health.name.toUpperCase()}: ${health.status.toUpperCase()}`);
  lines.push(`  Last check: ${health.lastCheck}`);

  if (health.lastSuccess) {
    lines.push(`  Last success: ${health.lastSuccess}`);
  }

  if (health.lastFailure) {
    lines.push(`  Last failure: ${health.lastFailure}`);
  }

  lines.push(`  Consecutive failures: ${health.consecutiveFailures}`);
  lines.push(`  Total: ${health.totalSuccesses} successes, ${health.totalFailures} failures`);

  if (health.lastError) {
    lines.push(`  Last error: ${health.lastError}`);
  }

  return lines.join('\n');
}

export function formatAllApiHealth(): string {
  const healthStatuses = getAllApiHealth();
  return healthStatuses.map(formatApiHealthStatus).join('\n\n');
}
