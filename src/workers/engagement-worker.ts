import { getDb } from '@/db/connection';
import { createWorkerLogger, withRetry } from './worker-utils';
import { updatePatternDecayFromEngagement } from '@/lib/learning/engagement-patterns';

const logger = createWorkerLogger('engagement-worker');

export interface PostEngagement {
  postId: number;
  twitterId: string;
  likes: number;
  retweets: number;
  impressions: number;
}

export interface EngagementUpdate {
  twitterId: string;
  likes: number;
  retweets: number;
  impressions: number;
}

export interface TwitterApiClient {
  getTweetMetrics(tweetIds: string[]): Promise<EngagementUpdate[]>;
}

/**
 * Gets posts that need engagement updates.
 * Returns posts with twitter_id that were posted in the last 7 days.
 */
export function getPostsNeedingEngagementUpdate(): Array<{
  postId: number;
  twitterId: string;
  lastUpdated: string | null;
}> {
  const db = getDb();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const stmt = db.prepare(`
    SELECT id as postId, twitter_id as twitterId, engagement_updated_at as lastUpdated
    FROM posts
    WHERE twitter_id IS NOT NULL
    AND posted_at >= ?
    AND status = 'posted'
    ORDER BY posted_at DESC
  `);

  return stmt.all(sevenDaysAgo.toISOString()) as Array<{
    postId: number;
    twitterId: string;
    lastUpdated: string | null;
  }>;
}

/**
 * Updates engagement metrics for a post.
 */
export function updatePostEngagement(update: PostEngagement): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE posts
    SET likes = ?, retweets = ?, impressions = ?, engagement_updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(update.likes, update.retweets, update.impressions, update.postId);
}

/**
 * Gets engagement for a specific post.
 */
export function getPostEngagement(postId: number): PostEngagement | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id as postId, twitter_id as twitterId, likes, retweets, impressions
    FROM posts
    WHERE id = ?
  `);
  const row = stmt.get(postId) as PostEngagement | undefined;
  return row ?? null;
}

/**
 * Calculates total engagement score for a post.
 */
export function calculateEngagementScore(engagement: PostEngagement): number {
  // Weight: likes=1, retweets=3, impressions=0.01
  return engagement.likes + engagement.retweets * 3 + engagement.impressions * 0.01;
}

/**
 * Gets patterns used in a post from reasoning.
 */
function getPatternIdsFromPost(postId: number): number[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT reasoning FROM posts WHERE id = ?`);
  const row = stmt.get(postId) as { reasoning: string } | undefined;

  if (!row) return [];

  try {
    const reasoning = JSON.parse(row.reasoning) as { patternsUsed?: number[] };
    return reasoning.patternsUsed ?? [];
  } catch {
    return [];
  }
}

/**
 * Processes engagement updates for a batch of posts.
 */
export async function processEngagementBatch(
  client: TwitterApiClient,
  posts: Array<{ postId: number; twitterId: string }>
): Promise<{
  updated: number;
  failed: number;
  patternUpdates: number;
}> {
  if (posts.length === 0) {
    return { updated: 0, failed: 0, patternUpdates: 0 };
  }

  logger.info(`Processing engagement for ${posts.length} posts`);

  const tweetIds = posts.map((p) => p.twitterId);

  const result = await withRetry(
    () => client.getTweetMetrics(tweetIds),
    { maxAttempts: 3, initialDelayMs: 1000 },
    logger,
    'Twitter API fetch'
  );

  if (!result.success || !result.result) {
    logger.error('Failed to fetch engagement metrics', result.error);
    return { updated: 0, failed: posts.length, patternUpdates: 0 };
  }

  const metricsMap = new Map(result.result.map((m) => [m.twitterId, m]));
  let updated = 0;
  let patternUpdates = 0;

  for (const post of posts) {
    const metrics = metricsMap.get(post.twitterId);
    if (!metrics) {
      logger.warn(`No metrics found for tweet ${post.twitterId}`);
      continue;
    }

    updatePostEngagement({
      postId: post.postId,
      twitterId: post.twitterId,
      likes: metrics.likes,
      retweets: metrics.retweets,
      impressions: metrics.impressions,
    });

    // Update pattern decay based on engagement
    const totalEngagement = metrics.likes + metrics.retweets * 3;
    const patternIds = getPatternIdsFromPost(post.postId);

    if (patternIds.length > 0) {
      patternUpdates += updatePatternDecayFromEngagement(patternIds, totalEngagement);
    }

    updated++;
  }

  logger.info(`Engagement update complete`, { updated, patternUpdates });
  return { updated, failed: posts.length - updated, patternUpdates };
}

/**
 * Runs the engagement worker once.
 */
export async function runEngagementWorker(client: TwitterApiClient): Promise<{
  postsProcessed: number;
  updated: number;
  failed: number;
  patternUpdates: number;
}> {
  logger.info('Starting engagement worker run');

  const posts = getPostsNeedingEngagementUpdate();
  logger.info(`Found ${posts.length} posts needing engagement update`);

  if (posts.length === 0) {
    return { postsProcessed: 0, updated: 0, failed: 0, patternUpdates: 0 };
  }

  // Process in batches of 100 (Twitter API limit)
  const batchSize = 100;
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalPatternUpdates = 0;

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    const result = await processEngagementBatch(client, batch);
    totalUpdated += result.updated;
    totalFailed += result.failed;
    totalPatternUpdates += result.patternUpdates;
  }

  logger.info('Engagement worker run complete', {
    postsProcessed: posts.length,
    updated: totalUpdated,
    failed: totalFailed,
    patternUpdates: totalPatternUpdates,
  });

  return {
    postsProcessed: posts.length,
    updated: totalUpdated,
    failed: totalFailed,
    patternUpdates: totalPatternUpdates,
  };
}

/**
 * Gets engagement statistics.
 */
export function getEngagementStats(): {
  totalPosts: number;
  avgLikes: number;
  avgRetweets: number;
  avgImpressions: number;
  highEngagementPosts: number;
  lowEngagementPosts: number;
} {
  const db = getDb();

  const stmt = db.prepare(`
    SELECT
      COUNT(*) as totalPosts,
      AVG(likes) as avgLikes,
      AVG(retweets) as avgRetweets,
      AVG(impressions) as avgImpressions,
      SUM(CASE WHEN likes + retweets * 3 >= 50 THEN 1 ELSE 0 END) as highEngagementPosts,
      SUM(CASE WHEN likes + retweets * 3 < 5 THEN 1 ELSE 0 END) as lowEngagementPosts
    FROM posts
    WHERE twitter_id IS NOT NULL AND engagement_updated_at IS NOT NULL
  `);

  const row = stmt.get() as {
    totalPosts: number;
    avgLikes: number | null;
    avgRetweets: number | null;
    avgImpressions: number | null;
    highEngagementPosts: number;
    lowEngagementPosts: number;
  };

  return {
    totalPosts: row.totalPosts,
    avgLikes: row.avgLikes ?? 0,
    avgRetweets: row.avgRetweets ?? 0,
    avgImpressions: row.avgImpressions ?? 0,
    highEngagementPosts: row.highEngagementPosts,
    lowEngagementPosts: row.lowEngagementPosts,
  };
}
