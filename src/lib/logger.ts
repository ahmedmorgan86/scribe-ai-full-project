/**
 * Structured logging utility for ai-social-engine
 *
 * Provides consistent, JSON-structured logging with:
 * - Log levels (debug, info, warn, error)
 * - Timestamps in ISO format
 * - Module/source context
 * - Optional structured data
 * - Environment-based log level filtering
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

export interface LoggerConfig {
  minLevel: LogLevel;
  jsonOutput: boolean;
  includeTimestamp: boolean;
  includeLevel: boolean;
  includeModule: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: 'info',
  jsonOutput: false,
  includeTimestamp: true,
  includeLevel: true,
  includeModule: true,
};

let globalConfig: LoggerConfig = { ...DEFAULT_CONFIG };

function getLogLevelFromEnv(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function getJsonOutputFromEnv(): boolean {
  return process.env.LOG_JSON === 'true';
}

export function initializeLogger(): void {
  globalConfig = {
    ...DEFAULT_CONFIG,
    minLevel: getLogLevelFromEnv(),
    jsonOutput: getJsonOutputFromEnv(),
  };
}

export function getLoggerConfig(): LoggerConfig {
  return { ...globalConfig };
}

export function configureLogger(config: Partial<LoggerConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

export function resetLoggerConfig(): void {
  globalConfig = { ...DEFAULT_CONFIG };
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[globalConfig.minLevel];
}

function formatError(error: unknown): LogEntry['error'] | undefined {
  if (error === undefined || error === null) return undefined;

  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }

  return {
    message: String(error),
  };
}

function formatLogEntry(entry: LogEntry): string {
  if (globalConfig.jsonOutput) {
    return JSON.stringify(entry);
  }

  const parts: string[] = [];

  if (globalConfig.includeTimestamp) {
    parts.push(`[${entry.timestamp}]`);
  }

  if (globalConfig.includeModule) {
    parts.push(`[${entry.module}]`);
  }

  if (globalConfig.includeLevel) {
    parts.push(`${entry.level.toUpperCase()}:`);
  }

  parts.push(entry.message);

  if (entry.data && Object.keys(entry.data).length > 0) {
    parts.push(JSON.stringify(entry.data));
  }

  if (entry.error) {
    parts.push(`Error: ${entry.error.message}`);
    if (entry.error.stack && globalConfig.minLevel === 'debug') {
      parts.push(`\n${entry.error.stack}`);
    }
  }

  return parts.join(' ');
}

function writeLog(entry: LogEntry): void {
  const formatted = formatLogEntry(entry);

  switch (entry.level) {
    case 'debug':
    case 'info':
      // eslint-disable-next-line no-console
      console.log(formatted);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(formatted);
      break;
    case 'error':
      console.error(formatted);
      break;
  }
}

function log(
  level: LogLevel,
  module: string,
  message: string,
  data?: Record<string, unknown>,
  error?: unknown
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    data,
    error: formatError(error),
  };

  writeLog(entry);
}

export interface Logger {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown, data?: Record<string, unknown>) => void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (message: string, data?: Record<string, unknown>): void => {
      log('debug', module, message, data);
    },
    info: (message: string, data?: Record<string, unknown>): void => {
      log('info', module, message, data);
    },
    warn: (message: string, data?: Record<string, unknown>): void => {
      log('warn', module, message, data);
    },
    error: (message: string, error?: unknown, data?: Record<string, unknown>): void => {
      log('error', module, message, data, error);
    },
  };
}

export function logDebug(module: string, message: string, data?: Record<string, unknown>): void {
  log('debug', module, message, data);
}

export function logInfo(module: string, message: string, data?: Record<string, unknown>): void {
  log('info', module, message, data);
}

export function logWarn(module: string, message: string, data?: Record<string, unknown>): void {
  log('warn', module, message, data);
}

export function logError(
  module: string,
  message: string,
  error?: unknown,
  data?: Record<string, unknown>
): void {
  log('error', module, message, data, error);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

export function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'secret', 'token', 'apiKey', 'api_key', 'authorization'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeLogData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

initializeLogger();
