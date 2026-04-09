import { NextResponse } from 'next/server';
import {
  getPerformanceStats,
  getTopPerformingPosts,
  listTrackedPosts,
  type PerformanceStats,
  type PostPerformance,
} from '@/db/models/post-performance';
import { getPostById } from '@/db/models/posts';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:performance:stats');

export const dynamic = 'force-dynamic';

interface TopPost {
  id: number;
  postId: number;
  content: string;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  performanceScore: number;
  tweetUrl: string | null;
}

interface StatsResponse {
  stats: PerformanceStats;
  topPosts: TopPost[];
  recentPosts: PostPerformance[];
}

interface ErrorResponse {
  error: string;
}

/**
 * GET /api/performance/stats
 *
 * Returns aggregate performance statistics and top performing posts.
 */
export function GET(): NextResponse<StatsResponse | ErrorResponse> {
  try {
    const stats = getPerformanceStats();
    const topPerforming = getTopPerformingPosts(5);
    const recentPosts = listTrackedPosts(10);

    // Enrich top posts with content preview
    const topPosts: TopPost[] = topPerforming.map((perf) => {
      const post = getPostById(perf.postId);
      return {
        id: perf.id,
        postId: perf.postId,
        content: post?.content?.substring(0, 100) ?? 'Unknown',
        likes: perf.likes,
        retweets: perf.retweets,
        replies: perf.replies,
        impressions: perf.impressions,
        performanceScore: perf.performanceScore ?? 0,
        tweetUrl: perf.tweetUrl,
      };
    });

    return NextResponse.json({
      stats,
      topPosts,
      recentPosts,
    });
  } catch (error) {
    logger.error('Failed to get performance stats', { error });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
