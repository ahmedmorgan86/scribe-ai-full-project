/**
 * Qdrant Retry Logic
 *
 * Wraps Qdrant operations with retry logic for transient failures.
 * Uses the common retry infrastructure from @/lib/resilience/retry
 */

import { withRetry, RetryConfig, RetryableCheck, RetryResult } from '@/lib/resilience/retry';
import { createLogger } from '@/lib/logger';

const logger = createLogger('qdrant:retry');

const DEFAULT_QDRANT_RETRY_CONFIG: Partial<RetryConfig> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  jitterFactor: 0.3,
};

export function getQdrantRetryConfig(): Partial<RetryConfig> {
  const maxAttempts = parseInt(process.env.QDRANT_RETRY_MAX_ATTEMPTS ?? '', 10);
  const baseDelayMs = parseInt(process.env.QDRANT_RETRY_BASE_DELAY_MS ?? '', 10);
  const maxDelayMs = parseInt(process.env.QDRANT_RETRY_MAX_DELAY_MS ?? '', 10);

  return {
    ...DEFAULT_QDRANT_RETRY_CONFIG,
    ...(maxAttempts > 0 && { maxAttempts }),
    ...(baseDelayMs > 0 && { baseDelayMs }),
    ...(maxDelayMs > 0 && { maxDelayMs }),
  };
}

export const isQdrantTransientError: RetryableCheck = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Network-level errors
  if (message.includes('econnrefused')) return true;
  if (message.includes('econnreset')) return true;
  if (message.includes('etimedout')) return true;
  if (message.includes('enotfound')) return true;
  if (message.includes('network')) return true;
  if (message.includes('socket hang up')) return true;

  // Timeout errors
  if (message.includes('timeout') || message.includes('timed out')) return true;
  if (name.includes('timeout')) return true;

  // HTTP errors that are transient
  if (message.includes('503') || message.includes('service unavailable')) return true;
  if (message.includes('502') || message.includes('bad gateway')) return true;
  if (message.includes('429') || message.includes('too many requests')) return true;
  if (message.includes('rate limit')) return true;

  // Qdrant-specific transient errors
  if (message.includes('temporarily unavailable')) return true;
  if (message.includes('server is not ready')) return true;
  if (message.includes('raft') && message.includes('leader')) return true;
  if (message.includes('consensus')) return true;

  return false;
};

export async function withQdrantRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config?: Partial<RetryConfig>
): Promise<RetryResult<T>> {
  const retryConfig = { ...getQdrantRetryConfig(), ...config };

  const result = await withRetry(operation, retryConfig, isQdrantTransientError);

  if (!result.success) {
    logger.warn(
      `Qdrant operation '${operationName}' failed after ${result.attempts} attempts: ${result.error?.message}`
    );
  } else if (result.attempts > 1) {
    logger.debug(
      `Qdrant operation '${operationName}' succeeded after ${result.attempts} attempts (total delay: ${result.totalDelayMs}ms)`
    );
  }

  return result;
}

export async function executeWithQdrantRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config?: Partial<RetryConfig>
): Promise<T> {
  const result = await withQdrantRetry(operation, operationName, config);

  if (result.success && result.result !== undefined) {
    return result.result;
  }

  throw result.error ?? new Error(`Qdrant operation '${operationName}' failed after retries`);
}
