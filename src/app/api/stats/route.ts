import { NextResponse } from 'next/server';
import { getDb } from '@/db/connection';

export interface StatsResponse {
  queue: {
    pendingCount: number;
    draftCount: number;
    approvedTodayCount: number;
  };
  posts: {
    totalCount: number;
    approvedCount: number;
    rejectedCount: number;
    postsToday: number;
  };
  feedback: {
    totalCount: number;
    approvalRate7d: number;
    approvalRate30d: number;
    trend: 'up' | 'down' | 'stable';
    trendDelta: number;
  };
  patterns: {
    totalCount: number;
    voicePatterns: number;
    rejectionPatterns: number;
    editPatterns: number;
  };
  sources: {
    totalCount: number;
    likesCount: number;
    bookmarksCount: number;
    accountTweetsCount: number;
  };
  accounts: {
    totalCount: number;
    healthyCount: number;
    degradedCount: number;
    failingCount: number;
  };
  costs: {
    todayUsd: number;
    monthUsd: number;
    budgetLimitUsd: number | null;
    budgetUsedPercent: number | null;
  };
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

export function GET(): NextResponse<StatsResponse | { error: string }> {
  try {
    const db = getDb();
    const todayStart = getStartOfDay();
    const weekStart = getStartOfWeek();
    const monthStart = getStartOfMonth();
    const prevWeekStart = getStartOfPreviousWeek();

    // Queue stats
    const pendingStmt = db.prepare(`SELECT COUNT(*) as count FROM posts WHERE status = 'pending'`);
    const pendingResult = pendingStmt.get() as CountResult;

    const draftStmt = db.prepare(`SELECT COUNT(*) as count FROM posts WHERE status = 'draft'`);
    const draftResult = draftStmt.get() as CountResult;

    const approvedTodayStmt = db.prepare(`
      SELECT COUNT(*) as count FROM feedback
      WHERE action = 'approve' AND created_at >= ?
    `);
    const approvedTodayResult = approvedTodayStmt.get(todayStart) as CountResult;

    // Posts stats
    const totalPostsStmt = db.prepare(`SELECT COUNT(*) as count FROM posts`);
    const totalPostsResult = totalPostsStmt.get() as CountResult;

    const approvedPostsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM posts WHERE status = 'approved'`
    );
    const approvedPostsResult = approvedPostsStmt.get() as CountResult;

    const rejectedPostsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM posts WHERE status = 'rejected'`
    );
    const rejectedPostsResult = rejectedPostsStmt.get() as CountResult;

    const postsTodayStmt = db.prepare(`SELECT COUNT(*) as count FROM posts WHERE created_at >= ?`);
    const postsTodayResult = postsTodayStmt.get(todayStart) as CountResult;

    // Feedback stats for approval rates
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
    const approvedPrevWeekResult = approvedPrevWeekStmt.get(
      prevWeekStart,
      weekStart
    ) as CountResult;

    const totalFeedbackPrevWeekStmt = db.prepare(`
      SELECT COUNT(*) as count FROM feedback
      WHERE action IN ('approve', 'reject') AND created_at >= ? AND created_at < ?
    `);
    const totalFeedbackPrevWeekResult = totalFeedbackPrevWeekStmt.get(
      prevWeekStart,
      weekStart
    ) as CountResult;

    const totalFeedbackStmt = db.prepare(`SELECT COUNT(*) as count FROM feedback`);
    const totalFeedbackResult = totalFeedbackStmt.get() as CountResult;

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

    // Patterns stats
    const totalPatternsStmt = db.prepare(`SELECT COUNT(*) as count FROM patterns`);
    const totalPatternsResult = totalPatternsStmt.get() as CountResult;

    const voicePatternsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM patterns WHERE pattern_type = 'voice'`
    );
    const voicePatternsResult = voicePatternsStmt.get() as CountResult;

    const rejectionPatternsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM patterns WHERE pattern_type = 'rejection'`
    );
    const rejectionPatternsResult = rejectionPatternsStmt.get() as CountResult;

