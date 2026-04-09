import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { closeDb, resetDb } from '../connection';
import { runMigrations } from '../migrations';

import {
  createPost,
  getPostById,
  updatePost,
  deletePost,
  listPosts,
  countPosts,
  getPostsByStatus,
} from './posts';

import {
  createFeedback,
  getFeedbackById,
  updateFeedback,
  deleteFeedback,
  listFeedback,
  countFeedback,
  getFeedbackByPostId,
  getFeedbackByAction,
} from './feedback';

import {
  createPattern,
  getPatternById,
  updatePattern,
  deletePattern,
  listPatterns,
  getPatternsByType,
  incrementEvidenceCount,
  incrementEvidenceBySource,
} from './patterns';

import {
  createQueueItem,
  getQueueItemById,
  getQueueItemByPostId,
  updateQueueItem,
  deleteQueueItem,
  deleteQueueItemByPostId,
  listQueue,
  getNextInQueue,
  reorderQueue,
} from './queue';

import {
  createSource,
  getSourceBySourceId,
  updateSource,
  listSources,
  getSourcesByType,
  sourceExists,
} from './sources';

import {
  createAccount,
  getAccountByHandle,
  updateAccount,
  listAccounts,
  getAccountsByTier,
  updateLastScraped,
  updateHealthStatus,
  getAccountsDueForScrape,
} from './accounts';

import {
  createFormula,
  getFormulaByName,
  updateFormula,
  listFormulas,
  getActiveFormulas,
  incrementUsageCount,
  updateSuccessRate,
} from './formulas';

import {
  createCostEntry,
  updateCostEntry,
  listCostEntries,
  getCostEntriesByApiName,
  getTotalCostForPeriod,
  getDailyCost,
  getMonthlyCost,
  checkBudgetLimit,
  isBudgetExceeded,
} from './costs';

import {
  createRule,
  updateRule,
  listRules,
  getActiveRules,
  getRulesByType,
  deactivateRule,
  activateRule,
  findRuleByDescription,
  ruleExists,
} from './rules';

const TEST_DB_PATH = './data/test-models.db';

beforeAll(() => {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
});

afterAll(() => {
  closeDb();
  resetDb();
  delete process.env.SQLITE_DB_PATH;
});

beforeEach(() => {
  resetDb();
  runMigrations();
});

afterEach(() => {
  closeDb();
});

