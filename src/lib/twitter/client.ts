/**
 * Twitter API Client
 *
 * Provides read-only access to Twitter API for fetching tweet metrics
 * and user timeline data. Uses credentials stored in database.
 */

import { TwitterApi, TweetV2, UserV2 } from 'twitter-api-v2';
import { getPrimaryTwitterAccount, updateLastSyncAt } from '@/db/models/twitter-accounts';
import { createLogger } from '@/lib/logger';

const logger = createLogger('twitter:client');

export interface TweetMetrics {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  impressions: number;
}

export interface TweetData {
  id: string;
  text: string;
  createdAt: string;
  metrics: TweetMetrics;
  authorId: string;
}

export interface TwitterClientError extends Error {
  code?: string;
  statusCode?: number;
}

/**
 * Get an authenticated Twitter API client using stored credentials.
 */
export function getTwitterClient(): TwitterApi {
  const account = getPrimaryTwitterAccount();

  if (!account) {
    throw new Error('No Twitter account connected. Please connect your account in settings.');
  }

  if (!account.apiKey || !account.apiSecret || !account.accessToken || !account.accessSecret) {
    throw new Error('Twitter credentials incomplete. Please update your credentials in settings.');
  }

  const client = new TwitterApi({
    appKey: account.apiKey,
    appSecret: account.apiSecret,
    accessToken: account.accessToken,
    accessSecret: account.accessSecret,
  });

  return client;
}

/**
 * Test the Twitter API connection.
 */
export async function testTwitterConnection(): Promise<{
  success: boolean;
  user?: { id: string; username: string; name: string };
  error?: string;
}> {
  try {
    const client = getTwitterClient();
    const me = await client.v2.me({
      'user.fields': ['id', 'username', 'name', 'profile_image_url'],
    });

    const account = getPrimaryTwitterAccount();
    if (account) {
      updateLastSyncAt(account.id);
    }

    return {
      success: true,
      user: {
        id: me.data.id,
        username: me.data.username,
        name: me.data.name,
      },
    };
  } catch (error) {
    logger.error('Twitter connection test failed', { error });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Extract tweet ID from a tweet URL.
 */
export function extractTweetId(url: string): string | null {
  // Handle various Twitter/X URL formats
  const patterns = [
    /twitter\.com\/\w+\/status\/(\d+)/i,
    /x\.com\/\w+\/status\/(\d+)/i,
    /^(\d{15,25})$/, // Direct ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Get metrics for a specific tweet.
 */
export async function getTweetMetrics(tweetIdOrUrl: string): Promise<TweetMetrics> {
  const tweetId = extractTweetId(tweetIdOrUrl) ?? tweetIdOrUrl;

  try {
    const client = getTwitterClient();

    const tweet = await client.v2.singleTweet(tweetId, {
      'tweet.fields': ['public_metrics', 'created_at', 'author_id'],
    });

    if (tweet.data == null) {
      throw new Error('Tweet not found');
    }

    const metrics = tweet.data.public_metrics;

    return {
      likes: metrics?.like_count ?? 0,
      retweets: metrics?.retweet_count ?? 0,
      replies: metrics?.reply_count ?? 0,
      quotes: metrics?.quote_count ?? 0,
      impressions: metrics?.impression_count ?? 0,
    };
  } catch (error) {
    logger.error('Failed to get tweet metrics', { tweetId, error });
    throw error;
  }
}

/**
 * Get full tweet data including metrics.
 */
export async function getTweetData(tweetIdOrUrl: string): Promise<TweetData> {
  const tweetId = extractTweetId(tweetIdOrUrl) ?? tweetIdOrUrl;

  try {
    const client = getTwitterClient();

    const tweet = await client.v2.singleTweet(tweetId, {
      'tweet.fields': ['public_metrics', 'created_at', 'author_id', 'text'],
    });

    if (tweet.data == null) {
      throw new Error('Tweet not found');
    }

    const metrics = tweet.data.public_metrics;

    return {
      id: tweet.data.id,
      text: tweet.data.text,
      createdAt: tweet.data.created_at ?? new Date().toISOString(),
      authorId: tweet.data.author_id ?? '',
      metrics: {
        likes: metrics?.like_count ?? 0,
        retweets: metrics?.retweet_count ?? 0,
        replies: metrics?.reply_count ?? 0,
        quotes: metrics?.quote_count ?? 0,
        impressions: metrics?.impression_count ?? 0,
      },
    };
  } catch (error) {
    logger.error('Failed to get tweet data', { tweetId, error });
    throw error;
  }
}

/**
 * Get recent tweets from the connected user.
 */
export async function getRecentTweets(count: number = 10): Promise<TweetData[]> {
  try {
    const client = getTwitterClient();
    const me = await client.v2.me();

    const timeline = await client.v2.userTimeline(me.data.id, {
      max_results: Math.min(100, Math.max(5, count)),
      'tweet.fields': ['public_metrics', 'created_at', 'text'],
      exclude: ['retweets', 'replies'],
    });

    if (timeline.data.data == null) {
      return [];
    }

    return timeline.data.data.map((tweet: TweetV2) => ({
      id: tweet.id,
      text: tweet.text,
      createdAt: tweet.created_at ?? new Date().toISOString(),
      authorId: me.data.id,
      metrics: {
        likes: tweet.public_metrics?.like_count ?? 0,
        retweets: tweet.public_metrics?.retweet_count ?? 0,
        replies: tweet.public_metrics?.reply_count ?? 0,
        quotes: tweet.public_metrics?.quote_count ?? 0,
        impressions: tweet.public_metrics?.impression_count ?? 0,
      },
    }));
  } catch (error) {
    logger.error('Failed to get recent tweets', { error });
    throw error;
  }
}

/**
 * Get user info by username.
 */
export async function getUserByUsername(username: string): Promise<UserV2 | null> {
  try {
    const client = getTwitterClient();
    const user = await client.v2.userByUsername(username, {
      'user.fields': ['id', 'username', 'name', 'profile_image_url', 'public_metrics'],
    });

    return user.data ?? null;
  } catch (error) {
    logger.error('Failed to get user by username', { username, error });
    return null;
  }
}

/**
 * Check if the Twitter client is configured.
 */
export function isTwitterConfigured(): boolean {
  const account = getPrimaryTwitterAccount();
  return Boolean(
    account?.apiKey && account?.apiSecret && account?.accessToken && account?.accessSecret
  );
}
