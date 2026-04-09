type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  worker: string;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
}

export interface WorkerLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
}

function formatLogEntry(entry: LogEntry): string {
  const parts = [`[${entry.timestamp}] [${entry.worker}] ${entry.level}: ${entry.message}`];
  if (entry.error) {
    parts.push(`: ${entry.error}`);
  }
  if (entry.data && Object.keys(entry.data).length > 0) {
    parts.push(` ${JSON.stringify(entry.data)}`);
  }
  return parts.join('');
}

export function createWorkerLogger(workerName: string): WorkerLogger {
  const log = (
    level: LogLevel,
    message: string,
    error?: unknown,
    data?: Record<string, unknown>
  ): void => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      worker: workerName,
      message,
    };

    if (error !== undefined) {
      entry.error = error instanceof Error ? error.message : String(error ?? '');
    }

    if (data) {
      entry.data = data;
    }

    const formatted = formatLogEntry(entry);

    switch (level) {
      case 'ERROR':
        console.error(formatted);
        break;
      case 'WARN':
        console.warn(formatted);
        break;
      case 'DEBUG':
        // eslint-disable-next-line no-console
        console.debug(formatted);
        break;
      default:
        // eslint-disable-next-line no-console
        console.log(formatted);
    }
  };

  return {
    info: (message: string, data?: Record<string, unknown>): void => {
      log('INFO', message, undefined, data);
    },
    warn: (message: string, data?: Record<string, unknown>): void => {
      log('WARN', message, undefined, data);
    },
    error: (message: string, error?: unknown, data?: Record<string, unknown>): void => {
      log('ERROR', message, error, data);
    },
    debug: (message: string, data?: Record<string, unknown>): void => {
      log('DEBUG', message, undefined, data);
    },
  };
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