describe('Posts Model', () => {
  describe('createPost', () => {
    it('creates a post with required fields', () => {
      const post = createPost({
        content: 'Test post content',
        type: 'single',
      });

      expect(post.id).toBeDefined();
      expect(post.content).toBe('Test post content');
      expect(post.type).toBe('single');
      expect(post.status).toBe('draft');
      expect(post.confidenceScore).toBe(0);
      expect(post.reasoning).toEqual({});
      expect(post.createdAt).toBeDefined();
    });

    it('creates a post with all fields', () => {
      const reasoning = {
        source: 'test',
        whyItWorks: 'because',
        voiceMatch: 85,
        timing: 'evergreen',
        concerns: [],
      };
      const post = createPost({
        content: 'Full post',
        type: 'thread',
        status: 'pending',
        confidenceScore: 85,
        reasoning,
      });

      expect(post.status).toBe('pending');
      expect(post.confidenceScore).toBe(85);
      expect(post.reasoning).toEqual(reasoning);
    });
  });

  describe('getPostById', () => {
    it('returns post when found', () => {
      const created = createPost({ content: 'Test', type: 'single' });
      const found = getPostById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it('returns null when not found', () => {
      const found = getPostById(99999);
      expect(found).toBeNull();
    });
  });

  describe('updatePost', () => {
    it('updates post fields', () => {
      const post = createPost({ content: 'Original', type: 'single' });
      const updated = updatePost(post.id, {
        content: 'Updated',
        status: 'approved',
        confidenceScore: 90,
      });

      expect(updated?.content).toBe('Updated');
      expect(updated?.status).toBe('approved');
      expect(updated?.confidenceScore).toBe(90);
    });

    it('returns null for non-existent post', () => {
      const updated = updatePost(99999, { content: 'Test' });
      expect(updated).toBeNull();
    });

    it('returns unchanged post when no updates provided', () => {
      const post = createPost({ content: 'Test', type: 'single' });
      const updated = updatePost(post.id, {});

      expect(updated?.content).toBe('Test');
    });
  });

  describe('deletePost', () => {
    it('deletes existing post', () => {
      const post = createPost({ content: 'Test', type: 'single' });
      const deleted = deletePost(post.id);

      expect(deleted).toBe(true);
      expect(getPostById(post.id)).toBeNull();
    });

    it('returns false for non-existent post', () => {
      const deleted = deletePost(99999);
      expect(deleted).toBe(false);
    });
  });

  describe('listPosts', () => {
    beforeEach(() => {
      createPost({ content: 'Post 1', type: 'single', status: 'draft' });
      createPost({ content: 'Post 2', type: 'thread', status: 'pending' });
      createPost({ content: 'Post 3', type: 'single', status: 'approved' });
    });

    it('lists all posts', () => {
      const posts = listPosts();
      expect(posts.length).toBe(3);
    });

    it('filters by status', () => {
      const posts = listPosts({ status: 'draft' });
      expect(posts.length).toBe(1);
      expect(posts[0].content).toBe('Post 1');
    });

    it('applies pagination', () => {
      const posts = listPosts({ limit: 2, offset: 1 });
      expect(posts.length).toBe(2);
    });

    it('orders by created_at desc by default', () => {
      const posts = listPosts();
      expect(posts[0].content).toBe('Post 3');
    });
  });

  describe('countPosts', () => {
    it('counts all posts', () => {
      createPost({ content: 'Post 1', type: 'single' });
      createPost({ content: 'Post 2', type: 'single' });

      expect(countPosts()).toBe(2);
    });

    it('counts by status', () => {
      createPost({ content: 'Post 1', type: 'single', status: 'draft' });
      createPost({ content: 'Post 2', type: 'single', status: 'approved' });
      createPost({ content: 'Post 3', type: 'single', status: 'approved' });

      expect(countPosts('approved')).toBe(2);
    });
  });

  describe('getPostsByStatus', () => {
    it('returns posts with specified status', () => {
      createPost({ content: 'Draft', type: 'single', status: 'draft' });
      createPost({ content: 'Pending', type: 'single', status: 'pending' });

      const drafts = getPostsByStatus('draft');
      expect(drafts.length).toBe(1);
      expect(drafts[0].status).toBe('draft');
    });
  });
});

describe('Feedback Model', () => {
  let postId: number;

  beforeEach(() => {
    const post = createPost({ content: 'Test post', type: 'single' });
    postId = post.id;
  });

  describe('createFeedback', () => {
    it('creates feedback with required fields', () => {
      const feedback = createFeedback({
        postId,
        action: 'approve',
      });

      expect(feedback.id).toBeDefined();
      expect(feedback.postId).toBe(postId);
      expect(feedback.action).toBe('approve');
      expect(feedback.category).toBeNull();
    });

    it('creates feedback with all fields', () => {
      const feedback = createFeedback({
        postId,
        action: 'reject',
        category: 'tone',
        comment: 'Too formal',
        diffBefore: 'original',
        diffAfter: 'edited',
      });

      expect(feedback.category).toBe('tone');
      expect(feedback.comment).toBe('Too formal');
      expect(feedback.diffBefore).toBe('original');
      expect(feedback.diffAfter).toBe('edited');
    });
  });

  describe('getFeedbackById', () => {
    it('returns feedback when found', () => {
      const created = createFeedback({ postId, action: 'approve' });
      const found = getFeedbackById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });
  });

  describe('updateFeedback', () => {
    it('updates feedback fields', () => {
      const feedback = createFeedback({ postId, action: 'reject' });
      const updated = updateFeedback(feedback.id, {
        category: 'hook',
        comment: 'Updated comment',
      });

      expect(updated?.category).toBe('hook');
      expect(updated?.comment).toBe('Updated comment');
    });
  });

  describe('deleteFeedback', () => {
    it('deletes existing feedback', () => {
      const feedback = createFeedback({ postId, action: 'approve' });
      const deleted = deleteFeedback(feedback.id);

      expect(deleted).toBe(true);
      expect(getFeedbackById(feedback.id)).toBeNull();
    });
  });

  describe('listFeedback', () => {
    beforeEach(() => {
      createFeedback({ postId, action: 'approve' });
      createFeedback({ postId, action: 'reject', category: 'tone' });
      createFeedback({ postId, action: 'edit' });
    });

    it('lists all feedback', () => {
      const feedback = listFeedback();
      expect(feedback.length).toBe(3);
    });

    it('filters by action', () => {
      const feedback = listFeedback({ action: 'reject' });
      expect(feedback.length).toBe(1);
    });

    it('filters by postId', () => {
      const otherPost = createPost({ content: 'Other', type: 'single' });
      createFeedback({ postId: otherPost.id, action: 'approve' });

      const feedback = listFeedback({ postId });
      expect(feedback.length).toBe(3);
    });
  });

  describe('countFeedback', () => {
    it('counts feedback', () => {
      createFeedback({ postId, action: 'approve' });
      createFeedback({ postId, action: 'reject' });

      expect(countFeedback()).toBe(2);
      expect(countFeedback({ action: 'approve' })).toBe(1);
    });
  });

  describe('convenience functions', () => {
    it('getFeedbackByPostId returns all feedback for post', () => {
      createFeedback({ postId, action: 'approve' });
      createFeedback({ postId, action: 'reject' });

      const feedback = getFeedbackByPostId(postId);
      expect(feedback.length).toBe(2);
    });

    it('getFeedbackByAction returns feedback by action', () => {
      createFeedback({ postId, action: 'approve' });
      createFeedback({ postId, action: 'approve' });
      createFeedback({ postId, action: 'reject' });

      const feedback = getFeedbackByAction('approve');
      expect(feedback.length).toBe(2);
    });
  });
});

describe('Patterns Model', () => {
  describe('createPattern', () => {
    it('creates pattern with required fields', () => {
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Use short sentences',
      });

      expect(pattern.id).toBeDefined();
      expect(pattern.patternType).toBe('voice');
      expect(pattern.description).toBe('Use short sentences');
      expect(pattern.evidenceCount).toBe(0);
    });

    it('creates pattern with evidence counts', () => {
      const pattern = createPattern({
        patternType: 'edit',
        description: 'Remove filler words',
        evidenceCount: 5,
        editEvidenceCount: 3,
        rejectionEvidenceCount: 2,
      });

      expect(pattern.evidenceCount).toBe(5);
      expect(pattern.editEvidenceCount).toBe(3);
      expect(pattern.rejectionEvidenceCount).toBe(2);
    });
  });

  describe('getPatternById', () => {
    it('returns pattern when found', () => {
      const created = createPattern({ patternType: 'hook', description: 'Test' });
      const found = getPatternById(created.id);

      expect(found).not.toBeNull();
      expect(found?.patternType).toBe('hook');
    });
  });

  describe('updatePattern', () => {
    it('updates pattern and sets updated_at', () => {
      const pattern = createPattern({ patternType: 'voice', description: 'Original' });

      const updated = updatePattern(pattern.id, {
        description: 'Updated description',
        evidenceCount: 10,
      });

      expect(updated?.description).toBe('Updated description');
      expect(updated?.evidenceCount).toBe(10);
      // updatedAt should be a valid timestamp (SQLite datetime has second precision,
      // so we can't reliably check it changed within the same second)
      expect(updated?.updatedAt).toBeDefined();
      expect(new Date(updated?.updatedAt ?? '').getTime()).not.toBeNaN();
    });
  });

  describe('deletePattern', () => {
    it('deletes existing pattern', () => {
      const pattern = createPattern({ patternType: 'topic', description: 'Test' });
      expect(deletePattern(pattern.id)).toBe(true);
      expect(getPatternById(pattern.id)).toBeNull();
    });
  });

  describe('listPatterns', () => {
    beforeEach(() => {
      createPattern({ patternType: 'voice', description: 'Voice 1', evidenceCount: 5 });
      createPattern({ patternType: 'hook', description: 'Hook 1', evidenceCount: 3 });
      createPattern({ patternType: 'voice', description: 'Voice 2', evidenceCount: 10 });
    });

    it('lists all patterns', () => {
      expect(listPatterns().length).toBe(3);
    });

    it('filters by patternType', () => {
      const patterns = listPatterns({ patternType: 'voice' });
      expect(patterns.length).toBe(2);
    });

    it('filters by minEvidenceCount', () => {
      const patterns = listPatterns({ minEvidenceCount: 5 });
      expect(patterns.length).toBe(2);
    });
  });

  describe('incrementEvidenceCount', () => {
    it('increments evidence count', () => {
      const pattern = createPattern({ patternType: 'voice', description: 'Test' });
      expect(pattern.evidenceCount).toBe(0);

      const updated = incrementEvidenceCount(pattern.id);
      expect(updated?.evidenceCount).toBe(1);
    });
  });

  describe('incrementEvidenceBySource', () => {
    it('increments edit evidence', () => {
      const pattern = createPattern({ patternType: 'edit', description: 'Test' });

      const updated = incrementEvidenceBySource(pattern.id, 'edit');
      expect(updated?.evidenceCount).toBe(1);
      expect(updated?.editEvidenceCount).toBe(1);
      expect(updated?.rejectionEvidenceCount).toBe(0);
    });

    it('increments rejection evidence', () => {
      const pattern = createPattern({ patternType: 'rejection', description: 'Test' });

      const updated = incrementEvidenceBySource(pattern.id, 'rejection');
      expect(updated?.evidenceCount).toBe(1);
      expect(updated?.rejectionEvidenceCount).toBe(1);
    });
  });

  describe('getPatternsByType', () => {
    it('returns patterns of specified type', () => {
      createPattern({ patternType: 'voice', description: 'Voice' });
      createPattern({ patternType: 'hook', description: 'Hook' });

      const voicePatterns = getPatternsByType('voice');
      expect(voicePatterns.length).toBe(1);
      expect(voicePatterns[0].patternType).toBe('voice');
    });
  });
});

