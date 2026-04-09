import { getDb } from '@/db/connection';
import type { QuickStatsData } from '@/components/dashboard/QuickStats';

interface FeedbackCountRow {
  count: number;
}

export function calculateQuickStats(): QuickStatsData {
  const postsToday = getPostsCreatedToday();
  const approvalRate7d = getApprovalRateForDays(7);
  const approvalRate30d = getApprovalRateForDays(30);
  const previousPeriodRate = getApprovalRateForDays(7, 7);
  const { trend, delta } = calculateTrend(approvalRate7d, previousPeriodRate);

  return {
    postsToday,
    approvalRate7d,
    approvalRate30d,
    trend,
    trendDelta: delta,
  };
}

function getPostsCreatedToday(): number {
  const db = getDb();
  const today = getDateString(new Date());

  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM posts
    WHERE DATE(created_at) = DATE(?)
  `);

  const result = stmt.get(today) as FeedbackCountRow;
  return result.count;
}

function getApprovalRateForDays(days: number, offsetDays = 0): number {
  const db = getDb();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - offsetDays);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = getDateString(startDate);
  const endDateStr = getDateString(endDate);

  const totalStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback
    WHERE DATE(created_at) >= DATE(?)
      AND DATE(created_at) <= DATE(?)
      AND action IN ('approve', 'reject')
  `);

  const approveStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback
    WHERE DATE(created_at) >= DATE(?)
      AND DATE(created_at) <= DATE(?)
      AND action = 'approve'
  `);

  const totalResult = totalStmt.get(startDateStr, endDateStr) as FeedbackCountRow;
  const approveResult = approveStmt.get(startDateStr, endDateStr) as FeedbackCountRow;

  const total = totalResult.count;
  const approves = approveResult.count;

  if (total === 0) return 0;
  return Math.round((approves / total) * 100);
}

function calculateTrend(
  currentRate: number,
  previousRate: number
): { trend: 'up' | 'down' | 'stable'; delta: number } {
  const delta = currentRate - previousRate;
  const threshold = 5;

  if (delta > threshold) {
    return { trend: 'up', delta: Math.round(delta) };
  } else if (delta < -threshold) {
    return { trend: 'down', delta: Math.round(delta) };
  }
  return { trend: 'stable', delta: Math.round(delta) };
}

function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

export interface DetailedStats {
  postsToday: number;
  postsThisWeek: number;
  postsThisMonth: number;
  totalPosts: number;
  approvalRate7d: number;
  approvalRate30d: number;
  rejectRate7d: number;
  rejectRate30d: number;
  editRate7d: number;
  editRate30d: number;
  trend: 'up' | 'down' | 'stable';
  trendDelta: number;
}

export function calculateDetailedStats(): DetailedStats {
  const quickStats = calculateQuickStats();
  const db = getDb();

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date();
  monthStart.setDate(monthStart.getDate() - 30);

  const postsThisWeekResult = db
    .prepare(`SELECT COUNT(*) as count FROM posts WHERE DATE(created_at) >= DATE(?)`)
    .get(getDateString(weekStart)) as FeedbackCountRow;

  const postsThisMonthResult = db
    .prepare(`SELECT COUNT(*) as count FROM posts WHERE DATE(created_at) >= DATE(?)`)
    .get(getDateString(monthStart)) as FeedbackCountRow;

  const totalPostsResult = db
    .prepare(`SELECT COUNT(*) as count FROM posts`)
    .get() as FeedbackCountRow;

  return {
    postsToday: quickStats.postsToday,
    postsThisWeek: postsThisWeekResult.count,
    postsThisMonth: postsThisMonthResult.count,
    totalPosts: totalPostsResult.count,
    approvalRate7d: quickStats.approvalRate7d,
    approvalRate30d: quickStats.approvalRate30d,
    rejectRate7d: getActionRateForDays('reject', 7),
    rejectRate30d: getActionRateForDays('reject', 30),
    editRate7d: getActionRateForDays('edit', 7),
    editRate30d: getActionRateForDays('edit', 30),
    trend: quickStats.trend,
    trendDelta: quickStats.trendDelta,
  };
}

function getActionRateForDays(action: string, days: number): number {
  const db = getDb();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = getDateString(startDate);
  const todayStr = getDateString(new Date());

  const totalStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback
    WHERE DATE(created_at) >= DATE(?)
      AND DATE(created_at) <= DATE(?)
  `);

  const actionStmt = db.prepare(`
    SELECT COUNT(*) as count FROM feedback
    WHERE DATE(created_at) >= DATE(?)
      AND DATE(created_at) <= DATE(?)
      AND action = ?
  `);

  const totalResult = totalStmt.get(startDateStr, todayStr) as FeedbackCountRow;
  const actionResult = actionStmt.get(startDateStr, todayStr, action) as FeedbackCountRow;

  const total = totalResult.count;
  const actionCount = actionResult.count;

  if (total === 0) return 0;
  return Math.round((actionCount / total) * 100);
}
