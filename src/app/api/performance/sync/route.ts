import { NextResponse } from 'next/server';
import { getPostsNeedingSync, updatePostPerformanceMetrics } from '@/db/models/post-performance';
import { getTweetMetrics, isTwitterConfigured } from '@/lib/twitter/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:performance:sync');

export const dynamic = 'force-dynamic';

interface SyncResult {
  id: number;
  tweetId: string | null;
  success: boolean;
  error?: string;
  metrics?: {
    likes: number;
    retweets: number;
    replies: number;
    impressions: number;
  };
}

interface SyncResponse {
  success: boolean;
  synced: number;
  failed: number;
  results: SyncResult[];
}

interface ErrorResponse {
  error: string;
}

/**
 * POST /api/performance/sync
 *
 * Sync performance metrics for all tracked posts that need updating.
 * Intended to be called by a cron job or manually.
 */
export async function POST(): Promise<NextResponse<SyncResponse | ErrorResponse>> {
  try {
    if (!isTwitterConfigured()) {
      return NextResponse.json({
        success: false,
        synced: 0,
        failed: 0,
        results: [],
      });
    }

    // Get posts needing sync (not synced in last 24 hours)
    const postsToSync = getPostsNeedingSync(24 * 60 * 60 * 1000);

    if (postsToSync.length === 0) {
      return NextResponse.json({
        success: true,
        synced: 0,
        failed: 0,
        results: [],
      });
    }

    const results: SyncResult[] = [];
    let synced = 0;
    let failed = 0;

    // Process each post
    for (const post of postsToSync) {
      if (!post.tweetId) {
        results.push({
          id: post.id,
          tweetId: null,
          success: false,
          error: 'No tweet ID',
        });
        failed++;
        continue;
      }

      try {
        const metrics = await getTweetMetrics(post.tweetId);
        updatePostPerformanceMetrics(post.id, metrics);

        results.push({
          id: post.id,
          tweetId: post.tweetId,
          success: true,
          metrics,
        });
        synced++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          id: post.id,
          tweetId: post.tweetId,
          success: false,
          error: errorMessage,
        });
        failed++;
      }

      // Rate limiting: wait 100ms between requests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('Performance sync completed', { synced, failed, total: postsToSync.length });

    return NextResponse.json({
      success: true,
      synced,
      failed,
      results,
    });
  } catch (error) {
    logger.error('Performance sync failed', { error });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