describe('Queue Model', () => {
  let postId: number;

  beforeEach(() => {
    const post = createPost({ content: 'Test', type: 'single' });
    postId = post.id;
  });

  describe('createQueueItem', () => {
    it('creates queue item with defaults', () => {
      const item = createQueueItem({ postId });

      expect(item.id).toBeDefined();
      expect(item.postId).toBe(postId);
      expect(item.priority).toBe(0);
      expect(item.scheduledFor).toBeNull();
    });

    it('creates queue item with priority and schedule', () => {
      const scheduledFor = '2026-01-20T10:00:00.000Z';
      const item = createQueueItem({
        postId,
        priority: 10,
        scheduledFor,
      });

      expect(item.priority).toBe(10);
      expect(item.scheduledFor).toBe(scheduledFor);
    });
  });

  describe('getQueueItemById and getQueueItemByPostId', () => {
    it('retrieves by id', () => {
      const item = createQueueItem({ postId });
      expect(getQueueItemById(item.id)?.postId).toBe(postId);
    });

    it('retrieves by postId', () => {
      const item = createQueueItem({ postId });
      expect(getQueueItemByPostId(postId)?.id).toBe(item.id);
    });
  });

  describe('updateQueueItem', () => {
    it('updates priority', () => {
      const item = createQueueItem({ postId });
      const updated = updateQueueItem(item.id, { priority: 100 });

      expect(updated?.priority).toBe(100);
    });
  });

  describe('deleteQueueItem and deleteQueueItemByPostId', () => {
    it('deletes by id', () => {
      const item = createQueueItem({ postId });
      expect(deleteQueueItem(item.id)).toBe(true);
      expect(getQueueItemById(item.id)).toBeNull();
    });

    it('deletes by postId', () => {
      createQueueItem({ postId });
      expect(deleteQueueItemByPostId(postId)).toBe(true);
      expect(getQueueItemByPostId(postId)).toBeNull();
    });
  });

  describe('listQueue', () => {
    it('lists queue items ordered by priority', () => {
      const post2 = createPost({ content: 'Test 2', type: 'single' });
      createQueueItem({ postId, priority: 5 });
      createQueueItem({ postId: post2.id, priority: 10 });

      const items = listQueue();
      expect(items.length).toBe(2);
      expect(items[0].priority).toBe(10);
    });

    it('filters by minPriority', () => {
      const post2 = createPost({ content: 'Test 2', type: 'single' });
      createQueueItem({ postId, priority: 5 });
      createQueueItem({ postId: post2.id, priority: 10 });

      const items = listQueue({ minPriority: 8 });
      expect(items.length).toBe(1);
    });
  });

  describe('getNextInQueue', () => {
    it('returns highest priority item', () => {
      const post2 = createPost({ content: 'Test 2', type: 'single' });
      createQueueItem({ postId, priority: 5 });
      createQueueItem({ postId: post2.id, priority: 15 });

      const next = getNextInQueue();
      expect(next?.priority).toBe(15);
    });

    it('respects scheduled time', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      createQueueItem({ postId, priority: 100, scheduledFor: futureDate.toISOString() });

      const next = getNextInQueue();
      expect(next).toBeNull();
    });
  });

  describe('reorderQueue', () => {
    it('changes item priority', () => {
      const item = createQueueItem({ postId, priority: 5 });
      const reordered = reorderQueue(item.id, 50);

      expect(reordered?.priority).toBe(50);
    });
  });
});

