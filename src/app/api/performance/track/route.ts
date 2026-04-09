import { NextRequest, NextResponse } from 'next/server';
import {
  createPostPerformance,
  getPostPerformanceByPostId,
  updatePostPerformanceMetrics,
  type PostPerformance,
} from '@/db/models/post-performance';
import { getTweetMetrics, extractTweetId, isTwitterConfigured } from '@/lib/twitter/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:performance:track');

export const dynamic = 'force-dynamic';

interface TrackRequest {
  postId: number;
  tweetUrl?: string;
  tweetId?: string;
}

interface TrackResponse {
  success: boolean;
  performance?: PostPerformance;
  message?: string;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

/**
 * POST /api/performance/track
 *
 * Start tracking performance for a posted tweet.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<TrackResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as TrackRequest;

    if (!body.postId) {
      return NextResponse.json({ error: 'postId is required' }, { status: 400 });
    }

    if (!body.tweetUrl && !body.tweetId) {
      return NextResponse.json(
        { error: 'Either tweetUrl or tweetId is required' },
        { status: 400 }
      );
    }

    // Extract tweet ID from URL if provided
    const tweetId = body.tweetId ?? (body.tweetUrl ? extractTweetId(body.tweetUrl) : null);
    if (!tweetId) {
      return NextResponse.json({ error: 'Invalid tweet URL or ID' }, { status: 400 });
    }

    // Check if already tracking
    let performance = getPostPerformanceByPostId(body.postId);

    if (performance) {
      // Update existing tracking record
      if (isTwitterConfigured()) {
        try {
          const metrics = await getTweetMetrics(tweetId);
          performance = updatePostPerformanceMetrics(performance.id, metrics);
        } catch (metricsError) {
          logger.warn('Failed to fetch initial metrics', { tweetId, error: metricsError });
        }
      }

      return NextResponse.json({
        success: true,
        performance: performance ?? undefined,
        message: 'Already tracking - metrics updated',
      });
    }

    // Create new tracking record
    performance = createPostPerformance({
      postId: body.postId,
      tweetId,
      tweetUrl: body.tweetUrl ?? `https://x.com/i/status/${tweetId}`,
    });

    // Fetch initial metrics if Twitter is configured
    if (isTwitterConfigured()) {
      try {
        const metrics = await getTweetMetrics(tweetId);
        performance = updatePostPerformanceMetrics(performance.id, metrics);
      } catch (metricsError) {
        logger.warn('Failed to fetch initial metrics', { tweetId, error: metricsError });
      }
    }

    logger.info('Started tracking post performance', {
      postId: body.postId,
      tweetId,
      performanceId: performance?.id,
    });

    return NextResponse.json({
      success: true,
      performance: performance ?? undefined,
      message: 'Tracking started',
    });
  } catch (error) {
    logger.error('Failed to track post performance', { error });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
