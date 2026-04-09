'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import type { DashboardStatsResponse } from '@/app/api/dashboard/stats/route';
import type { AgentActivity } from '@/components/dashboard/AgentStatus';
import type { QueueSummaryData } from '@/components/dashboard/QueueSummary';
import type { QuickStatsData } from '@/components/dashboard/QuickStats';
import type { Alert } from '@/components/dashboard/Alerts';

const DEFAULT_POLL_INTERVAL = 10000;

export interface UseDashboardStatsOptions {
  pollInterval?: number;
  enabled?: boolean;
}

export interface UseDashboardStatsResult {
  agentActivity: AgentActivity;
  queueSummary: QueueSummaryData;
  quickStats: QuickStatsData;
  alerts: Alert[];
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refetch: () => Promise<void>;
}

function createEmptyStats(): QuickStatsData {
  return {
    postsToday: 0,
    approvalRate7d: 0,
    approvalRate30d: 0,
    trend: 'stable',
    trendDelta: 0,
  };
}

function createEmptyActivity(): AgentActivity {
  return {
    status: 'idle',
    currentTask: null,
    lastActivity: null,
  };
}

function createEmptyQueueSummary(): QueueSummaryData {
  return {
    pendingCount: 0,
    draftCount: 0,
    approvedTodayCount: 0,
  };
}

export function useDashboardStats(options: UseDashboardStatsOptions = {}): UseDashboardStatsResult {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  const [agentActivity, setAgentActivity] = useState<AgentActivity>(createEmptyActivity());
  const [queueSummary, setQueueSummary] = useState<QueueSummaryData>(createEmptyQueueSummary());
  const [quickStats, setQuickStats] = useState<QuickStatsData>(createEmptyStats());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const isMountedRef = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStats = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/dashboard/stats');

      if (!isMountedRef.current) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as DashboardStatsResponse;

      if (!isMountedRef.current) return;

      setAgentActivity(data.agentActivity);
      setQueueSummary(data.queueSummary);
      setQuickStats(data.quickStats);
      setAlerts(data.alerts);
      setLastUpdated(new Date(data.timestamp));
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch dashboard stats'));
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
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    void fetchStats();

    intervalRef.current = setInterval(() => {
      void fetchStats();
    }, pollInterval);

    return (): void => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, pollInterval, fetchStats]);

  const refetch = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await fetchStats();
  }, [fetchStats]);

  return {
    agentActivity,
    queueSummary,
    quickStats,
    alerts,
    isLoading,
    error,
    lastUpdated,
    refetch,
  };
}