describe('Sources Model', () => {
  describe('createSource', () => {
    it('creates source with required fields', () => {
      const source = createSource({
        sourceType: 'like',
        sourceId: 'tweet_123',
        content: 'Tweet content',
      });

      expect(source.id).toBeDefined();
      expect(source.sourceType).toBe('like');
      expect(source.sourceId).toBe('tweet_123');
      expect(source.content).toBe('Tweet content');
      expect(source.metadata).toEqual({});
    });

    it('creates source with metadata', () => {
      const metadata = { authorHandle: '@test', likeCount: 100 };
      const source = createSource({
        sourceType: 'bookmark',
        sourceId: 'tweet_456',
        content: 'Bookmarked tweet',
        metadata,
      });

      expect(source.metadata).toEqual(metadata);
    });
  });

  describe('getSourceBySourceId', () => {
    it('retrieves by composite key', () => {
      createSource({
        sourceType: 'like',
        sourceId: 'unique_id',
        content: 'Test',
      });

      const found = getSourceBySourceId('like', 'unique_id');
      expect(found).not.toBeNull();
      expect(found?.content).toBe('Test');
    });

    it('returns null for wrong type', () => {
      createSource({
        sourceType: 'like',
        sourceId: 'unique_id',
        content: 'Test',
      });

      const found = getSourceBySourceId('bookmark', 'unique_id');
      expect(found).toBeNull();
    });
  });

  describe('sourceExists', () => {
    it('returns true for existing source', () => {
      createSource({
        sourceType: 'account_tweet',
        sourceId: 'check_id',
        content: 'Test',
      });

      expect(sourceExists('account_tweet', 'check_id')).toBe(true);
    });

    it('returns false for non-existing source', () => {
      expect(sourceExists('like', 'nonexistent')).toBe(false);
    });
  });

  describe('updateSource', () => {
    it('updates content and metadata', () => {
      const source = createSource({
        sourceType: 'like',
        sourceId: 'update_test',
        content: 'Original',
      });

      const updated = updateSource(source.id, {
        content: 'Updated content',
        metadata: { authorHandle: '@updated' },
      });

      expect(updated?.content).toBe('Updated content');
      expect(updated?.metadata).toEqual({ authorHandle: '@updated' });
    });
  });

  describe('listSources', () => {
    beforeEach(() => {
      createSource({ sourceType: 'like', sourceId: '1', content: 'Like 1' });
      createSource({ sourceType: 'bookmark', sourceId: '2', content: 'Bookmark 1' });
      createSource({ sourceType: 'like', sourceId: '3', content: 'Like 2' });
    });

    it('filters by sourceType', () => {
      const likes = listSources({ sourceType: 'like' });
      expect(likes.length).toBe(2);
    });

    it('applies pagination', () => {
      const sources = listSources({ limit: 1, offset: 1 });
      expect(sources.length).toBe(1);
    });
  });

  describe('getSourcesByType', () => {
    it('returns sources of specified type', () => {
      createSource({ sourceType: 'like', sourceId: '1', content: 'Test' });
      createSource({ sourceType: 'bookmark', sourceId: '2', content: 'Test' });

      const likes = getSourcesByType('like');
      expect(likes.length).toBe(1);
      expect(likes[0].sourceType).toBe('like');
    });
  });
});