    const editPatternsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM patterns WHERE pattern_type = 'edit'`
    );
    const editPatternsResult = editPatternsStmt.get() as CountResult;

    // Sources stats
    const totalSourcesStmt = db.prepare(`SELECT COUNT(*) as count FROM sources`);
    const totalSourcesResult = totalSourcesStmt.get() as CountResult;

    const likesStmt = db.prepare(
      `SELECT COUNT(*) as count FROM sources WHERE source_type = 'like'`
    );
    const likesResult = likesStmt.get() as CountResult;

    const bookmarksStmt = db.prepare(
      `SELECT COUNT(*) as count FROM sources WHERE source_type = 'bookmark'`
    );
    const bookmarksResult = bookmarksStmt.get() as CountResult;

    const accountTweetsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM sources WHERE source_type = 'account_tweet'`
    );
    const accountTweetsResult = accountTweetsStmt.get() as CountResult;

    // Accounts stats
    const totalAccountsStmt = db.prepare(`SELECT COUNT(*) as count FROM accounts`);
    const totalAccountsResult = totalAccountsStmt.get() as CountResult;

    const healthyAccountsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM accounts WHERE health_status = 'healthy'`
    );
    const healthyAccountsResult = healthyAccountsStmt.get() as CountResult;

    const degradedAccountsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM accounts WHERE health_status = 'degraded'`
    );
    const degradedAccountsResult = degradedAccountsStmt.get() as CountResult;

    const failingAccountsStmt = db.prepare(
      `SELECT COUNT(*) as count FROM accounts WHERE health_status = 'failing'`
    );
    const failingAccountsResult = failingAccountsStmt.get() as CountResult;

    // Costs stats
    const todayCostStmt = db.prepare(`
      SELECT SUM(cost_usd) as total FROM cost_tracking WHERE created_at >= ?
    `);
    const todayCostResult = todayCostStmt.get(todayStart) as SumResult;

    const monthCostStmt = db.prepare(`
      SELECT SUM(cost_usd) as total FROM cost_tracking WHERE created_at >= ?
    `);
    const monthCostResult = monthCostStmt.get(monthStart) as SumResult;

    const budgetLimitStr = process.env.ANTHROPIC_MONTHLY_BUDGET_USD;
    const budgetLimitUsd = budgetLimitStr ? parseFloat(budgetLimitStr) : null;
    const monthUsd = monthCostResult.total ?? 0;
    const budgetUsedPercent =
      budgetLimitUsd !== null ? Math.round((monthUsd / budgetLimitUsd) * 100) : null;

    const response: StatsResponse = {
      queue: {
        pendingCount: pendingResult.count,
        draftCount: draftResult.count,
        approvedTodayCount: approvedTodayResult.count,
      },
      posts: {
        totalCount: totalPostsResult.count,
        approvedCount: approvedPostsResult.count,
        rejectedCount: rejectedPostsResult.count,
        postsToday: postsTodayResult.count,
      },
      feedback: {
        totalCount: totalFeedbackResult.count,
        approvalRate7d: Math.round(approvalRate7d),
        approvalRate30d: Math.round(approvalRate30d),
        trend,
        trendDelta: Math.abs(trendDelta),
      },
      patterns: {
        totalCount: totalPatternsResult.count,
        voicePatterns: voicePatternsResult.count,
        rejectionPatterns: rejectionPatternsResult.count,
        editPatterns: editPatternsResult.count,
      },
      sources: {
        totalCount: totalSourcesResult.count,
        likesCount: likesResult.count,
        bookmarksCount: bookmarksResult.count,
        accountTweetsCount: accountTweetsResult.count,
      },
      accounts: {
        totalCount: totalAccountsResult.count,
        healthyCount: healthyAccountsResult.count,
        degradedCount: degradedAccountsResult.count,
        failingCount: failingAccountsResult.count,
      },
      costs: {
        todayUsd: todayCostResult.total ?? 0,
        monthUsd,
        budgetLimitUsd,
        budgetUsedPercent,
      },
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to fetch stats: ${errorMessage}` }, { status: 500 });
  }
}
