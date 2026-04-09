'use client';

import { useState, useCallback } from 'react';
import { AgentStatus } from '@/components/dashboard/AgentStatus';
import { QueueSummary } from '@/components/dashboard/QueueSummary';
import { QuickStats } from '@/components/dashboard/QuickStats';
import { Alerts } from '@/components/dashboard/Alerts';
import { ErrorSummary } from '@/components/dashboard/ErrorSummary';
import { CostWidget } from '@/components/dashboard/CostWidget';
import { VoiceHealthIndicator } from '@/components/dashboard/VoiceHealthIndicator';
import { ConfigStatusPanel } from '@/components/dashboard/ConfigStatusPanel';
import { SchedulerWidget } from '@/components/dashboard/SchedulerWidget';
import { RejectionStatsWidget } from '@/components/dashboard/RejectionStatsWidget';
import { SourcesWidget } from '@/components/dashboard/SourcesWidget';
import { PerformanceWidget } from '@/components/dashboard/PerformanceWidget';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useCostData } from '@/hooks/useCostData';

export default function Home(): React.ReactElement {
  const {
    agentActivity,
    queueSummary,
    quickStats,
    alerts: fetchedAlerts,
    isLoading,
    error,
    lastUpdated,
  } = useDashboardStats({ pollInterval: 10000 });

  const { costData } = useCostData({ pollInterval: 30000 });

  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());

  const alerts = fetchedAlerts.filter((a) => !dismissedAlertIds.has(a.id));

  const dismissAlert = useCallback((alertId: string): void => {
    setDismissedAlertIds((prev) => new Set([...prev, alertId]));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
          <p className="text-red-400 text-sm">Failed to fetch latest data: {error.message}</p>
        </div>
      )}

      {/* Agent Status Section */}
      <section className="rounded-lg bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">Agent Status</h3>
          {lastUpdated && (
            <span className="text-xs text-gray-500">Updated {formatTimeAgo(lastUpdated)}</span>
          )}
        </div>
        <AgentStatus activity={agentActivity} />
      </section>

      {/* Quick Stats Section */}
      <section>
        <h3 className="text-lg font-medium text-white mb-4">Quick Stats</h3>
        <QuickStats stats={quickStats} />
      </section>

      {/* Queue Summary Section */}
      <section className="rounded-lg bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">Queue Summary</h3>
          <a href="/queue" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
            View all →
          </a>
        </div>
        <QueueSummary summary={queueSummary} />
      </section>

      {/* Scheduler, Sources, Performance & Rejection Stats Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SchedulerWidget pollInterval={30000} />
        <SourcesWidget pollInterval={60000} />
        <PerformanceWidget pollInterval={60000} />
        <RejectionStatsWidget pollInterval={60000} />
      </section>

      {/* Alerts Section */}
      <section className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Alerts & Notifications</h3>
        <Alerts alerts={alerts} onDismiss={dismissAlert} />
      </section>

      {/* Configuration Status Section */}
      <section className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Configuration Status</h3>
        <ConfigStatusPanel pollInterval={60000} />
      </section>

      {/* System Health Section */}
      <section className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">System Health</h3>
        <div className="space-y-4">
          <ErrorSummary pollInterval={30000} />
        </div>
      </section>

      {/* Voice Health Section */}
      <section className="rounded-lg bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">Voice Health</h3>
          <a
            href="/analytics"
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Analytics →
          </a>
        </div>
        <VoiceHealthIndicator pollInterval={60000} />
      </section>

      {/* Cost Widget Section */}
      <section>
        <CostWidget data={costData} />
      </section>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 10) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  return `${diffHours}h ago`;
}