function isRetryableError(error: Error, config: RetryConfig): boolean {
  const message = error.message.toLowerCase();

  if (config.nonRetryableErrors) {
    for (const pattern of config.nonRetryableErrors) {
      if (message.includes(pattern.toLowerCase())) {
        return false;
      }
    }
  }

  if (config.retryableErrors && config.retryableErrors.length > 0) {
    for (const pattern of config.retryableErrors) {
      if (message.includes(pattern.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  return true;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  logger?: WorkerLogger,
  operationName?: string
): Promise<RetryResult<T>> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;
  let totalDelayMs = 0;

  for (let attempt = 1; attempt <= fullConfig.maxAttempts; attempt++) {
    try {
      const result = await operation();
      return {
        success: true,
        result,
        attempts: attempt,
        totalDelayMs,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isLastAttempt = attempt >= fullConfig.maxAttempts;
      const shouldRetry = !isLastAttempt && isRetryableError(lastError, fullConfig);

      if (logger && operationName) {
        logger.error(
          `${operationName} failed (attempt ${attempt}/${fullConfig.maxAttempts})`,
          lastError,
          {
            willRetry: shouldRetry,
            isRetryable: isRetryableError(lastError, fullConfig),
          }
        );
      }

      if (!shouldRetry) {
        break;
      }

      const delay = calculateDelay(attempt, fullConfig);
      totalDelayMs += delay;

      if (logger && operationName) {
        logger.info(`Retrying ${operationName} in ${delay}ms`, {
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: fullConfig.maxAttempts,
        });
      }

      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: fullConfig.maxAttempts,
    totalDelayMs,
  };
}

export interface BatchProcessConfig<T, R> {
  items: T[];
  processor: (item: T) => Promise<R>;
  concurrency?: number;
  stopOnFirstError?: boolean;
  retryConfig?: Partial<RetryConfig>;
  logger?: WorkerLogger;
  getItemName?: (item: T) => string;
}

export interface BatchResult<T, R> {
  successful: Array<{ item: T; result: R }>;
  failed: Array<{ item: T; error: Error; attempts: number }>;
  totalDuration: number;
}

export async function processBatch<T, R>(
  config: BatchProcessConfig<T, R>
): Promise<BatchResult<T, R>> {
  const startTime = Date.now();
  const {
    items,
    processor,
    concurrency = 1,
    stopOnFirstError = false,
    retryConfig,
    logger,
    getItemName,
  } = config;

  const successful: Array<{ item: T; result: R }> = [];
  const failed: Array<{ item: T; error: Error; attempts: number }> = [];

  const processItem = async (item: T): Promise<void> => {
    const itemName = getItemName?.(item) ?? 'item';

    if (retryConfig) {
      const retryResult = await withRetry(
        () => processor(item),
        retryConfig,
        logger,
        `Processing ${itemName}`
      );

      if (retryResult.success && retryResult.result !== undefined) {
        successful.push({ item, result: retryResult.result });
      } else {
        failed.push({
          item,
          error: retryResult.error ?? new Error('Unknown error'),
          attempts: retryResult.attempts,
        });
      }
    } else {
      try {
        const result = await processor(item);
        successful.push({ item, result });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        failed.push({ item, error, attempts: 1 });
        logger?.error(`Failed to process ${itemName}`, error);
      }
    }
  };

  if (concurrency <= 1) {
    for (const item of items) {
      await processItem(item);
      if (stopOnFirstError && failed.length > 0) {
        break;
      }
    }
  } else {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      chunks.push(items.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(processItem));
      if (stopOnFirstError && failed.length > 0) {
        break;
      }
    }
  }

  return {
    successful,
    failed,
    totalDuration: Date.now() - startTime,
  };
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
}

type CircuitState = 'closed' | 'open' | 'half-open';

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  halfOpenRequests: 3,
};

export interface CircuitBreaker {
  execute: <T>(operation: () => Promise<T>) => Promise<T>;
  getState: () => CircuitState;
  getStats: () => {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailure: string | null;
  };
  reset: () => void;
}

export function createCircuitBreaker(
  name: string,
  config: Partial<CircuitBreakerConfig> = {},
  logger?: WorkerLogger
): CircuitBreaker {
  const fullConfig: CircuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };

  let state: CircuitState = 'closed';
  let failureCount = 0;
  let successCount = 0;
  let lastFailure: Date | null = null;
  let halfOpenSuccesses = 0;

  const transitionTo = (newState: CircuitState): void => {
    if (state !== newState) {
      logger?.info(`Circuit breaker [${name}] transition: ${state} -> ${newState}`, {
        failureCount,
        successCount,
      });
      state = newState;
    }
  };

  const checkStateTransition = (): void => {
    if (state === 'open' && lastFailure) {
      const elapsed = Date.now() - lastFailure.getTime();
      if (elapsed >= fullConfig.resetTimeoutMs) {
        transitionTo('half-open');
        halfOpenSuccesses = 0;
      }
    }
  };

  return {
    execute: async <T>(operation: () => Promise<T>): Promise<T> => {
      checkStateTransition();

      if (state === 'open') {
        const error = new Error(`Circuit breaker [${name}] is open`);
        logger?.warn(`Circuit breaker [${name}] rejected request - circuit is open`);
        throw error;
      }

      try {
        const result = await operation();
        successCount++;

        if (state === 'half-open') {
          halfOpenSuccesses++;
          if (halfOpenSuccesses >= fullConfig.halfOpenRequests) {
            transitionTo('closed');
            failureCount = 0;
          }
        } else if (state === 'closed') {
          failureCount = Math.max(0, failureCount - 1);
        }

        return result;
      } catch (err) {
        failureCount++;
        lastFailure = new Date();

        if (state === 'half-open') {
          transitionTo('open');
        } else if (state === 'closed' && failureCount >= fullConfig.failureThreshold) {
          transitionTo('open');
        }

        throw err;
      }
    },

    getState: (): CircuitState => {
      checkStateTransition();
      return state;
    },

    getStats: () => {
      checkStateTransition();
      return {
        state,
        failureCount,
        successCount,
        lastFailure: lastFailure?.toISOString() ?? null,
      };
    },

    reset: (): void => {
      state = 'closed';
      failureCount = 0;
      successCount = 0;
      lastFailure = null;
      halfOpenSuccesses = 0;
      logger?.info(`Circuit breaker [${name}] reset`);
    },
  };
}

export interface ErrorAggregator {
  add: (error: Error, context?: Record<string, unknown>) => void;
  getErrors: () => AggregatedError[];
  getSummary: () => ErrorSummary;
  clear: () => void;
}

export interface AggregatedError {
  message: string;
  count: number;
  firstOccurrence: string;
  lastOccurrence: string;
  contexts: Array<Record<string, unknown>>;
}

export interface ErrorSummary {
  totalErrors: number;
  uniqueErrors: number;
  errorsByType: Record<string, number>;
}

export function createErrorAggregator(maxContextsPerError: number = 5): ErrorAggregator {
  const errors = new Map<string, AggregatedError>();

  return {
    add: (error: Error, context?: Record<string, unknown>): void => {
      const key = error.message;
      const now = new Date().toISOString();

      const existing = errors.get(key);
      if (existing) {
        existing.count++;
        existing.lastOccurrence = now;
        if (context && existing.contexts.length < maxContextsPerError) {
          existing.contexts.push(context);
        }
      } else {
        errors.set(key, {
          message: key,
          count: 1,
          firstOccurrence: now,
          lastOccurrence: now,
          contexts: context ? [context] : [],
        });
      }
    },

    getErrors: (): AggregatedError[] => {
      return Array.from(errors.values()).sort((a, b) => b.count - a.count);
    },

    getSummary: (): ErrorSummary => {
      let totalErrors = 0;
      const errorsByType: Record<string, number> = {};

      for (const error of errors.values()) {
        totalErrors += error.count;

        const type = extractErrorType(error.message);
        errorsByType[type] = (errorsByType[type] ?? 0) + error.count;
      }

      return {
        totalErrors,
        uniqueErrors: errors.size,
        errorsByType,
      };
    },

    clear: (): void => {
      errors.clear();
    },
  };
}

function extractErrorType(message: string): string {
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return 'timeout';
  }
  if (
    message.includes('network') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND')
  ) {
    return 'network';
  }
  if (message.includes('rate limit') || message.includes('429')) {
    return 'rate_limit';
  }
  if (message.includes('budget') || message.includes('exceeded')) {
    return 'budget';
  }
  if (message.includes('auth') || message.includes('401') || message.includes('403')) {
    return 'auth';
  }
  return 'other';
}

export const COMMON_RETRYABLE_ERRORS = [
  'timeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'rate limit',
  '429',
  '503',
  '502',
  '504',
  'temporarily unavailable',
  'service unavailable',
];

export const COMMON_NON_RETRYABLE_ERRORS = [
  'budget exceeded',
  '401',
  '403',
  'unauthorized',
  'forbidden',
  'invalid api key',
  'authentication failed',
];