describe('Accounts Model', () => {
  describe('createAccount', () => {
    it('creates account with defaults', () => {
      const account = createAccount({
        handle: 'testuser',
        tier: 1,
      });

      expect(account.id).toBeDefined();
      expect(account.handle).toBe('testuser');
      expect(account.tier).toBe(1);
      expect(account.healthStatus).toBe('healthy');
      expect(account.lastScraped).toBeNull();
    });

    it('creates account with custom health status', () => {
      const account = createAccount({
        handle: 'degradeduser',
        tier: 2,
        healthStatus: 'degraded',
      });

      expect(account.healthStatus).toBe('degraded');
    });
  });

  describe('getAccountByHandle', () => {
    it('retrieves by handle', () => {
      createAccount({ handle: 'findme', tier: 1 });
      const found = getAccountByHandle('findme');

      expect(found).not.toBeNull();
      expect(found?.handle).toBe('findme');
    });
  });

  describe('updateAccount', () => {
    it('updates tier and health status', () => {
      const account = createAccount({ handle: 'updateme', tier: 1 });
      const updated = updateAccount(account.id, {
        tier: 2,
        healthStatus: 'failing',
      });

      expect(updated?.tier).toBe(2);
      expect(updated?.healthStatus).toBe('failing');
    });
  });

  describe('updateLastScraped', () => {
    it('updates last scraped timestamp', () => {
      const account = createAccount({ handle: 'scrapetest', tier: 1 });
      const timestamp = '2026-01-16T12:00:00.000Z';

      const updated = updateLastScraped(account.id, timestamp);
      expect(updated?.lastScraped).toBe(timestamp);
    });
  });

  describe('updateHealthStatus', () => {
    it('updates health status', () => {
      const account = createAccount({ handle: 'healthtest', tier: 1 });

      const updated = updateHealthStatus(account.id, 'degraded');
      expect(updated?.healthStatus).toBe('degraded');
    });
  });

  describe('listAccounts', () => {
    beforeEach(() => {
      createAccount({ handle: 'tier1_healthy', tier: 1, healthStatus: 'healthy' });
      createAccount({ handle: 'tier1_degraded', tier: 1, healthStatus: 'degraded' });
      createAccount({ handle: 'tier2_healthy', tier: 2, healthStatus: 'healthy' });
    });

    it('filters by tier', () => {
      const tier1 = listAccounts({ tier: 1 });
      expect(tier1.length).toBe(2);
    });

    it('filters by health status', () => {
      const healthy = listAccounts({ healthStatus: 'healthy' });
      expect(healthy.length).toBe(2);
    });
  });

  describe('getAccountsByTier', () => {
    it('returns accounts by tier', () => {
      createAccount({ handle: 'tier1', tier: 1 });
      createAccount({ handle: 'tier2', tier: 2 });

      const tier1Accounts = getAccountsByTier(1);
      expect(tier1Accounts.length).toBe(1);
      expect(tier1Accounts[0].tier).toBe(1);
    });
  });

  describe('getAccountsDueForScrape', () => {
    it('returns accounts due for scraping', () => {
      const oldDate = '2026-01-01T00:00:00.000Z';
      const account = createAccount({ handle: 'oldscrape', tier: 1 });
      updateLastScraped(account.id, oldDate);

      createAccount({ handle: 'neverscrape', tier: 1 });

      const due = getAccountsDueForScrape(1, '2026-01-15T00:00:00.000Z');
      expect(due.length).toBe(2);
    });
  });
});

