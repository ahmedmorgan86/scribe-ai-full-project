import { getDb } from '../connection';

export interface PostPerformance {
  id: number;
  postId: number;
  tweetId: string | null;
  tweetUrl: string | null;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  impressions: number;
  profileVisits: number;
  followsFromPost: number;
  engagementRate: number | null;
  performanceScore: number | null;
  firstTrackedAt: string | null;
  lastTrackedAt: string | null;
  trackingCount: number;
  createdAt: string;
}

interface PostPerformanceRow {
  id: number;
  post_id: number;
  tweet_id: string | null;
  tweet_url: string | null;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  impressions: number;
  profile_visits: number;
  follows_from_post: number;
  engagement_rate: number | null;
  performance_score: number | null;
  first_tracked_at: string | null;
  last_tracked_at: string | null;
  tracking_count: number;
  created_at: string;
}

function rowToPerformance(row: PostPerformanceRow): PostPerformance {
  return {
    id: row.id,
    postId: row.post_id,
    tweetId: row.tweet_id,
    tweetUrl: row.tweet_url,
    likes: row.likes,
    retweets: row.retweets,
    replies: row.replies,
    quotes: row.quotes,
    impressions: row.impressions,
    profileVisits: row.profile_visits,
    followsFromPost: row.follows_from_post,
    engagementRate: row.engagement_rate,
    performanceScore: row.performance_score,
    firstTrackedAt: row.first_tracked_at,
    lastTrackedAt: row.last_tracked_at,
    trackingCount: row.tracking_count,
    createdAt: row.created_at,
  };
}

export interface CreatePostPerformanceInput {
  postId: number;
  tweetId?: string;
  tweetUrl?: string;
}

export function createPostPerformance(input: CreatePostPerformanceInput): PostPerformance {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO post_performance (post_id, tweet_id, tweet_url, first_tracked_at)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(input.postId, input.tweetId ?? null, input.tweetUrl ?? null, now);

  const perf = getPostPerformanceById(result.lastInsertRowid as number);
  if (!perf) throw new Error('Failed to create post performance record');
  return perf;
}

export function getPostPerformanceById(id: number): PostPerformance | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM post_performance WHERE id = ?`).get(id) as
    | PostPerformanceRow
    | undefined;
  return row ? rowToPerformance(row) : null;
}

export function getPostPerformanceByPostId(postId: number): PostPerformance | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM post_performance WHERE post_id = ?`).get(postId) as
    | PostPerformanceRow
    | undefined;
  return row ? rowToPerformance(row) : null;
}

export function getPostPerformanceByTweetId(tweetId: string): PostPerformance | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM post_performance WHERE tweet_id = ?`).get(tweetId) as
    | PostPerformanceRow
    | undefined;
  return row ? rowToPerformance(row) : null;
}

export interface UpdatePerformanceMetrics {
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  impressions?: number;
  profileVisits?: number;
  followsFromPost?: number;
}

export function updatePostPerformanceMetrics(
  id: number,
  metrics: UpdatePerformanceMetrics
): PostPerformance | null {
  const db = getDb();

  const current = getPostPerformanceById(id);
  if (!current) return null;

  const newLikes = metrics.likes ?? current.likes;
  const newRetweets = metrics.retweets ?? current.retweets;
  const newReplies = metrics.replies ?? current.replies;
  const newQuotes = metrics.quotes ?? current.quotes;
  const newImpressions = metrics.impressions ?? current.impressions;

  // Calculate engagement rate: (likes + retweets + replies + quotes) / impressions
  const engagements = newLikes + newRetweets + newReplies + newQuotes;
  const engagementRate = newImpressions > 0 ? (engagements / newImpressions) * 100 : 0;

  // Performance score: weighted score (likes=1, retweets=3, replies=2, quotes=4)
  const performanceScore = newLikes * 1 + newRetweets * 3 + newReplies * 2 + newQuotes * 4;

  db.prepare(
    `
    UPDATE post_performance SET
      likes = ?,
      retweets = ?,
      replies = ?,
      quotes = ?,
      impressions = ?,
      profile_visits = COALESCE(?, profile_visits),
      follows_from_post = COALESCE(?, follows_from_post),
      engagement_rate = ?,
      performance_score = ?,
      last_tracked_at = datetime('now'),
      tracking_count = tracking_count + 1
    WHERE id = ?
  `
  ).run(
    newLikes,
    newRetweets,
    newReplies,
    newQuotes,
    newImpressions,
    metrics.profileVisits ?? null,
    metrics.followsFromPost ?? null,
    engagementRate,
    performanceScore,
    id
  );

  return getPostPerformanceById(id);
}

export function listTrackedPosts(limit = 50): PostPerformance[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM post_performance
       ORDER BY last_tracked_at DESC NULLS LAST
       LIMIT ?`
    )
    .all(limit) as PostPerformanceRow[];
  return rows.map(rowToPerformance);
}

export function getTopPerformingPosts(limit = 10): PostPerformance[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM post_performance
       WHERE performance_score IS NOT NULL
       ORDER BY performance_score DESC
       LIMIT ?`
    )
    .all(limit) as PostPerformanceRow[];
  return rows.map(rowToPerformance);
}

export interface PerformanceStats {
  totalTracked: number;
  totalLikes: number;
  totalRetweets: number;
  totalReplies: number;
  totalImpressions: number;
  avgEngagementRate: number;
  avgPerformanceScore: number;
}

export function getPerformanceStats(): PerformanceStats {
  const db = getDb();

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total_tracked,
        COALESCE(SUM(likes), 0) as total_likes,
        COALESCE(SUM(retweets), 0) as total_retweets,
        COALESCE(SUM(replies), 0) as total_replies,
        COALESCE(SUM(impressions), 0) as total_impressions,
        COALESCE(AVG(engagement_rate), 0) as avg_engagement_rate,
        COALESCE(AVG(performance_score), 0) as avg_performance_score
       FROM post_performance`
    )
    .get() as {
    total_tracked: number;
    total_likes: number;
    total_retweets: number;
    total_replies: number;
    total_impressions: number;
    avg_engagement_rate: number;
    avg_performance_score: number;
  };

  return {
    totalTracked: stats.total_tracked,
    totalLikes: stats.total_likes,
    totalRetweets: stats.total_retweets,
    totalReplies: stats.total_replies,
    totalImpressions: stats.total_impressions,
    avgEngagementRate: stats.avg_engagement_rate,
    avgPerformanceScore: stats.avg_performance_score,
  };
}

export function getPostsNeedingSync(maxAge: number = 24 * 60 * 60 * 1000): PostPerformance[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAge).toISOString();

  const rows = db
    .prepare(
      `SELECT * FROM post_performance
       WHERE last_tracked_at IS NULL OR last_tracked_at < ?
       ORDER BY last_tracked_at ASC NULLS FIRST
       LIMIT 50`
    )
    .all(cutoff) as PostPerformanceRow[];

  return rows.map(rowToPerformance);
}

export function deletePostPerformance(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM post_performance WHERE id = ?`).run(id);
  return result.changes > 0;
}
