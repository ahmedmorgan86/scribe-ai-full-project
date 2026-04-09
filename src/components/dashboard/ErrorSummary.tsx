'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ApiHealth } from '@/lib/errors/graceful-degradation';
import type {
  ErrorSummaryResponse,
  RecentError,
  ErrorCounts,
} from '@/app/api/errors/summary/route';

export interface ErrorSummaryData {
  apiHealth: ApiHealth[];
  recentErrors: RecentError[];
  errorCounts: ErrorCounts;
}

interface ErrorSummaryProps {
  initialData?: ErrorSummaryData;
  pollInterval?: number;
}

const STATUS_CONFIG: Record<string, { color: string; bgColor: string; label: string }> = {
  healthy: { color: 'text-green-400', bgColor: 'bg-green-500/20', label: 'Healthy' },
  degraded: { color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', label: 'Degraded' },
  unavailable: { color: 'text-red-400', bgColor: 'bg-red-500/20', label: 'Unavailable' },
};

const CATEGORY_LABELS: Record<string, string> = {
  budget: 'Budget',
  rate_limit: 'Rate Limit',
  network: 'Network',
  auth: 'Auth',
  server: 'Server',
  client: 'Client',
  unknown: 'Other',
};

export function ErrorSummary({
  initialData,
  pollInterval = 30000,
}: ErrorSummaryProps): React.ReactElement {
  const [data, setData] = useState<ErrorSummaryData | null>(initialData ?? null);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [error, setError] = useState<Error | null>(null);
  const [expandedApi, setExpandedApi] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/errors/summary');

      if (!isMountedRef.current) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as ErrorSummaryResponse;

      if (!isMountedRef.current) return;

      setData({
        apiHealth: result.apiHealth,
        recentErrors: result.recentErrors,
        errorCounts: result.errorCounts,
      });
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch error summary'));
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!initialData) {
      void fetchData();
    }

    const interval = setInterval(() => {
      void fetchData();
    }, pollInterval);

    return (): void => clearInterval(interval);
  }, [fetchData, initialData, pollInterval]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-16 bg-gray-700 rounded-lg" />
        <div className="h-24 bg-gray-700 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
        <p className="text-red-400 text-sm">Failed to load error summary: {error.message}</p>
      </div>
    );
  }

  if (!data) {
    return <div className="text-gray-400 text-sm">No error data available</div>;
  }

  const hasErrors = data.errorCounts.last24h > 0 || data.recentErrors.length > 0;
  const hasUnhealthyApis = data.apiHealth.some((h) => h.status !== 'healthy');

  if (!hasErrors && !hasUnhealthyApis) {
    return <AllSystemsHealthy />;
  }

  return (
    <div className="space-y-4">
      <ApiHealthGrid
        apiHealth={data.apiHealth}
        expandedApi={expandedApi}
        onToggleExpand={(name): void => setExpandedApi(expandedApi === name ? null : name)}
      />

      {data.errorCounts.last24h > 0 && <ErrorCountsBar errorCounts={data.errorCounts} />}

      {data.recentErrors.length > 0 && <RecentErrorsList errors={data.recentErrors} />}
    </div>
  );
}

function AllSystemsHealthy(): React.ReactElement {
  return (
    <div className="text-center py-6">
      <span className="text-3xl text-green-400" aria-hidden="true">
        ✓
      </span>
      <p className="text-green-400 mt-2 font-medium">All Systems Healthy</p>
      <p className="text-xs text-gray-500 mt-1">No errors in the last 24 hours</p>
    </div>
  );
}

interface ApiHealthGridProps {
  apiHealth: ApiHealth[];
  expandedApi: string | null;
  onToggleExpand: (name: string) => void;
}

function ApiHealthGrid({
  apiHealth,
  expandedApi,
  onToggleExpand,
}: ApiHealthGridProps): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {apiHealth.map((health) => (
        <ApiHealthCard
          key={health.name}
          health={health}
          isExpanded={expandedApi === health.name}
          onToggle={(): void => onToggleExpand(health.name)}
        />
      ))}
    </div>
  );
}

interface ApiHealthCardProps {
  health: ApiHealth;
  isExpanded: boolean;
  onToggle: () => void;
}

