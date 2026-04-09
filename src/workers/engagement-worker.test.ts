import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { closeDb, getDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import {
  getPostsNeedingEngagementUpdate,
  updatePostEngagement,
  getPostEngagement,
  calculateEngagementScore,
  processEngagementBatch,
  getEngagementStats,
  TwitterApiClient,
} from './engagement-worker';
import { createPost } from '@/db/models/posts';
import { createPattern } from '@/db/models/patterns';

const TEST_DB_PATH = './data/test-engagement-worker.db';

beforeAll(() => {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
});

afterAll(() => {
  closeDb();
  resetDb();
  delete process.env.SQLITE_DB_PATH;
});

describe('engagement-worker', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    closeDb();
  });

  describe('getPostsNeedingEngagementUpdate', () => {
    it('returns empty array when no posted tweets', () => {
      const posts = getPostsNeedingEngagementUpdate();
      expect(posts).toEqual([]);
    });

    it('returns posts with twitter_id from last 7 days', () => {
      const db = getDb();
      const post = createPost({
        content: 'Test post',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });

      db.prepare(
        `UPDATE posts SET status = 'posted', twitter_id = ?, posted_at = datetime('now') WHERE id = ?`
      ).run('tweet123', post.id);

      const posts = getPostsNeedingEngagementUpdate();
      expect(posts.length).toBe(1);
      expect(posts[0].twitterId).toBe('tweet123');
    });

    it('excludes posts older than 7 days', () => {
      const db = getDb();
      const post = createPost({
        content: 'Old post',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });

      db.prepare(
        `UPDATE posts SET status = 'posted', twitter_id = ?, posted_at = datetime('now', '-8 days') WHERE id = ?`
      ).run('oldtweet', post.id);

      const posts = getPostsNeedingEngagementUpdate();
      expect(posts.length).toBe(0);
    });
  });

  describe('updatePostEngagement', () => {
    it('updates engagement metrics', () => {
      const db = getDb();
      const post = createPost({
        content: 'Test post',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });
      db.prepare(`UPDATE posts SET twitter_id = ? WHERE id = ?`).run('tweet123', post.id);

      updatePostEngagement({
        postId: post.id,
        twitterId: 'tweet123',
        likes: 100,
        retweets: 25,
        impressions: 5000,
      });

      const engagement = getPostEngagement(post.id);
      expect(engagement?.likes).toBe(100);
      expect(engagement?.retweets).toBe(25);
      expect(engagement?.impressions).toBe(5000);
    });
  });

  describe('calculateEngagementScore', () => {
    it('calculates weighted score correctly', () => {
      const score = calculateEngagementScore({
        postId: 1,
        twitterId: 'tweet',
        likes: 10,
        retweets: 5,
        impressions: 1000,
      });

      // 10 + 5*3 + 1000*0.01 = 10 + 15 + 10 = 35
      expect(score).toBe(35);
    });
  });

  describe('processEngagementBatch', () => {
    it('processes batch and updates posts', async () => {
      const db = getDb();

      // Create patterns
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 5,
      });

      // Create post
      const post = createPost({
        content: 'Test post',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });

      // Update reasoning to include patternsUsed (stored as raw JSON)
      db.prepare(`UPDATE posts SET reasoning = ? WHERE id = ?`).run(
        JSON.stringify({
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
          patternsUsed: [pattern.id],
        }),
        post.id
      );
      db.prepare(`UPDATE posts SET twitter_id = ?, status = 'posted' WHERE id = ?`).run(
        'tweet123',
        post.id
      );

      const mockClient: TwitterApiClient = {
        getTweetMetrics: vi.fn().mockResolvedValue([
          {
            twitterId: 'tweet123',
            likes: 100,
            retweets: 30,
            impressions: 5000,
          },
        ]),
      };

      const result = await processEngagementBatch(mockClient, [
        { postId: post.id, twitterId: 'tweet123' },
      ]);

      expect(result.updated).toBe(1);
      expect(result.failed).toBe(0);

      const engagement = getPostEngagement(post.id);
      expect(engagement?.likes).toBe(100);
    });

    it('handles API failures gracefully', async () => {
      const mockClient: TwitterApiClient = {
        getTweetMetrics: vi.fn().mockRejectedValue(new Error('API Error')),
      };

      const result = await processEngagementBatch(mockClient, [
        { postId: 1, twitterId: 'tweet123' },
      ]);

      expect(result.updated).toBe(0);
      expect(result.failed).toBe(1);
    });
  });

  describe('getEngagementStats', () => {
    it('returns zero stats when no data', () => {
      const stats = getEngagementStats();
      expect(stats.totalPosts).toBe(0);
      expect(stats.avgLikes).toBe(0);
    });

    it('calculates stats correctly', () => {
      const db = getDb();

      for (let i = 0; i < 3; i++) {
        const post = createPost({
          content: `Post ${i}`,
          type: 'single',
          confidenceScore: 0.9,
          reasoning: {
            source: 'test',
            whyItWorks: 'test',
            voiceMatch: 0.9,
            timing: 'now',
            concerns: [],
          },
        });
        db.prepare(
          `UPDATE posts SET twitter_id = ?, likes = ?, retweets = ?, impressions = ?, engagement_updated_at = datetime('now') WHERE id = ?`
        ).run(`tweet${i}`, (i + 1) * 10, (i + 1) * 2, (i + 1) * 1000, post.id);
      }

      const stats = getEngagementStats();
      expect(stats.totalPosts).toBe(3);
      expect(stats.avgLikes).toBe(20); // (10+20+30)/3
    });
  });
});
