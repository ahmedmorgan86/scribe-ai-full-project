'use client';

import { useState, useEffect, useCallback } from 'react';

interface SchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxQueueSize: number;
  sourceMode: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface SchedulerRun {
  id: number;
  startedAt: string;
  status: string;
  postsQueued: number;
  error: string | null;
}

interface SchedulerStatus {
  config: SchedulerConfig;
  shouldRunNow: boolean;
  currentQueueSize: number;
  recentRuns: SchedulerRun[];
  stats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    totalPostsGenerated: number;
  };
}

interface SchedulerWidgetProps {
  pollInterval?: number;
}

export function SchedulerWidget({
  pollInterval = 30000,
}: SchedulerWidgetProps): React.ReactElement {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/scheduler/status');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = (await response.json()) as SchedulerStatus;
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch scheduler status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  if (isLoading) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Autonomous Scheduler</h3>
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error !== null || !status) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Autonomous Scheduler</h3>
        <div className="text-sm text-red-400">{error ?? 'Failed to load'}</div>
      </div>
    );
  }

  const successRate =
    status.stats.totalRuns > 0
      ? Math.round((status.stats.successfulRuns / status.stats.totalRuns) * 100)
      : 0;

  return (
    <div className="rounded-lg bg-gray-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-white">Autonomous Scheduler</h3>
        <a href="/settings" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
          Configure →
        </a>
      </div>

      {/* Status Badge */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`w-3 h-3 rounded-full ${status.config.enabled ? 'bg-green-500' : 'bg-gray-500'}`}
        />
        <span
          className={`text-sm font-medium ${status.config.enabled ? 'text-green-400' : 'text-gray-400'}`}
        >
          {status.config.enabled ? 'Active' : 'Disabled'}
        </span>
        {status.config.enabled && (
          <span className="text-xs text-gray-500">Every {status.config.intervalMinutes}m</span>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 rounded bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block">Queue</span>
          <span className="text-lg font-medium text-gray-200">
            {status.currentQueueSize}/{status.config.maxQueueSize}
          </span>
        </div>
        <div className="p-3 rounded bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block">7-Day Success</span>
          <span
            className={`text-lg font-medium ${
              successRate >= 80
                ? 'text-green-400'
                : successRate >= 50
                  ? 'text-yellow-400'
                  : 'text-red-400'
            }`}
          >
            {successRate}%
          </span>
        </div>
      </div>

      {/* Next Run */}
      {status.config.enabled && status.config.nextRunAt && (
        <div className="text-xs text-gray-500 mb-3">
          Next run: {new Date(status.config.nextRunAt).toLocaleTimeString()}
        </div>
      )}

      {/* Recent Runs */}
      {status.recentRuns.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-gray-500">Recent runs:</span>
          <div className="flex gap-1">
            {status.recentRuns.slice(0, 10).map((run) => (
              <div
                key={run.id}
                title={`${new Date(run.startedAt).toLocaleString()} - ${run.status}${run.error ? `: ${run.error}` : ''}`}
                className={`w-4 h-4 rounded ${
                  run.status === 'completed'
                    ? 'bg-green-500/70'
                    : run.status === 'failed'
                      ? 'bg-red-500/70'
                      : run.status === 'skipped'
                        ? 'bg-yellow-500/70'
                        : 'bg-gray-500/70'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SchedulerWidget;