describe('Formulas Model', () => {
  describe('createFormula', () => {
    it('creates formula with defaults', () => {
      const formula = createFormula({
        name: 'Problem Solution',
        template: 'Problem: {{problem}}\nSolution: {{solution}}',
      });

      expect(formula.id).toBeDefined();
      expect(formula.name).toBe('Problem Solution');
      expect(formula.template).toContain('Problem:');
      expect(formula.usageCount).toBe(0);
      expect(formula.successRate).toBe(0);
      expect(formula.active).toBe(true);
    });

    it('creates inactive formula', () => {
      const formula = createFormula({
        name: 'Inactive Formula',
        template: 'Template',
        active: false,
      });

      expect(formula.active).toBe(false);
    });
  });

  describe('getFormulaByName', () => {
    it('retrieves by name', () => {
      createFormula({ name: 'Unique Name', template: 'Template' });
      const found = getFormulaByName('Unique Name');

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Unique Name');
    });
  });

  describe('updateFormula', () => {
    it('updates formula fields', () => {
      const formula = createFormula({ name: 'Update Test', template: 'Original' });
      const updated = updateFormula(formula.id, {
        template: 'Updated template',
        usageCount: 10,
        successRate: 0.85,
      });

      expect(updated?.template).toBe('Updated template');
      expect(updated?.usageCount).toBe(10);
      expect(updated?.successRate).toBe(0.85);
    });
  });

  describe('incrementUsageCount', () => {
    it('increments usage count', () => {
      const formula = createFormula({ name: 'Usage Test', template: 'T' });
      expect(formula.usageCount).toBe(0);

      const updated = incrementUsageCount(formula.id);
      expect(updated?.usageCount).toBe(1);

      const updated2 = incrementUsageCount(formula.id);
      expect(updated2?.usageCount).toBe(2);
    });
  });

  describe('updateSuccessRate', () => {
    it('updates success rate', () => {
      const formula = createFormula({ name: 'Success Test', template: 'T' });

      const updated = updateSuccessRate(formula.id, 0.75);
      expect(updated?.successRate).toBe(0.75);
    });
  });

  describe('listFormulas', () => {
    beforeEach(() => {
      createFormula({ name: 'Active 1', template: 'T', active: true });
      createFormula({ name: 'Inactive', template: 'T', active: false });
      const f = createFormula({ name: 'Active 2', template: 'T', active: true });
      updateSuccessRate(f.id, 0.9);
    });

    it('filters by active status', () => {
      const active = listFormulas({ active: true });
      expect(active.length).toBe(2);
    });

    it('filters by minSuccessRate', () => {
      const highSuccess = listFormulas({ minSuccessRate: 0.8 });
      expect(highSuccess.length).toBe(1);
    });
  });

  describe('getActiveFormulas', () => {
    it('returns only active formulas', () => {
      createFormula({ name: 'Active', template: 'T', active: true });
      createFormula({ name: 'Inactive', template: 'T', active: false });

      const active = getActiveFormulas();
      expect(active.length).toBe(1);
      expect(active[0].active).toBe(true);
    });
  });
});

