/**
 * Anthropic API error handling module
 *
 * Handles rate limits, overload errors, budget exceeded, and other API errors
 * with appropriate retry logic and logging.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('anthropic:errors');

export type AnthropicErrorType =
  | 'rate_limit'
  | 'overloaded'
  | 'budget_exceeded'
  | 'authentication'
  | 'invalid_request'
  | 'server_error'
  | 'unknown';

export interface AnthropicErrorInfo {
  type: AnthropicErrorType;
  message: string;
  statusCode?: number;
  retryAfter?: number;
  isRetryable: boolean;
  originalError: unknown;
}

export class AnthropicApiError extends Error {
  public readonly type: AnthropicErrorType;
  public readonly statusCode?: number;
  public readonly retryAfter?: number;
  public readonly isRetryable: boolean;
  public readonly originalError: unknown;

  constructor(info: AnthropicErrorInfo) {
    super(info.message);
    this.name = 'AnthropicApiError';
    this.type = info.type;
    this.statusCode = info.statusCode;
    this.retryAfter = info.retryAfter;
    this.isRetryable = info.isRetryable;
    this.originalError = info.originalError;
  }
}

export class RateLimitError extends AnthropicApiError {
  constructor(retryAfter: number, originalError: unknown) {
    super({
      type: 'rate_limit',
      message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
      statusCode: 429,
      retryAfter,
      isRetryable: true,
      originalError,
    });
    this.name = 'RateLimitError';
  }
}

export class OverloadedError extends AnthropicApiError {
  constructor(retryAfter: number, originalError: unknown) {
    super({
      type: 'overloaded',
      message: `API overloaded. Retry after ${retryAfter} seconds.`,
      statusCode: 529,
      retryAfter,
      isRetryable: true,
      originalError,
    });
    this.name = 'OverloadedError';
  }
}

export class AuthenticationError extends AnthropicApiError {
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

export class InvalidRequestError extends AnthropicApiError {
  constructor(message: string, originalError: unknown) {
    super({
      type: 'invalid_request',
      message,
      statusCode: 400,
      isRetryable: false,
      originalError,
    });
    this.name = 'InvalidRequestError';
  }
}

export class ServerError extends AnthropicApiError {
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
  error?: {
    type?: string;
    message?: string;
  };
  headers?: {
    get?: (name: string) => string | null;
  };
  message?: string;
}

function parseRetryAfter(headers: { get?: (name: string) => string | null } | undefined): number {
  if (!headers?.get) return 60;
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null && retryAfter !== undefined && retryAfter !== '') {
    const parsed = parseInt(retryAfter, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 60;
}

export function parseAnthropicError(error: unknown): AnthropicApiError {
  const err = error as ErrorResponse;
  const statusCode = err.status;
  const errorType = err.error?.type;
  const errorMessage = err.error?.message ?? err.message ?? 'Unknown error';

  if (statusCode === 429) {
    const retryAfter = parseRetryAfter(err.headers);
    logger.warn('Rate limit hit', { retryAfter, errorType });
    return new RateLimitError(retryAfter, error);
  }

  if (statusCode === 529) {
    const retryAfter = parseRetryAfter(err.headers);
    logger.warn('API overloaded', { retryAfter, errorType });
    return new OverloadedError(retryAfter, error);
  }

  if (statusCode === 401) {
    logger.error('Authentication failed', error, { errorType });
    return new AuthenticationError(errorMessage, error);
  }

  if (statusCode === 400) {
    logger.error('Invalid request', error, { errorType, errorMessage });
    return new InvalidRequestError(errorMessage, error);
  }

  if (statusCode !== undefined && statusCode >= 500) {
    logger.error('Server error', error, { statusCode, errorType });
    return new ServerError(statusCode, errorMessage, error);
  }

  logger.error('Unknown API error', error, { statusCode, errorType, errorMessage });
  return new AnthropicApiError({
    type: 'unknown',
    message: errorMessage,
    statusCode,
    isRetryable: false,
    originalError: error,
  });
}

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
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
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: AnthropicApiError | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof AnthropicApiError ? error : parseAnthropicError(error);

      if (!lastError.isRetryable || attempt === opts.maxRetries) {
        logger.error('API call failed (not retrying)', lastError, {
          attempt,
          maxRetries: opts.maxRetries,
          errorType: lastError.type,
        });
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts, lastError.retryAfter);
      logger.info('Retrying API call', {
        attempt: attempt + 1,
        maxRetries: opts.maxRetries,
        delayMs: delay,
        errorType: lastError.type,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof AnthropicApiError) {
    return error.isRetryable;
  }

  const parsed = parseAnthropicError(error);
  return parsed.isRetryable;
}

export function getErrorType(error: unknown): AnthropicErrorType {
  if (error instanceof AnthropicApiError) {
    return error.type;
  }

  const parsed = parseAnthropicError(error);
  return parsed.type;
}

export function formatErrorForDisplay(error: unknown): string {
  if (error instanceof AnthropicApiError) {
    switch (error.type) {
      case 'rate_limit':
        return `Rate limited. Please wait ${error.retryAfter ?? 60} seconds before trying again.`;
      case 'overloaded':
        return 'The AI service is currently overloaded. Please try again later.';
      case 'budget_exceeded':
        return 'API budget has been exceeded. Contact administrator.';
      case 'authentication':
        return 'API authentication failed. Check your API key configuration.';
      case 'invalid_request':
        return `Invalid request: ${error.message}`;
      case 'server_error':
        return 'AI service is experiencing issues. Please try again later.';
      default:
        return `An error occurred: ${error.message}`;
    }
  }

  return 'An unexpected error occurred. Please try again.';
}
