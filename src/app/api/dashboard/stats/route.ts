import { NextResponse } from 'next/server';
import { getDb } from '@/db/connection';
import type { AgentStatusType } from '@/components/dashboard/AgentStatus';
import type { QueueSummaryData } from '@/components/dashboard/QueueSummary';
import type { QuickStatsData } from '@/components/dashboard/QuickStats';
import type { Alert, AlertSource, AlertType } from '@/components/dashboard/Alerts';

export interface DashboardStatsResponse {
  agentActivity: {
    status: AgentStatusType;
    currentTask: string | null;
    lastActivity: string | null;
    progress?: number;
    subTasks?: string[];
  };
  queueSummary: QueueSummaryData;
  quickStats: QuickStatsData;
  alerts: Alert[];
  timestamp: string;
}

interface CountResult {
  count: number;
}

interface SumResult {
  total: number | null;
}

function getStartOfDay(): string {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function getStartOfWeek(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const diff = now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  now.setUTCDate(diff);
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function getStartOfMonth(): string {
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function getStartOfPreviousWeek(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const diff = now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1) - 7;
  now.setUTCDate(diff);
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function getQueueSummary(db: ReturnType<typeof getDb>): QueueSummaryData {
  const pendingStmt = db.prepare(`SELECT COUNT(*) as count FROM posts WHERE status = 'pending'`);
  const pendingResult = pendingStmt.get() as CountResult;

  const draftStmt = db.prepare(`SELECT COUNT(*) as count FROM posts WHERE status = 'draft'`);
  const draftResult = draftStmt.get() as CountResult;

  const todayStart = getStartOfDay();
  const approvedTodayStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback
    WHERE action = 'approve' AND created_at >= ?
  `);
  const approvedTodayResult = approvedTodayStmt.get(todayStart) as CountResult;

  return {
    pendingCount: pendingResult.count,
    draftCount: draftResult.count,
    approvedTodayCount: approvedTodayResult.count,
  };
}

function getQuickStats(db: ReturnType<typeof getDb>): QuickStatsData {
  const todayStart = getStartOfDay();
  const weekStart = getStartOfWeek();
  const monthStart = getStartOfMonth();
  const prevWeekStart = getStartOfPreviousWeek();

  const postsTodayStmt = db.prepare(`
    SELECT COUNT(*) as count FROM posts WHERE created_at >= ?
  `);
  const postsTodayResult = postsTodayStmt.get(todayStart) as CountResult;

  const approvedThisWeekStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback WHERE action = 'approve' AND created_at >= ?
  `);
  const approvedThisWeekResult = approvedThisWeekStmt.get(weekStart) as CountResult;

  const totalFeedbackThisWeekStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback WHERE action IN ('approve', 'reject') AND created_at >= ?
  `);
  const totalFeedbackThisWeekResult = totalFeedbackThisWeekStmt.get(weekStart) as CountResult;

  const approvedThisMonthStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback WHERE action = 'approve' AND created_at >= ?
  `);
  const approvedThisMonthResult = approvedThisMonthStmt.get(monthStart) as CountResult;

  const totalFeedbackThisMonthStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback WHERE action IN ('approve', 'reject') AND created_at >= ?
  `);
  const totalFeedbackThisMonthResult = totalFeedbackThisMonthStmt.get(monthStart) as CountResult;

  const approvedPrevWeekStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback
    WHERE action = 'approve' AND created_at >= ? AND created_at < ?
  `);
  const approvedPrevWeekResult = approvedPrevWeekStmt.get(prevWeekStart, weekStart) as CountResult;

  const totalFeedbackPrevWeekStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback
    WHERE action IN ('approve', 'reject') AND created_at >= ? AND created_at < ?
  `);
  const totalFeedbackPrevWeekResult = totalFeedbackPrevWeekStmt.get(
    prevWeekStart,
    weekStart
  ) as CountResult;

  const approvalRate7d =
    totalFeedbackThisWeekResult.count > 0
      ? (approvedThisWeekResult.count / totalFeedbackThisWeekResult.count) * 100
      : 0;

  const approvalRate30d =
    totalFeedbackThisMonthResult.count > 0
      ? (approvedThisMonthResult.count / totalFeedbackThisMonthResult.count) * 100
      : 0;

  const prevWeekRate =
    totalFeedbackPrevWeekResult.count > 0
      ? (approvedPrevWeekResult.count / totalFeedbackPrevWeekResult.count) * 100
      : 0;

  const trendDelta = Math.round(approvalRate7d - prevWeekRate);
  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (trendDelta > 2) {
    trend = 'up';
  } else if (trendDelta < -2) {
    trend = 'down';
  }

  return {
    postsToday: postsTodayResult.count,
    approvalRate7d: Math.round(approvalRate7d),
    approvalRate30d: Math.round(approvalRate30d),
    trend,
    trendDelta: Math.abs(trendDelta),
  };
}

function getAlerts(db: ReturnType<typeof getDb>): Alert[] {
  const alerts: Alert[] = [];

  const pendingStmt = db.prepare(`SELECT COUNT(*) as count FROM posts WHERE status = 'pending'`);
  const pendingResult = pendingStmt.get() as CountResult;
  if (pendingResult.count >= 10) {
    alerts.push({
      id: 'content-ready',
      type: 'info' as AlertType,
      message: `${pendingResult.count} posts ready for review`,
      timestamp: new Date().toISOString(),
      source: 'generation' as AlertSource,
      action: { label: 'Review Queue', href: '/queue' },
    });
  }

  const monthlyBudgetStr = process.env.ANTHROPIC_MONTHLY_BUDGET_USD;
  if (monthlyBudgetStr) {
    const monthlyBudget = parseFloat(monthlyBudgetStr);
    const monthStart = getStartOfMonth();
    const costStmt = db.prepare(`
      SELECT SUM(cost_usd) as total FROM cost_tracking
      WHERE api_name = 'anthropic' AND created_at >= ?
    `);
    const costResult = costStmt.get(monthStart) as SumResult;
    const usedCost = costResult.total ?? 0;
    const usedPercent = Math.round((usedCost / monthlyBudget) * 100);

    if (usedPercent >= 95) {
      alerts.push({
        id: 'budget-exceeded',
        type: 'error' as AlertType,
        title: 'Budget Exceeded',
        message: 'Anthropic budget exceeded. Operations paused.',
        timestamp: new Date().toISOString(),
        source: 'budget' as AlertSource,
        action: { label: 'View Settings', href: '/settings' },
      });
    } else if (usedPercent >= 80) {
      alerts.push({
        id: 'budget-warning',
        type: 'warning' as AlertType,
        title: 'Budget Warning',
        message: `Anthropic budget at ${usedPercent}% of monthly limit`,
        timestamp: new Date().toISOString(),
        source: 'budget' as AlertSource,
        action: { label: 'View Settings', href: '/settings' },
      });
    }
  }

  const failingAccountsStmt = db.prepare(`
    SELECT COUNT(*) as count FROM accounts WHERE health_status = 'failing'
  `);
  const failingAccountsResult = failingAccountsStmt.get() as CountResult;
  if (failingAccountsResult.count > 0) {
    alerts.push({
      id: 'scraping-failures',
      type: 'warning' as AlertType,
      message: `${failingAccountsResult.count} account${failingAccountsResult.count > 1 ? 's' : ''} failing to scrape`,
      timestamp: new Date().toISOString(),
      source: 'scraping' as AlertSource,
    });
  }

  return alerts;
}

export function GET(): NextResponse<DashboardStatsResponse> {
  try {
    const db = getDb();

    const queueSummary = getQueueSummary(db);
    const quickStats = getQuickStats(db);
    const alerts = getAlerts(db);

    const response: DashboardStatsResponse = {
      agentActivity: {
        status: 'idle',
        currentTask: null,
        lastActivity: null,
      },
      queueSummary,
      quickStats,
      alerts,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        agentActivity: {
          status: 'error' as const,
          currentTask: null,
          lastActivity: null,
        },
        queueSummary: {
          pendingCount: 0,
          draftCount: 0,
          approvedTodayCount: 0,
        },
        quickStats: {
          postsToday: 0,
          approvalRate7d: 0,
          approvalRate30d: 0,
          trend: 'stable' as const,
          trendDelta: 0,
        },
        alerts: [
          {
            id: 'api-error',
            type: 'error' as AlertType,
            title: 'API Error',
            message: `Failed to fetch dashboard stats: ${errorMessage}`,
            timestamp: new Date().toISOString(),
            source: 'system' as AlertSource,
          },
        ],
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
