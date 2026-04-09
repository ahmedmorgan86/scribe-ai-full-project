/**
 * Retry Logic with Exponential Backoff and Jitter
 *
 * Provides configurable retry behavior for transient failures.
 * Uses exponential backoff with decorrelated jitter to prevent thundering herd.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('retry');

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.5,
};

export function calculateBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = cappedDelay * config.jitterFactor * Math.random();
  return Math.floor(cappedDelay + jitter);
}

export function calculateDecorrelatedJitter(
  previousDelay: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const minDelay = config.baseDelayMs;
  const maxDelay = Math.min(previousDelay * 3, config.maxDelayMs);
  return Math.floor(minDelay + Math.random() * (maxDelay - minDelay));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
  attemptErrors: Array<{ attempt: number; error: string; delayMs: number }>;
}

export type RetryableCheck = (error: unknown) => boolean;

const defaultRetryableCheck: RetryableCheck = (error: unknown): boolean => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('rate limit') || message.includes('429')) return true;
    if (message.includes('timeout') || message.includes('timed out')) return true;
    if (message.includes('network') || message.includes('econnrefused')) return true;
    if (message.includes('503') || message.includes('502') || message.includes('500')) return true;
    if (message.includes('temporarily unavailable')) return true;
  }
  return false;
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  isRetryable: RetryableCheck = defaultRetryableCheck
): Promise<RetryResult<T>> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const attemptErrors: Array<{ attempt: number; error: string; delayMs: number }> = [];
  let totalDelayMs = 0;
  let lastDelay = fullConfig.baseDelayMs;

  for (let attempt = 0; attempt < fullConfig.maxAttempts; attempt++) {
    try {
      const result = await operation();
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalDelayMs,
        attemptErrors,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isLast = attempt === fullConfig.maxAttempts - 1;

      if (isLast || !isRetryable(error)) {
        attemptErrors.push({ attempt: attempt + 1, error: errorMsg, delayMs: 0 });

        if (!isRetryable(error) && !isLast) {
          logger.debug(`Attempt ${attempt + 1} failed with non-retryable error: ${errorMsg}`);
        }

        return {
          success: false,
          error: error instanceof Error ? error : new Error(errorMsg),
          attempts: attempt + 1,
          totalDelayMs,
          attemptErrors,
        };
      }

      const delayMs = calculateDecorrelatedJitter(lastDelay, fullConfig);
      lastDelay = delayMs;
      totalDelayMs += delayMs;

      attemptErrors.push({ attempt: attempt + 1, error: errorMsg, delayMs });
      logger.debug(
        `Attempt ${attempt + 1}/${fullConfig.maxAttempts} failed: ${errorMsg}. Retrying in ${delayMs}ms...`
      );

      await sleep(delayMs);
    }
  }

  return {
    success: false,
    error: new Error('Max retries exceeded'),
    attempts: fullConfig.maxAttempts,
    totalDelayMs,
    attemptErrors,
  };
}

export async function retryWithResult<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  isRetryable: RetryableCheck = defaultRetryableCheck
): Promise<T> {
  const result = await withRetry(operation, config, isRetryable);
  if (result.success && result.result !== undefined) {
    return result.result;
  }
  throw result.error ?? new Error('Operation failed after retries');
}

export function createRetryableOperation<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  isRetryable: RetryableCheck = defaultRetryableCheck
): () => Promise<T> {
  return () => retryWithResult(operation, config, isRetryable);
}

export { DEFAULT_RETRY_CONFIG };
