/**
 * Apify API error handling module
 *
 * Handles scrape failures, rate limits, timeouts, account issues, and other API errors
 * with appropriate retry logic and logging.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('apify:errors');

export type ApifyErrorType =
  | 'rate_limit'
  | 'timeout'
  | 'account_not_found'
  | 'account_suspended'
  | 'account_protected'
  | 'authentication'
  | 'quota_exceeded'
  | 'actor_failed'
  | 'network_error'
  | 'invalid_response'
  | 'server_error'
  | 'unknown';

export interface ApifyErrorInfo {
  type: ApifyErrorType;
  message: string;
  statusCode?: number;
  retryAfter?: number;
  isRetryable: boolean;
  handle?: string;
  runId?: string;
  originalError: unknown;
}

export class ApifyApiError extends Error {
  public readonly type: ApifyErrorType;
  public readonly statusCode?: number;
  public readonly retryAfter?: number;
  public readonly isRetryable: boolean;
  public readonly handle?: string;
  public readonly runId?: string;
  public readonly originalError: unknown;

  constructor(info: ApifyErrorInfo) {
    super(info.message);
    this.name = 'ApifyApiError';
    this.type = info.type;
    this.statusCode = info.statusCode;
    this.retryAfter = info.retryAfter;
    this.isRetryable = info.isRetryable;
    this.handle = info.handle;
    this.runId = info.runId;
    this.originalError = info.originalError;
  }
}

export class RateLimitError extends ApifyApiError {
  constructor(retryAfter: number, originalError: unknown, handle?: string) {
    super({
      type: 'rate_limit',
      message: `Apify rate limit exceeded. Retry after ${retryAfter} seconds.`,
      statusCode: 429,
      retryAfter,
      isRetryable: true,
      handle,
      originalError,
    });
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends ApifyApiError {
  constructor(timeoutMs: number, originalError: unknown, runId?: string, handle?: string) {
    super({
      type: 'timeout',
      message: `Apify run timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      statusCode: 408,
      isRetryable: true,
      handle,
      runId,
      originalError,
    });
    this.name = 'TimeoutError';
  }
}

export class AccountNotFoundError extends ApifyApiError {
  constructor(handle: string, originalError: unknown) {
    super({
      type: 'account_not_found',
      message: `Twitter account @${handle} not found.`,
      statusCode: 404,
      isRetryable: false,
      handle,
      originalError,
    });
    this.name = 'AccountNotFoundError';
  }
}

export class AccountSuspendedError extends ApifyApiError {
  constructor(handle: string, originalError: unknown) {
    super({
      type: 'account_suspended',
      message: `Twitter account @${handle} is suspended.`,
      statusCode: 403,
      isRetryable: false,
      handle,
      originalError,
    });
    this.name = 'AccountSuspendedError';
  }
}

export class AccountProtectedError extends ApifyApiError {
  constructor(handle: string, originalError: unknown) {
    super({
      type: 'account_protected',
      message: `Twitter account @${handle} is protected (private).`,
      statusCode: 403,
      isRetryable: false,
      handle,
      originalError,
    });
    this.name = 'AccountProtectedError';
  }
}

export class AuthenticationError extends ApifyApiError {
  constructor(message: string, originalError: unknown) {
    super({
      type: 'authentication',
      message,
      statusCode: 401,
      isRetryable: false,
      originalError,
    });
    this.name = 'AuthenticationError';
  }
}

export class QuotaExceededError extends ApifyApiError {
  constructor(originalError: unknown) {
    super({
      type: 'quota_exceeded',
      message: 'Apify usage quota exceeded. Check your Apify plan limits.',
      statusCode: 402,
      isRetryable: false,
      originalError,
    });
    this.name = 'QuotaExceededError';
  }
}

export class ActorFailedError extends ApifyApiError {
  constructor(runId: string, status: string, originalError: unknown, handle?: string) {
    super({
      type: 'actor_failed',
      message: `Apify actor run ${runId} failed with status: ${status}`,
      isRetryable: status === 'TIMING-OUT',
      handle,
      runId,
      originalError,
    });
    this.name = 'ActorFailedError';
  }
}

export class NetworkError extends ApifyApiError {
  constructor(message: string, originalError: unknown) {
    super({
      type: 'network_error',
      message: `Network error: ${message}`,
      isRetryable: true,
      originalError,
    });
    this.name = 'NetworkError';
  }
}

export class InvalidResponseError extends ApifyApiError {
  constructor(message: string, originalError: unknown) {
    super({
      type: 'invalid_response',
      message: `Invalid API response: ${message}`,
      isRetryable: false,
      originalError,
    });
    this.name = 'InvalidResponseError';
  }
}

export class ServerError extends ApifyApiError {
  constructor(statusCode: number, message: string, originalError: unknown) {
    super({
      type: 'server_error',
      message,
      statusCode,
      isRetryable: true,
      originalError,
    });
    this.name = 'ServerError';
  }
}

interface ErrorResponse {
  status?: number;
  statusCode?: number;
  message?: string;
  error?: {
    type?: string;
    message?: string;
  };
  responseBody?: string;
}

function parseRetryAfter(error: ErrorResponse): number {
  const body = error.responseBody ?? '';

  const retryMatch = body.match(/retry[- ]?after[:\s]+(\d+)/i);
  if (retryMatch) {
    const parsed = parseInt(retryMatch[1], 10);
    if (!isNaN(parsed)) return parsed;
  }

  return 60;
}

function detectAccountError(error: ErrorResponse, handle?: string): ApifyApiError | null {
  const body = (error.responseBody ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();
  const combined = body + ' ' + message;

  if (combined.includes('not found') || combined.includes('user not found')) {
    return new AccountNotFoundError(handle ?? 'unknown', error);
  }

  if (combined.includes('suspended')) {
    return new AccountSuspendedError(handle ?? 'unknown', error);
  }

  if (combined.includes('protected') || combined.includes('private')) {
    return new AccountProtectedError(handle ?? 'unknown', error);
  }

  return null;
}

export function parseApifyError(error: unknown, handle?: string): ApifyApiError {
  const err = error as ErrorResponse;
  const statusCode = err.status ?? err.statusCode;
  const errorMessage = err.error?.message ?? err.message ?? 'Unknown Apify error';

  if (statusCode === 429) {
    const retryAfter = parseRetryAfter(err);
    logger.warn('Apify rate limit hit', { retryAfter, handle });
    return new RateLimitError(retryAfter, error, handle);
  }

  if (statusCode === 401) {
    logger.error('Apify authentication failed', error);
    return new AuthenticationError(errorMessage, error);
  }

  if (statusCode === 402) {
    logger.error('Apify quota exceeded', error);
    return new QuotaExceededError(error);
  }

  if (statusCode === 403 || statusCode === 404) {
    const accountError = detectAccountError(err, handle);
    if (accountError) {
      logger.warn('Account access issue', { type: accountError.type, handle });
      return accountError;
    }
  }

  if (statusCode === 408) {
    logger.warn('Apify request timeout', { handle });
    return new TimeoutError(600000, error, undefined, handle);
  }

  if (statusCode !== undefined && statusCode >= 500) {
    logger.error('Apify server error', error, { statusCode });
    return new ServerError(statusCode, errorMessage, error);
  }

  const lowerMessage = errorMessage.toLowerCase();
  if (
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound')
  ) {
    logger.warn('Network error communicating with Apify', { message: errorMessage });
    return new NetworkError(errorMessage, error);
  }

  if (lowerMessage.includes('timed out') || lowerMessage.includes('timeout')) {
    logger.warn('Apify operation timeout', { message: errorMessage, handle });
    return new TimeoutError(600000, error, undefined, handle);
  }

  const accountError = detectAccountError(err, handle);
  if (accountError) {
    logger.warn('Account access issue', { type: accountError.type, handle });
    return accountError;
  }

  logger.error('Unknown Apify error', error, { statusCode, handle });
  return new ApifyApiError({
    type: 'unknown',
    message: errorMessage,
    statusCode,
    isRetryable: false,
    handle,
    originalError: error,
  });
}

export function parseActorRunError(runId: string, status: string, handle?: string): ApifyApiError {
  const error = { runId, status, handle };

  if (status === 'FAILED') {
    logger.error('Apify actor run failed', error);
    return new ActorFailedError(runId, status, error, handle);
  }

  if (status === 'ABORTED') {
    logger.warn('Apify actor run was aborted', error);
    return new ActorFailedError(runId, status, error, handle);
  }

  if (status === 'TIMING-OUT') {
    logger.warn('Apify actor run is timing out', error);
    return new ActorFailedError(runId, status, error, handle);
  }

  return new ActorFailedError(runId, status, error, handle);
}

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 2000,
  maxDelayMs: 120000,
  backoffMultiplier: 2,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(attempt: number, options: RetryOptions, retryAfter?: number): number {
  if (retryAfter !== undefined && retryAfter > 0) {
    return Math.min(retryAfter * 1000, options.maxDelayMs);
  }

  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);
  const jitter = Math.random() * 0.1 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, options.maxDelayMs);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  handle?: string
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: ApifyApiError | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof ApifyApiError ? error : parseApifyError(error, handle);

      if (!lastError.isRetryable || attempt === opts.maxRetries) {
        logger.error('Apify operation failed (not retrying)', lastError, {
          attempt,
          maxRetries: opts.maxRetries,
          errorType: lastError.type,
          handle,
        });
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts, lastError.retryAfter);
      logger.info('Retrying Apify operation', {
        attempt: attempt + 1,
        maxRetries: opts.maxRetries,
        delayMs: delay,
        errorType: lastError.type,
        handle,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApifyApiError) {
    return error.isRetryable;
  }

  const parsed = parseApifyError(error);
  return parsed.isRetryable;
}

export function getErrorType(error: unknown): ApifyErrorType {
  if (error instanceof ApifyApiError) {
    return error.type;
  }

  const parsed = parseApifyError(error);
  return parsed.type;
}

export function shouldSkipAccount(error: unknown): boolean {
  if (error instanceof ApifyApiError) {
    return (
      error.type === 'account_not_found' ||
      error.type === 'account_suspended' ||
      error.type === 'account_protected'
    );
  }

  const parsed = parseApifyError(error);
  return (
    parsed.type === 'account_not_found' ||
    parsed.type === 'account_suspended' ||
    parsed.type === 'account_protected'
  );
}

export function formatErrorForDisplay(error: unknown): string {
  if (error instanceof ApifyApiError) {
    switch (error.type) {
      case 'rate_limit':
        return `Rate limited. Please wait ${error.retryAfter ?? 60} seconds before trying again.`;
      case 'timeout':
        return 'The scraping operation timed out. The account may have too many tweets or the service is slow.';
      case 'account_not_found':
        return `Twitter account @${error.handle ?? 'unknown'} was not found. It may have been deleted or the handle changed.`;
      case 'account_suspended':
        return `Twitter account @${error.handle ?? 'unknown'} is suspended and cannot be scraped.`;
      case 'account_protected':
        return `Twitter account @${error.handle ?? 'unknown'} is private and cannot be scraped.`;
      case 'authentication':
        return 'Apify authentication failed. Check your API token configuration.';
      case 'quota_exceeded':
        return 'Apify usage quota exceeded. Upgrade your plan or wait for the quota to reset.';
      case 'actor_failed':
        return `The scraping actor failed. Run ID: ${error.runId ?? 'unknown'}. This may be a temporary issue.`;
      case 'network_error':
        return 'Network error connecting to Apify. Check your internet connection.';
      case 'invalid_response':
        return 'Received an invalid response from Apify. This may be a temporary issue.';
      case 'server_error':
        return 'Apify service is experiencing issues. Please try again later.';
      default:
        return `An error occurred: ${error.message}`;
    }
  }

  return 'An unexpected error occurred during scraping. Please try again.';
}

export interface ScrapeFailureSummary {
  totalFailures: number;
  byType: Record<ApifyErrorType, number>;
  retriedCount: number;
  permanentFailures: number;
  accountIssues: string[];
}

export function summarizeScrapeFailures(errors: ApifyApiError[]): ScrapeFailureSummary {
  const byType: Record<ApifyErrorType, number> = {
    rate_limit: 0,
    timeout: 0,
    account_not_found: 0,
    account_suspended: 0,
    account_protected: 0,
    authentication: 0,
    quota_exceeded: 0,
    actor_failed: 0,
    network_error: 0,
    invalid_response: 0,
    server_error: 0,
    unknown: 0,
  };

  const accountIssues: string[] = [];
  let retriedCount = 0;
  let permanentFailures = 0;

  for (const error of errors) {
    byType[error.type]++;

    if (error.isRetryable) {
      retriedCount++;
    } else {
      permanentFailures++;
    }

    if (shouldSkipAccount(error) && error.handle) {
      accountIssues.push(`@${error.handle}: ${error.type.replace(/_/g, ' ')}`);
    }
  }

  return {
    totalFailures: errors.length,
    byType,
    retriedCount,
    permanentFailures,
    accountIssues,
  };
}

export function formatFailureSummary(summary: ScrapeFailureSummary): string {
  const lines: string[] = [];

  lines.push(`Total failures: ${summary.totalFailures}`);
  lines.push(`Retryable: ${summary.retriedCount}, Permanent: ${summary.permanentFailures}`);

  const significantTypes = Object.entries(summary.byType)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (significantTypes.length > 0) {
    lines.push('\nFailures by type:');
    for (const [type, count] of significantTypes) {
      lines.push(`  ${type}: ${count}`);
    }
  }

  if (summary.accountIssues.length > 0) {
    lines.push('\nAccount issues:');
    for (const issue of summary.accountIssues) {
      lines.push(`  ${issue}`);
    }
  }

  return lines.join('\n');
}