describe('Costs Model', () => {
  describe('createCostEntry', () => {
    it('creates cost entry', () => {
      const entry = createCostEntry({
        apiName: 'anthropic',
        tokensUsed: 1000,
        costUsd: 0.05,
      });

      expect(entry.id).toBeDefined();
      expect(entry.apiName).toBe('anthropic');
      expect(entry.tokensUsed).toBe(1000);
      expect(entry.costUsd).toBe(0.05);
    });

    it('defaults tokensUsed to 0', () => {
      const entry = createCostEntry({
        apiName: 'apify',
        costUsd: 1.0,
      });

      expect(entry.tokensUsed).toBe(0);
    });
  });

  describe('updateCostEntry', () => {
    it('updates cost entry', () => {
      const entry = createCostEntry({
        apiName: 'anthropic',
        tokensUsed: 500,
        costUsd: 0.02,
      });

      const updated = updateCostEntry(entry.id, {
        tokensUsed: 1000,
        costUsd: 0.05,
      });

      expect(updated?.tokensUsed).toBe(1000);
      expect(updated?.costUsd).toBe(0.05);
    });
  });

  describe('listCostEntries', () => {
    beforeEach(() => {
      createCostEntry({ apiName: 'anthropic', costUsd: 0.05 });
      createCostEntry({ apiName: 'apify', costUsd: 0.1 });
      createCostEntry({ apiName: 'anthropic', costUsd: 0.03 });
    });

    it('filters by apiName', () => {
      const entries = listCostEntries({ apiName: 'anthropic' });
      expect(entries.length).toBe(2);
    });
  });

  describe('getCostEntriesByApiName', () => {
    it('returns entries for specified API', () => {
      createCostEntry({ apiName: 'smaug', costUsd: 0.01 });
      createCostEntry({ apiName: 'anthropic', costUsd: 0.05 });

      const smaugEntries = getCostEntriesByApiName('smaug');
      expect(smaugEntries.length).toBe(1);
      expect(smaugEntries[0].apiName).toBe('smaug');
    });
  });

  describe('getTotalCostForPeriod', () => {
    it('sums costs for period', () => {
      createCostEntry({ apiName: 'anthropic', costUsd: 0.05 });
      createCostEntry({ apiName: 'anthropic', costUsd: 0.03 });
      createCostEntry({ apiName: 'apify', costUsd: 0.1 });

      // Format date to match SQLite format (YYYY-MM-DD HH:MM:SS)
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const startDateStr = startOfDay.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

      const total = getTotalCostForPeriod('anthropic', startDateStr);
      expect(total).toBeCloseTo(0.08, 2);
    });
  });

  describe('getDailyCost and getMonthlyCost', () => {
    it('returns daily cost for API', () => {
      createCostEntry({ apiName: 'anthropic', costUsd: 0.05 });
      createCostEntry({ apiName: 'anthropic', costUsd: 0.03 });

      const daily = getDailyCost('anthropic');
      expect(daily).toBeCloseTo(0.08, 2);
    });

    it('returns monthly cost for API', () => {
      createCostEntry({ apiName: 'apify', costUsd: 1.0 });

      const monthly = getMonthlyCost('apify');
      expect(monthly).toBe(1.0);
    });
  });

  describe('checkBudgetLimit', () => {
    it('returns budget status for anthropic', () => {
      createCostEntry({ apiName: 'anthropic', costUsd: 5.0 });

      const statuses = checkBudgetLimit('anthropic', 1.0, {
        anthropicDailyUsd: 10,
        anthropicMonthlyUsd: 100,
      });

      expect(statuses.length).toBe(2);

      const daily = statuses.find((s) => s.period === 'daily');
      expect(daily?.used).toBe(5.0);
      expect(daily?.remaining).toBe(5.0);
      expect(daily?.exceeded).toBe(false);
    });

    it('detects budget exceeded', () => {
      createCostEntry({ apiName: 'anthropic', costUsd: 9.5 });

      const statuses = checkBudgetLimit('anthropic', 1.0, {
        anthropicDailyUsd: 10,
      });

      const daily = statuses[0];
      expect(daily.exceeded).toBe(true);
    });
  });

  describe('isBudgetExceeded', () => {
    it('returns true when any budget exceeded', () => {
      createCostEntry({ apiName: 'anthropic', costUsd: 9.5 });

      const exceeded = isBudgetExceeded('anthropic', 1.0, {
        anthropicDailyUsd: 10,
      });

      expect(exceeded).toBe(true);
    });

    it('returns false when within budget', () => {
      createCostEntry({ apiName: 'anthropic', costUsd: 5.0 });

      const exceeded = isBudgetExceeded('anthropic', 1.0, {
        anthropicDailyUsd: 10,
      });

      expect(exceeded).toBe(false);
    });
  });
});