function ApiHealthCard({ health, isExpanded, onToggle }: ApiHealthCardProps): React.ReactElement {
  const config = STATUS_CONFIG[health.status] ?? STATUS_CONFIG.healthy;

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`w-full rounded-lg p-3 border transition-colors ${
          health.status === 'healthy'
            ? 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
            : health.status === 'degraded'
              ? 'border-yellow-500/30 hover:border-yellow-500/50 bg-yellow-900/10'
              : 'border-red-500/30 hover:border-red-500/50 bg-red-900/10'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white capitalize">{health.name}</span>
          <span
            className={`w-2 h-2 rounded-full ${
              health.status === 'healthy'
                ? 'bg-green-400'
                : health.status === 'degraded'
                  ? 'bg-yellow-400'
                  : 'bg-red-400'
            }`}
          />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className={`text-xs ${config.color}`}>{config.label}</span>
          {health.consecutiveFailures > 0 && (
            <span className="text-xs text-gray-500">{health.consecutiveFailures} fails</span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="absolute z-10 mt-1 w-64 rounded-lg bg-gray-800 border border-gray-700 shadow-xl p-3 text-xs">
          <ApiHealthDetails health={health} />
        </div>
      )}
    </div>
  );
}

function ApiHealthDetails({ health }: { health: ApiHealth }): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <span className="text-gray-400">Status</span>
        <span className={STATUS_CONFIG[health.status]?.color ?? 'text-gray-400'}>
          {health.status}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">Successes</span>
        <span className="text-green-400">{health.totalSuccesses}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">Failures</span>
        <span className="text-red-400">{health.totalFailures}</span>
      </div>
      {health.lastSuccess && (
        <div className="flex justify-between">
          <span className="text-gray-400">Last Success</span>
          <span className="text-gray-300">{formatTimestamp(health.lastSuccess)}</span>
        </div>
      )}
      {health.lastFailure && (
        <div className="flex justify-between">
          <span className="text-gray-400">Last Failure</span>
          <span className="text-gray-300">{formatTimestamp(health.lastFailure)}</span>
        </div>
      )}
      {health.lastError && (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <span className="text-gray-400 block mb-1">Last Error</span>
          <span className="text-red-400 break-words">{truncate(health.lastError, 100)}</span>
        </div>
      )}
    </div>
  );
}

interface ErrorCountsBarProps {
  errorCounts: ErrorCounts;
}

function ErrorCountsBar({ errorCounts }: ErrorCountsBarProps): React.ReactElement {
  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-white">Error Counts</span>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <span className="text-lg font-bold text-white">{errorCounts.last1h}</span>
          <p className="text-xs text-gray-500">Last hour</p>
        </div>
        <div>
          <span className="text-lg font-bold text-white">{errorCounts.last24h}</span>
          <p className="text-xs text-gray-500">Last 24h</p>
        </div>
        <div>
          <span className="text-lg font-bold text-white">{errorCounts.last7d}</span>
          <p className="text-xs text-gray-500">Last 7d</p>
        </div>
      </div>

      {Object.keys(errorCounts.byCategory).length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="flex flex-wrap gap-2">
            {Object.entries(errorCounts.byCategory).map(([category, count]) => (
              <span
                key={category}
                className="text-xs px-2 py-1 rounded-full bg-gray-700 text-gray-300"
              >
                {CATEGORY_LABELS[category] ?? category}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface RecentErrorsListProps {
  errors: RecentError[];
  maxVisible?: number;
}

function RecentErrorsList({ errors, maxVisible = 3 }: RecentErrorsListProps): React.ReactElement {
  const visible = errors.slice(0, maxVisible);
  const hidden = errors.length - maxVisible;

  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-white">Recent Errors</span>
        {errors.length > 0 && <span className="text-xs text-gray-500">{errors.length} total</span>}
      </div>
      <div className="space-y-2">
        {visible.map((err) => (
          <RecentErrorItem key={err.id} error={err} />
        ))}
        {hidden > 0 && (
          <div className="text-center text-xs text-gray-500 py-1">
            +{hidden} more error{hidden > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function RecentErrorItem({ error }: { error: RecentError }): React.ReactElement {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span
        className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center ${
          error.retryable ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
        }`}
      >
        {error.retryable ? '⚠' : '✕'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-gray-300 truncate">{truncate(error.message, 60)}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-gray-500">{formatTimestamp(error.timestamp)}</span>
          <span className="text-gray-600">•</span>
          <span className="text-gray-500 capitalize">{error.source}</span>
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 60) return 'just now';

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
