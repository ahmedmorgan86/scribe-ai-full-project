'use client';

import React, { useState } from 'react';

export type ErrorSeverity = 'error' | 'warning' | 'critical';
export type ErrorSource =
  | 'api'
  | 'scraping'
  | 'generation'
  | 'voice'
  | 'database'
  | 'network'
  | 'budget'
  | 'unknown';

export interface DisplayError {
  id: string;
  message: string;
  details?: string;
  severity: ErrorSeverity;
  source?: ErrorSource;
  timestamp: string;
  retryable?: boolean;
  code?: string;
}

interface ErrorDisplayProps {
  error: DisplayError;
  onDismiss?: (id: string) => void;
  onRetry?: (id: string) => void;
  showTimestamp?: boolean;
  compact?: boolean;
}

const SEVERITY_CONFIG: Record<
  ErrorSeverity,
  { bg: string; border: string; iconBg: string; textColor: string }
> = {
  warning: {
    bg: 'bg-yellow-900/20',
    border: 'border-yellow-500/50',
    iconBg: 'bg-yellow-500/20',
    textColor: 'text-yellow-400',
  },
  error: {
    bg: 'bg-red-900/20',
    border: 'border-red-500/50',
    iconBg: 'bg-red-500/20',
    textColor: 'text-red-400',
  },
  critical: {
    bg: 'bg-red-900/40',
    border: 'border-red-600',
    iconBg: 'bg-red-600/30',
    textColor: 'text-red-300',
  },
};

const SOURCE_LABELS: Record<ErrorSource, string> = {
  api: 'API',
  scraping: 'Scraping',
  generation: 'Generation',
  voice: 'Voice',
  database: 'Database',
  network: 'Network',
  budget: 'Budget',
  unknown: 'System',
};

function ErrorIcon({ severity }: { severity: ErrorSeverity }): React.ReactElement {
  const config = SEVERITY_CONFIG[severity];

  if (severity === 'warning') {
    return (
      <div className={`flex-shrink-0 rounded-full p-2 ${config.iconBg}`}>
        <svg
          className={`h-5 w-5 ${config.textColor}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={`flex-shrink-0 rounded-full p-2 ${config.iconBg}`}>
      <svg
        className={`h-5 w-5 ${config.textColor}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </div>
  );
}

export function ErrorDisplay({
  error,
  onDismiss,
  onRetry,
  showTimestamp = true,
  compact = false,
}: ErrorDisplayProps): React.ReactElement {
  const [showDetails, setShowDetails] = useState(false);
  const config = SEVERITY_CONFIG[error.severity];

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 rounded-md px-3 py-2 ${config.bg} ${config.border} border`}
        role="alert"
      >
        <span className={config.textColor}>⚠</span>
        <span className={`text-sm ${config.textColor}`}>{error.message}</span>
        {onDismiss && (
          <button
            onClick={(): void => onDismiss(error.id)}
            className="ml-auto text-gray-500 hover:text-white"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg ${config.bg} ${config.border} border p-4`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <ErrorIcon severity={error.severity} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-medium ${config.textColor}`}>{error.message}</p>
            {onDismiss && (
              <button
                onClick={(): void => onDismiss(error.id)}
                className="flex-shrink-0 text-gray-500 hover:text-white transition-colors"
                aria-label="Dismiss error"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1.5">
            {error.source && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
                {SOURCE_LABELS[error.source]}
              </span>
            )}
            {error.code && <span className="text-xs font-mono text-gray-500">{error.code}</span>}
            {showTimestamp && (
              <span className="text-xs text-gray-500">{formatErrorTimestamp(error.timestamp)}</span>
            )}
          </div>

          {error.details && (
            <div className="mt-2">
              <button
                onClick={(): void => setShowDetails(!showDetails)}
                className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
              >
                {showDetails ? '▼ Hide details' : '▶ Show details'}
              </button>
              {showDetails && (
                <pre className="mt-2 text-xs font-mono text-gray-400 bg-gray-800/50 rounded p-2 overflow-auto max-h-32">
                  {error.details}
                </pre>
              )}
            </div>
          )}

          {onRetry !== undefined && error.retryable === true && (
            <div className="mt-3">
              <button
                onClick={(): void => onRetry(error.id)}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
              >
                Try again →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ErrorListProps {
  errors: DisplayError[];
  onDismiss?: (id: string) => void;
  onRetry?: (id: string) => void;
  onDismissAll?: () => void;
  maxVisible?: number;
  showTimestamp?: boolean;
}

export function ErrorList({
  errors,
  onDismiss,
  onRetry,
  onDismissAll,
  maxVisible = 5,
  showTimestamp = true,
}: ErrorListProps): React.ReactElement | null {
  if (errors.length === 0) {
    return null;
  }

  const visibleErrors = errors.slice(0, maxVisible);
  const hiddenCount = errors.length - maxVisible;

  return (
    <div className="space-y-2">
      {errors.length > 1 && onDismissAll && (
        <div className="flex justify-end">
          <button
            onClick={onDismissAll}
            className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
          >
            Dismiss all ({errors.length})
          </button>
        </div>
      )}

      {visibleErrors.map((error) => (
        <ErrorDisplay
          key={error.id}
          error={error}
          onDismiss={onDismiss}
          onRetry={onRetry}
          showTimestamp={showTimestamp}
        />
      ))}

      {hiddenCount > 0 && (
        <div className="text-center text-xs text-gray-500 py-2">
          +{hiddenCount} more error{hiddenCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
}

export function InlineError({ message, onRetry }: InlineErrorProps): React.ReactElement {
  return (
    <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-red-400 text-sm">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors ml-4"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

function formatErrorTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 10) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleString();
}

export function createDisplayError(
  message: string,
  options?: Partial<Omit<DisplayError, 'id' | 'message' | 'timestamp'>>
): DisplayError {
  return {
    id: `err-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    message,
    severity: 'error',
    timestamp: new Date().toISOString(),
    ...options,
  };
}

export function createApiError(message: string, code?: string, details?: string): DisplayError {
  return createDisplayError(message, {
    source: 'api',
    code,
    details,
    retryable: true,
  });
}

export function createNetworkError(message: string): DisplayError {
  return createDisplayError(message, {
    source: 'network',
    severity: 'warning',
    retryable: true,
  });
}

export function createBudgetError(message: string): DisplayError {
  return createDisplayError(message, {
    source: 'budget',
    severity: 'critical',
    retryable: false,
  });
}

export function errorFromResponse(error: Error | { message: string }): DisplayError {
  return createDisplayError(error.message, {
    source: 'unknown',
    retryable: true,
  });
}