describe('Rules Model', () => {
  describe('createRule', () => {
    it('creates rule with required fields', () => {
      const rule = createRule({
        ruleType: 'voice',
        description: 'Always use short sentences',
        source: 'clarification',
      });

      expect(rule.id).toBeDefined();
      expect(rule.ruleType).toBe('voice');
      expect(rule.description).toBe('Always use short sentences');
      expect(rule.source).toBe('clarification');
      expect(rule.priority).toBe(1);
      expect(rule.isActive).toBe(true);
    });

    it('creates rule with all fields', () => {
      const rule = createRule({
        ruleType: 'format',
        description: 'Use bullet points',
        source: 'manual',
        priority: 5,
        isActive: false,
        context: 'Only for threads',
      });

      expect(rule.priority).toBe(5);
      expect(rule.isActive).toBe(false);
      expect(rule.context).toBe('Only for threads');
    });
  });

  describe('updateRule', () => {
    it('updates rule and sets updated_at', () => {
      const rule = createRule({
        ruleType: 'style',
        description: 'Original',
        source: 'bootstrap',
      });

      const updated = updateRule(rule.id, {
        description: 'Updated description',
        priority: 10,
      });

      expect(updated?.description).toBe('Updated description');
      expect(updated?.priority).toBe(10);
    });
  });

  describe('deactivateRule and activateRule', () => {
    it('deactivates rule', () => {
      const rule = createRule({
        ruleType: 'general',
        description: 'Test',
        source: 'manual',
      });

      const deactivated = deactivateRule(rule.id);
      expect(deactivated?.isActive).toBe(false);
    });

    it('activates rule', () => {
      const rule = createRule({
        ruleType: 'general',
        description: 'Test',
        source: 'manual',
        isActive: false,
      });

      const activated = activateRule(rule.id);
      expect(activated?.isActive).toBe(true);
    });
  });

  describe('listRules', () => {
    beforeEach(() => {
      createRule({ ruleType: 'voice', description: 'Voice 1', source: 'clarification' });
      createRule({ ruleType: 'hook', description: 'Hook 1', source: 'manual', isActive: false });
      createRule({ ruleType: 'voice', description: 'Voice 2', source: 'bootstrap', priority: 5 });
    });

    it('filters by ruleType', () => {
      const voice = listRules({ ruleType: 'voice' });
      expect(voice.length).toBe(2);
    });

    it('filters by source', () => {
      const manual = listRules({ source: 'manual' });
      expect(manual.length).toBe(1);
    });

    it('filters by isActive', () => {
      const active = listRules({ isActive: true });
      expect(active.length).toBe(2);
    });

    it('orders by priority desc by default', () => {
      const rules = listRules();
      expect(rules[0].priority).toBe(5);
    });
  });

  describe('getActiveRules', () => {
    it('returns only active rules', () => {
      createRule({ ruleType: 'voice', description: 'Active', source: 'manual' });
      createRule({ ruleType: 'hook', description: 'Inactive', source: 'manual', isActive: false });

      const active = getActiveRules();
      expect(active.length).toBe(1);
      expect(active[0].isActive).toBe(true);
    });
  });

  describe('getRulesByType', () => {
    it('returns active rules of specified type', () => {
      createRule({ ruleType: 'format', description: 'Format 1', source: 'manual' });
      createRule({
        ruleType: 'format',
        description: 'Format 2',
        source: 'manual',
        isActive: false,
      });
      createRule({ ruleType: 'style', description: 'Style 1', source: 'manual' });

      const formatRules = getRulesByType('format');
      expect(formatRules.length).toBe(1);
    });
  });

  describe('findRuleByDescription and ruleExists', () => {
    it('finds rule by exact description', () => {
      createRule({ ruleType: 'voice', description: 'Unique description', source: 'manual' });

      const found = findRuleByDescription('Unique description');
      expect(found).not.toBeNull();
      expect(found?.description).toBe('Unique description');
    });

    it('ruleExists returns true for existing', () => {
      createRule({ ruleType: 'voice', description: 'Exists', source: 'manual' });

      expect(ruleExists('Exists')).toBe(true);
      expect(ruleExists('Does not exist')).toBe(false);
    });

    it('findRuleByDescription ignores inactive rules', () => {
      createRule({
        ruleType: 'voice',
        description: 'Inactive rule',
        source: 'manual',
        isActive: false,
      });

      const found = findRuleByDescription('Inactive rule');
      expect(found).toBeNull();
    });
  });
});
