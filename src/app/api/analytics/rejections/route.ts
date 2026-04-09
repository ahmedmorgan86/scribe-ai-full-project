import { NextResponse } from 'next/server';
import {
  getAllRejectionStats,
  getTopRejectionReasons,
  getTotalRejections,
  getRejectionTrends,
  getRecentRejectionsByReason,
  type RejectionStat,
  type RejectionTrend,
} from '@/db/models/rejection-stats';
import { REJECTION_REASONS } from '@/lib/constants/rejection-reasons';

export const dynamic = 'force-dynamic';

interface RejectionAnalyticsResponse {
  total: number;
  stats: RejectionStat[];
  trends: RejectionTrend[];
  topReasons: Array<{
    reason: string;
    label: string;
    category: string;
    count: number;
    percentage: number;
  }>;
  recentActivity: RejectionStat[];
}

export function GET(): NextResponse<RejectionAnalyticsResponse> {
  const total = getTotalRejections();
  const stats = getAllRejectionStats();
  const trends = getRejectionTrends();
  const topReasonsRaw = getTopRejectionReasons(5);
  const recentActivity = getRecentRejectionsByReason(7);

  // Enrich top reasons with labels and categories
  const topReasons = topReasonsRaw.map((stat) => {
    const reasonDef = REJECTION_REASONS.find((r) => r.id === stat.reason);
    const percentage = total > 0 ? Math.round((stat.count / total) * 100) : 0;
    return {
      reason: stat.reason,
      label: reasonDef?.label ?? stat.reason,
      category: reasonDef?.category ?? 'other',
      count: stat.count,
      percentage,
    };
  });

  return NextResponse.json({
    total,
    stats,
    trends,
    topReasons,
    recentActivity,
  });
}
