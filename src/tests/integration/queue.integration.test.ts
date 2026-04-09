/**
 * Queue Management Integration Test Suite
 *
 * Tests the queue workflow:
 * - List queue returns correct posts
 * - Approve moves post to approved status
 * - Reject stores feedback and reason
 * - Edit updates content and re-validates
 * - Feedback triggers pattern learning
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createPost, getPostById } from '@/db/models/posts';
import { createQueueItem, getQueueItemByPostId } from '@/db/models/queue';
import { createFeedback, getFeedbackByPostId } from '@/db/models/feedback';
import { createPattern, getPatternById } from '@/db/models/patterns';
import type { PostStatus, FeedbackCategory } from '@/types';

// Mock external dependencies that would require network calls
vi.mock('@/db/qdrant/connection', () => ({
  collectionExists: vi.fn().mockResolvedValue(true),
  QDRANT_COLLECTION_NAMES: {
    APPROVED_POSTS: 'approved_posts',
    VOICE_GUIDELINES: 'voice_guidelines',
  },
  getQdrantClient: vi.fn().mockReturnValue({
    scroll: vi.fn().mockResolvedValue({ points: [] }),
    count: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock('@/db/qdrant/embeddings', () => ({
  addDocumentsBatch: vi.fn().mockResolvedValue(undefined),
  countDocuments: vi.fn().mockResolvedValue(0),
  addDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/embeddings/service', () => ({
  generateEmbeddingsBatch: vi
    .fn()
    .mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => ({ embedding: new Array(1536).fill(0) })))
    ),
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: new Array(1536).fill(0) }),
}));

vi.mock('@/lib/voice/guidelines', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/voice/guidelines')>();
  return {
    ...original,
    syncVoiceGuidelinesToQdrant: vi.fn().mockResolvedValue(undefined),
    getVoiceGuidelinesFromQdrant: vi.fn().mockResolvedValue({
      dos: ['Be direct', 'Use examples'],
      donts: ['Avoid jargon', 'No filler'],
      rules: ['Keep it short'],
      examples: ['Great tweet example'],
    }),
    formatGuidelinesForPrompt: vi.fn().mockReturnValue('Mock voice guidelines'),
  };
});

vi.mock('@/db/chroma/collections/approved-posts', () => ({
  addApprovedPost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/voice/embeddings', () => ({
  getVoiceCorpusStatus: vi.fn().mockResolvedValue({
    guidelinesLoaded: false,
    approvedPostsCount: 0,
    hasMinimumCorpus: false,
  }),
  getSimilarApprovedPosts: vi.fn().mockResolvedValue([]),
  findSimilarVoiceGuidelines: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/anthropic/cost-tracking', () => ({
  trackedCompletion: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      patterns: [],
      contradictions: [],
      clarificationNeeded: [],
    }),
    costUsd: 0.001,
  }),
}));

// Helper to create mock NextRequest
function createMockRequest(
  url: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> }
): NextRequest {
  const fullUrl = url.startsWith('http') ? url : `http://localhost:3000${url}`;
  const headers: Record<string, string> = { ...(options?.headers ?? {}) };
  const requestOptions: { method: string; headers: Record<string, string>; body?: string } = {
    method: options?.method ?? 'GET',
    headers,
  };

  if (options?.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
    requestOptions.headers['Content-Type'] = 'application/json';
  }

  return new NextRequest(fullUrl, requestOptions);
}

// ============================================================================
// Test Data Factories
// ============================================================================

function createTestPost(overrides: {
  content?: string;
  status?: PostStatus;
  type?: 'single' | 'thread' | 'quote' | 'reply';
  confidenceScore?: number;
}): ReturnType<typeof createPost> {
  return createPost({
    content: overrides.content ?? `Test post ${Date.now()}`,
    type: overrides.type ?? 'single',
    status: overrides.status ?? 'pending',
    confidenceScore: overrides.confidenceScore ?? 0.8,
  });
}

function seedQueueWithPosts(
  configs: Array<{ content: string; priority: number; status?: PostStatus }>
): Array<{ post: ReturnType<typeof createPost>; queueItem: ReturnType<typeof createQueueItem> }> {
  return configs.map((config) => {
    const post = createTestPost({
      content: config.content,
      status: config.status ?? 'pending',
    });
    const queueItem = createQueueItem({
      postId: post.id,
      priority: config.priority,
    });
    return { post, queueItem };
  });
}

// ============================================================================
// Queue Listing Tests
// ============================================================================

describe('Queue Management Integration - Listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('returns only pending posts in queue', async () => {
    // Seed posts in various states
    createTestPost({ content: 'Pending 1', status: 'pending' });
    createTestPost({ content: 'Pending 2', status: 'pending' });
    createTestPost({ content: 'Approved', status: 'approved' });
    createTestPost({ content: 'Rejected', status: 'rejected' });
    createTestPost({ content: 'Draft', status: 'draft' });

    const { GET } = await import('@/app/api/queue/route');
    const response = GET(createMockRequest('/api/queue'));

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.posts).toHaveLength(2);
    expect(data.total).toBe(2);
    const posts = data.posts as Array<{ status: string }>;
    posts.forEach((p) => {
      expect(p.status).toBe('pending');
    });
  });

  it('orders posts by queue priority descending', async () => {
    seedQueueWithPosts([
      { content: 'Low priority', priority: 1 },
      { content: 'High priority', priority: 10 },
      { content: 'Medium priority', priority: 5 },
    ]);

    const { GET } = await import('@/app/api/queue/route');
    const response = GET(createMockRequest('/api/queue'));

    const data = await response.json();
    expect(data.posts[0].content).toBe('High priority');
    expect(data.posts[1].content).toBe('Medium priority');
    expect(data.posts[2].content).toBe('Low priority');
  });

  it('handles posts without queue items (priority defaults to 0)', async () => {
    const withQueue = createTestPost({ content: 'With queue', status: 'pending' });
    createQueueItem({ postId: withQueue.id, priority: 5 });

    createTestPost({ content: 'Without queue', status: 'pending' });

    const { GET } = await import('@/app/api/queue/route');
    const response = GET(createMockRequest('/api/queue'));

    const data = await response.json();
    expect(data.posts).toHaveLength(2);
    // Post with priority 5 should come first
    expect(data.posts[0].content).toBe('With queue');
    expect(data.posts[1].content).toBe('Without queue');
  });

  it('respects pagination offset and limit', async () => {
    for (let i = 0; i < 10; i++) {
      const post = createTestPost({ content: `Post ${i}`, status: 'pending' });
      createQueueItem({ postId: post.id, priority: 10 - i });
    }

    const { GET } = await import('@/app/api/queue/route');
    const response = GET(createMockRequest('/api/queue?limit=3&offset=2'));

    const data = await response.json();
    expect(data.posts).toHaveLength(3);
    expect(data.total).toBe(10);
    expect(data.hasMore).toBe(true);
    expect(data.posts[0].content).toBe('Post 2');
  });

  it('returns empty when no pending posts', async () => {
    createTestPost({ content: 'Approved only', status: 'approved' });

    const { GET } = await import('@/app/api/queue/route');
    const response = GET(createMockRequest('/api/queue'));

    const data = await response.json();
    expect(data.posts).toHaveLength(0);
    expect(data.total).toBe(0);
    expect(data.hasMore).toBe(false);
  });
});

// ============================================================================
// Queue Reordering Tests
// ============================================================================

describe('Queue Management Integration - Reordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('creates new queue item when post not in queue', async () => {
    const post = createTestPost({ content: 'New to queue', status: 'pending' });

    const { POST } = await import('@/app/api/queue/route');
    const request = createMockRequest('/api/queue', {
      method: 'POST',
      body: { postId: post.id, priority: 7 },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.created).toBe(true);
    expect(data.item.postId).toBe(post.id);
    expect(data.item.priority).toBe(7);

    // Verify persisted
    const queueItem = getQueueItemByPostId(post.id);
    expect(queueItem?.priority).toBe(7);
  });

  it('updates existing queue item priority', async () => {
    const post = createTestPost({ content: 'Already in queue', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 3 });

    const { POST } = await import('@/app/api/queue/route');
    const request = createMockRequest('/api/queue', {
      method: 'POST',
      body: { postId: post.id, priority: 10 },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.created).toBe(false);
    expect(data.item.priority).toBe(10);

    // Verify persisted
    const queueItem = getQueueItemByPostId(post.id);
    expect(queueItem?.priority).toBe(10);
  });

  it('validates postId is required', async () => {
    const { POST } = await import('@/app/api/queue/route');
    const request = createMockRequest('/api/queue', {
      method: 'POST',
      body: { priority: 5 },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('postId');
  });

  it('validates priority is required', async () => {
    const post = createTestPost({ content: 'Test', status: 'pending' });

    const { POST } = await import('@/app/api/queue/route');
    const request = createMockRequest('/api/queue', {
      method: 'POST',
      body: { postId: post.id },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('priority');
  });
});

// ============================================================================
// Approval Flow Tests
// ============================================================================

describe('Queue Management Integration - Approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('approves pending post and updates status', async () => {
    const post = createTestPost({ content: 'Approve me', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 5 });

    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const request = createMockRequest(`/api/posts/${post.id}/approve`, {
      method: 'POST',
      body: {},
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.post.status).toBe('approved');
    expect(data.feedbackId).toBeGreaterThan(0);

    // Verify post status persisted
    const updatedPost = getPostById(post.id);
    expect(updatedPost?.status).toBe('approved');
  });

  it('removes post from queue on approval', async () => {
    const post = createTestPost({ content: 'Queue removal test', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 5 });

    expect(getQueueItemByPostId(post.id)).not.toBeNull();

    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const request = createMockRequest(`/api/posts/${post.id}/approve`, {
      method: 'POST',
      body: {},
    });

    await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

    // Queue item should be deleted
    expect(getQueueItemByPostId(post.id)).toBeNull();
  });

  it('creates approval feedback entry', async () => {
    const post = createTestPost({ content: 'Feedback test', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const request = createMockRequest(`/api/posts/${post.id}/approve`, {
      method: 'POST',
      body: { comment: 'Great post!' },
    });

    await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

    const feedback = getFeedbackByPostId(post.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].action).toBe('approve');
    expect(feedback[0].comment).toBe('Great post!');
  });

  it('handles exceptional approval with isExceptional flag', async () => {
    const post = createTestPost({ content: 'Exceptional post', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const request = createMockRequest(`/api/posts/${post.id}/approve`, {
      method: 'POST',
      body: { isExceptional: true, comment: 'This is amazing!' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.post.status).toBe('approved');
  });

  it('prevents approving already approved post', async () => {
    const post = createTestPost({ content: 'Already approved', status: 'approved' });

    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const request = createMockRequest(`/api/posts/${post.id}/approve`, {
      method: 'POST',
      body: {},
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('already approved');
  });

  it('returns 404 for non-existent post', async () => {
    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const request = createMockRequest('/api/posts/99999/approve', {
      method: 'POST',
      body: {},
    });

    const response = await POST(request, { params: Promise.resolve({ id: '99999' }) });
    expect(response.status).toBe(404);
  });
});

// ============================================================================
// Rejection Flow Tests
// ============================================================================

describe('Queue Management Integration - Rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('rejects post with category and updates status', async () => {
    const post = createTestPost({ content: 'Reject me', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 5 });

    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    const request = createMockRequest(`/api/posts/${post.id}/reject`, {
      method: 'POST',
      body: { category: 'tone', comment: 'Too formal' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.post.status).toBe('rejected');
    expect(data.feedbackId).toBeGreaterThan(0);

    // Verify post status persisted
    const updatedPost = getPostById(post.id);
    expect(updatedPost?.status).toBe('rejected');
  });

  it('removes post from queue on rejection', async () => {
    const post = createTestPost({ content: 'Queue removal on reject', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 5 });

    expect(getQueueItemByPostId(post.id)).not.toBeNull();

    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    const request = createMockRequest(`/api/posts/${post.id}/reject`, {
      method: 'POST',
      body: { category: 'generic' },
    });

    await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

    // Queue item should be deleted
    expect(getQueueItemByPostId(post.id)).toBeNull();
  });

  it('stores feedback with correct category', async () => {
    // Unused post for setting up test context, prefixed with _ to satisfy lint
    const _post = createTestPost({ content: 'Category test', status: 'pending' });

    const categories: FeedbackCategory[] = [
      'generic',
      'tone',
      'hook',
      'value',
      'topic',
      'timing',
      'other',
    ];

    for (const category of categories) {
      const newPost = createTestPost({ content: `Test for ${category}`, status: 'pending' });

      const { POST } = await import('@/app/api/posts/[id]/reject/route');
      const request = createMockRequest(`/api/posts/${newPost.id}/reject`, {
        method: 'POST',
        body: { category, comment: `Rejected for ${category}` },
      });

      await POST(request, { params: Promise.resolve({ id: String(newPost.id) }) });

      const feedback = getFeedbackByPostId(newPost.id);
      expect(feedback).toHaveLength(1);
      expect(feedback[0].category).toBe(category);
    }
  });

  it('requires category field', async () => {
    const post = createTestPost({ content: 'No category', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    const request = createMockRequest(`/api/posts/${post.id}/reject`, {
      method: 'POST',
      body: {},
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('category is required');
  });

  it('validates category values', async () => {
    const post = createTestPost({ content: 'Invalid category', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    const request = createMockRequest(`/api/posts/${post.id}/reject`, {
      method: 'POST',
      body: { category: 'invalid_category' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('category must be one of');
  });

  it('prevents rejecting already rejected post', async () => {
    const post = createTestPost({ content: 'Already rejected', status: 'rejected' });

    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    const request = createMockRequest(`/api/posts/${post.id}/reject`, {
      method: 'POST',
      body: { category: 'generic' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('already rejected');
  });
});

// ============================================================================
// Edit Flow Tests
// ============================================================================

describe('Queue Management Integration - Editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('edits post content and captures diff', async () => {
    const post = createTestPost({ content: 'Original content', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    const request = createMockRequest(`/api/posts/${post.id}/edit`, {
      method: 'POST',
      body: { content: 'Edited content', comment: 'Improved wording' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.post.content).toBe('Edited content');
    expect(data.diffCaptured).toBe(true);
    expect(data.feedbackId).toBeGreaterThan(0);

    // Verify content persisted
    const updatedPost = getPostById(post.id);
    expect(updatedPost?.content).toBe('Edited content');
  });

  it('keeps post in queue after edit (does NOT delete queue item)', async () => {
    const post = createTestPost({ content: 'Stay in queue', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 5 });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    const request = createMockRequest(`/api/posts/${post.id}/edit`, {
      method: 'POST',
      body: { content: 'Edited version', comment: 'Minor tweak' },
    });

    await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

    // Queue item should still exist
    const queueItem = getQueueItemByPostId(post.id);
    expect(queueItem).not.toBeNull();
    expect(queueItem?.priority).toBe(5);
  });

  it('captures diff with before and after content', async () => {
    const post = createTestPost({ content: 'Before edit', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    const request = createMockRequest(`/api/posts/${post.id}/edit`, {
      method: 'POST',
      body: { content: 'After edit' },
    });

    await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

    const feedback = getFeedbackByPostId(post.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].action).toBe('edit');
    expect(feedback[0].diffBefore).toBe('Before edit');
    expect(feedback[0].diffAfter).toBe('After edit');
  });

  it('sets diffCaptured to false when content unchanged', async () => {
    const post = createTestPost({ content: 'Same content', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    const request = createMockRequest(`/api/posts/${post.id}/edit`, {
      method: 'POST',
      body: { content: 'Same content' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    const data = await response.json();

    expect(data.diffCaptured).toBe(false);
  });

  it('allows multiple edits on same post', async () => {
    const post = createTestPost({ content: 'Version 1', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');

    // First edit
    await POST(
      createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'Version 2' },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    // Second edit
    await POST(
      createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'Version 3' },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    const feedback = getFeedbackByPostId(post.id);
    expect(feedback).toHaveLength(2);
    expect(feedback[0].action).toBe('edit');
    expect(feedback[1].action).toBe('edit');

    const updatedPost = getPostById(post.id);
    expect(updatedPost?.content).toBe('Version 3');
  });

  it('requires content field', async () => {
    const post = createTestPost({ content: 'Need content', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    const request = createMockRequest(`/api/posts/${post.id}/edit`, {
      method: 'POST',
      body: {},
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('content');
  });

  it('validates content is non-empty string', async () => {
    const post = createTestPost({ content: 'Valid', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    const request = createMockRequest(`/api/posts/${post.id}/edit`, {
      method: 'POST',
      body: { content: '' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// Feedback Collection and Stats Tests
// ============================================================================

describe('Queue Management Integration - Feedback Collection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('collects feedback batch excluding approvals', async () => {
    // Create posts with various feedback
    const approvedPost = createTestPost({ content: 'Approved', status: 'approved' });
    const rejectedPost = createTestPost({ content: 'Rejected', status: 'rejected' });
    const editedPost = createTestPost({ content: 'Edited', status: 'pending' });

    createFeedback({ postId: approvedPost.id, action: 'approve', comment: 'Good' });
    createFeedback({ postId: rejectedPost.id, action: 'reject', category: 'tone', comment: 'Bad' });
    createFeedback({
      postId: editedPost.id,
      action: 'edit',
      diffBefore: 'old',
      diffAfter: 'new',
      comment: 'Fixed',
    });

    const { collectFeedbackBatch } = await import('@/lib/learning/feedback-processor');
    const batch = collectFeedbackBatch({ limit: 10 });

    // Should only include reject and edit feedback (not approve)
    expect(batch.feedbackItems).toHaveLength(2);
    // FeedbackItem type only allows 'reject' | 'edit', so approvals are filtered out
    const actions = batch.feedbackItems.map((item) => item.action);
    expect(actions).toContain('reject');
    expect(actions).toContain('edit');
  });

  it('tracks feedback stats by action', async () => {
    const post1 = createTestPost({ content: 'Post 1', status: 'approved' });
    const post2 = createTestPost({ content: 'Post 2', status: 'rejected' });
    const post3 = createTestPost({ content: 'Post 3', status: 'pending' });
    const post4 = createTestPost({ content: 'Post 4', status: 'rejected' });

    createFeedback({ postId: post1.id, action: 'approve' });
    createFeedback({ postId: post2.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post3.id, action: 'edit', diffBefore: 'a', diffAfter: 'b' });
    createFeedback({ postId: post4.id, action: 'reject', category: 'hook' });

    const { getFeedbackStats } = await import('@/lib/learning/feedback-processor');
    const stats = getFeedbackStats();

    expect(stats.total).toBe(4);
    expect(stats.byAction.approve).toBe(1);
    expect(stats.byAction.reject).toBe(2);
    expect(stats.byAction.edit).toBe(1);
  });

  it('tracks feedback stats by category', async () => {
    const post1 = createTestPost({ content: 'Post 1', status: 'rejected' });
    const post2 = createTestPost({ content: 'Post 2', status: 'rejected' });
    const post3 = createTestPost({ content: 'Post 3', status: 'rejected' });

    createFeedback({ postId: post1.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post2.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post3.id, action: 'reject', category: 'hook' });

    const { getFeedbackStats } = await import('@/lib/learning/feedback-processor');
    const stats = getFeedbackStats();

    expect(stats.byCategory.tone).toBe(2);
    expect(stats.byCategory.hook).toBe(1);
    expect(stats.byCategory.generic).toBe(0);
  });
});

// ============================================================================
// Pattern Learning Tests
// ============================================================================

describe('Queue Management Integration - Pattern Learning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('finds similar patterns using Jaccard similarity', async () => {
    // Create some existing patterns
    createPattern({
      patternType: 'rejection',
      description: 'Avoid using corporate jargon in posts',
      evidenceCount: 3,
    });
    createPattern({
      patternType: 'rejection',
      description: 'Keep sentences short and punchy',
      evidenceCount: 2,
    });

    const { findSimilarPatterns } = await import('@/lib/learning/patterns');

    // Should find similar pattern
    const similar = findSimilarPatterns('Avoid corporate jargon language', 'rejection');
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0].similarity).toBeGreaterThanOrEqual(0.5);

    // Should not find similar when different topic
    const different = findSimilarPatterns('Use more emojis in posts', 'rejection');
    expect(different.length).toBe(0);
  });

  it('stores new pattern when no similar exists', async () => {
    const { storePattern } = await import('@/lib/learning/patterns');

    const result = storePattern('Always include a call to action', 'voice', 1, 'rejection');

    expect(result.action).toBe('created');
    expect(result.patternId).toBeGreaterThan(0);

    // Verify persisted
    const pattern = getPatternById(result.patternId);
    expect(pattern?.description).toBe('Always include a call to action');
    expect(pattern?.patternType).toBe('voice');
  });

  it('reinforces existing pattern when similar found', async () => {
    // Create existing pattern
    const existing = createPattern({
      patternType: 'rejection',
      description: 'Avoid using passive voice in posts',
      evidenceCount: 2,
    });

    const { storePattern } = await import('@/lib/learning/patterns');

    // Store similar pattern
    const result = storePattern('Avoid passive voice writing', 'rejection', 1, 'rejection');

    expect(result.action).toBe('reinforced');
    expect(result.existingPatternId).toBe(existing.id);

    // Verify evidence count incremented
    const updated = getPatternById(existing.id);
    expect(updated?.evidenceCount).toBe(3);
  });

  it('retrieves patterns for generation by type', async () => {
    createPattern({ patternType: 'voice', description: 'Be direct', evidenceCount: 5 });
    createPattern({ patternType: 'voice', description: 'Use examples', evidenceCount: 3 });
    createPattern({ patternType: 'hook', description: 'Start with question', evidenceCount: 4 });
    createPattern({ patternType: 'rejection', description: 'Avoid jargon', evidenceCount: 2 });

    const { getVoicePatterns, getRejectionPatterns } = await import('@/lib/learning/patterns');

    const voicePatterns = getVoicePatterns();
    expect(voicePatterns.every((p) => p.type === 'voice')).toBe(true);
    expect(voicePatterns.length).toBe(2);

    const rejectionPatterns = getRejectionPatterns();
    expect(rejectionPatterns.every((p) => p.type === 'rejection')).toBe(true);
    expect(rejectionPatterns.length).toBe(1);
  });

  it('filters patterns by minimum evidence count', async () => {
    createPattern({ patternType: 'voice', description: 'Low evidence', evidenceCount: 1 });
    createPattern({ patternType: 'voice', description: 'High evidence', evidenceCount: 5 });
    createPattern({ patternType: 'voice', description: 'Medium evidence', evidenceCount: 3 });

    const { getVoicePatterns } = await import('@/lib/learning/patterns');

    const patterns = getVoicePatterns(3);
    expect(patterns.length).toBe(2);
    expect(patterns.every((p) => p.evidenceCount >= 3)).toBe(true);
  });

  it('calculates weighted score from edit and rejection evidence', async () => {
    // Create pattern (used implicitly through findSimilarPatterns)
    createPattern({
      patternType: 'rejection',
      description: 'Test weighted score',
      evidenceCount: 5,
      editEvidenceCount: 2,
      rejectionEvidenceCount: 3,
    });

    const { findSimilarPatterns } = await import('@/lib/learning/patterns');
    const similar = findSimilarPatterns('Test weighted score', 'rejection');

    expect(similar.length).toBe(1);
    // Weighted score = (2 * 3) + (3 * 1) = 9 (edit weight is 3, rejection weight is 1)
    expect(similar[0].pattern.weightedScore).toBe(9);
  });
});

// ============================================================================
// Status Transition Validation Tests
// ============================================================================

describe('Queue Management Integration - Status Transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('allows pending -> approved transition', async () => {
    const post = createTestPost({ content: 'Pending to approved', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const response = await POST(
      createMockRequest(`/api/posts/${post.id}/approve`, { method: 'POST', body: {} }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    expect(response.status).toBe(200);
    expect(getPostById(post.id)?.status).toBe('approved');
  });

  it('allows pending -> rejected transition', async () => {
    const post = createTestPost({ content: 'Pending to rejected', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    const response = await POST(
      createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: { category: 'generic' },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    expect(response.status).toBe(200);
    expect(getPostById(post.id)?.status).toBe('rejected');
  });

  it('allows draft -> approved transition', async () => {
    const post = createTestPost({ content: 'Draft to approved', status: 'draft' });

    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const response = await POST(
      createMockRequest(`/api/posts/${post.id}/approve`, { method: 'POST', body: {} }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    expect(response.status).toBe(200);
    expect(getPostById(post.id)?.status).toBe('approved');
  });

  it('allows rejected -> approved transition (reconsideration)', async () => {
    // The API allows approving previously rejected posts for reconsideration
    const post = createTestPost({ content: 'Rejected then reconsidered', status: 'rejected' });

    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const response = await POST(
      createMockRequest(`/api/posts/${post.id}/approve`, { method: 'POST', body: {} }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    expect(response.status).toBe(200);
    expect(getPostById(post.id)?.status).toBe('approved');
  });

  it('edit does not change post status', async () => {
    const post = createTestPost({ content: 'Original', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    await POST(
      createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'Edited' },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    expect(getPostById(post.id)?.status).toBe('pending');
  });
});

// ============================================================================
// INT-003: Queue Workflow with Pattern Learning
// ============================================================================

describe('INT-003: Queue Workflow Integration - Pattern Learning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('view queue -> approve post -> verify feedback stored', async () => {
    // Step 1: Create and view post in queue
    const post = createTestPost({ content: 'Approve workflow test', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 7 });

    // View queue and verify post is visible
    const { GET } = await import('@/app/api/queue/route');
    const queueResponse = GET(createMockRequest('/api/queue'));
    const queueData = await queueResponse.json();
    const queuePosts = queueData.posts as Array<{ id: number }>;
    expect(queuePosts.some((p) => p.id === post.id)).toBe(true);

    // Step 2: Approve the post with feedback
    const { POST } = await import('@/app/api/posts/[id]/approve/route');
    const approveResponse = await POST(
      createMockRequest(`/api/posts/${post.id}/approve`, {
        method: 'POST',
        body: { comment: 'Great content, well written!', isExceptional: true },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    expect(approveResponse.status).toBe(200);

    // Step 3: Verify feedback is stored
    const feedback = getFeedbackByPostId(post.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].action).toBe('approve');
    // When isExceptional is true, the API prepends [EXCEPTIONAL] to the comment
    expect(feedback[0].comment).toBe('[EXCEPTIONAL] Great content, well written!');

    // Verify post is approved and removed from queue
    const updatedPost = getPostById(post.id);
    expect(updatedPost?.status).toBe('approved');
    expect(getQueueItemByPostId(post.id)).toBeNull();
  });

  it('view queue -> reject post -> verify feedback stored -> pattern learning triggered', async () => {
    // Step 1: Create and view post in queue
    const post = createTestPost({ content: 'Too corporate sounding post', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 5 });

    // Verify post in queue
    const { GET } = await import('@/app/api/queue/route');
    const queueResponse = GET(createMockRequest('/api/queue'));
    const queueData = await queueResponse.json();
    expect((queueData.posts as Array<{ id: number }>).some((p) => p.id === post.id)).toBe(true);

    // Step 2: Reject post with category and detailed comment
    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    await POST(
      createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: {
          category: 'tone',
          comment: 'Avoid using corporate jargon and formal language',
        },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    // Step 3: Verify feedback is stored with category
    const feedback = getFeedbackByPostId(post.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].action).toBe('reject');
    expect(feedback[0].category).toBe('tone');
    expect(feedback[0].comment).toContain('corporate jargon');

    // Step 4: Verify pattern learning can be triggered
    const { collectFeedbackBatch } = await import('@/lib/learning/feedback-processor');
    const batch = collectFeedbackBatch({ limit: 10 });

    // Batch should contain the rejection feedback
    expect(batch.feedbackItems.length).toBeGreaterThanOrEqual(1);
    const rejectionItem = batch.feedbackItems.find(
      (item) => item.action === 'reject' && item.category === 'tone'
    );
    expect(rejectionItem).toBeDefined();
    expect(rejectionItem?.originalContent).toBe('Too corporate sounding post');
  });

  it('view queue -> edit post -> verify feedback stored -> pattern learning triggered', async () => {
    // Step 1: Create post in queue
    const post = createTestPost({ content: 'Original boring content', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 6 });

    // Step 2: Edit the post
    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    await POST(
      createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: {
          content: 'Exciting and engaging content!',
          comment: 'Made it more lively',
        },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    // Step 3: Verify feedback stored with diff
    const feedback = getFeedbackByPostId(post.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].action).toBe('edit');
    expect(feedback[0].diffBefore).toBe('Original boring content');
    expect(feedback[0].diffAfter).toBe('Exciting and engaging content!');

    // Step 4: Verify edit feedback available for pattern learning
    const { collectFeedbackBatch } = await import('@/lib/learning/feedback-processor');
    const batch = collectFeedbackBatch({ limit: 10 });

    const editItem = batch.feedbackItems.find((item) => item.action === 'edit');
    expect(editItem).toBeDefined();
    // Note: collectFeedbackBatch uses post.content which is the current (edited) content
    // The original content is stored in feedback.diffBefore, editedContent comes from feedback.diffAfter
    expect(editItem?.originalContent).toBe('Exciting and engaging content!');
    expect(editItem?.editedContent).toBe('Exciting and engaging content!');
  });

  it('multiple queue actions trigger pattern learning with correct evidence', async () => {
    // Create multiple posts and perform various actions
    const post1 = createTestPost({ content: 'Post with bad hook', status: 'pending' });
    const post2 = createTestPost({ content: 'Post with wrong tone', status: 'pending' });
    const post3 = createTestPost({ content: 'Post needing edit', status: 'pending' });

    createQueueItem({ postId: post1.id, priority: 5 });
    createQueueItem({ postId: post2.id, priority: 5 });
    createQueueItem({ postId: post3.id, priority: 5 });

    // Reject post1 for hook
    const { POST: RejectPost } = await import('@/app/api/posts/[id]/reject/route');
    await RejectPost(
      createMockRequest(`/api/posts/${post1.id}/reject`, {
        method: 'POST',
        body: { category: 'hook', comment: 'Hook does not grab attention' },
      }),
      { params: Promise.resolve({ id: String(post1.id) }) }
    );

    // Reject post2 for tone
    await RejectPost(
      createMockRequest(`/api/posts/${post2.id}/reject`, {
        method: 'POST',
        body: { category: 'tone', comment: 'Too formal and stiff' },
      }),
      { params: Promise.resolve({ id: String(post2.id) }) }
    );

    // Edit post3
    const { POST: EditPost } = await import('@/app/api/posts/[id]/edit/route');
    await EditPost(
      createMockRequest(`/api/posts/${post3.id}/edit`, {
        method: 'POST',
        body: { content: 'Improved post content', comment: 'Better flow' },
      }),
      { params: Promise.resolve({ id: String(post3.id) }) }
    );

    // Verify all feedback collected
    const { collectFeedbackBatch, getFeedbackStats } =
      await import('@/lib/learning/feedback-processor');
    const batch = collectFeedbackBatch({ limit: 20 });

    expect(batch.feedbackItems).toHaveLength(3);
    expect(batch.feedbackItems.filter((i) => i.action === 'reject')).toHaveLength(2);
    expect(batch.feedbackItems.filter((i) => i.action === 'edit')).toHaveLength(1);

    // Verify stats reflect correct categories
    const stats = getFeedbackStats();
    expect(stats.byAction.reject).toBe(2);
    expect(stats.byAction.edit).toBe(1);
    expect(stats.byCategory.hook).toBe(1);
    expect(stats.byCategory.tone).toBe(1);
  });

  it('rejection feedback can be used to store patterns directly', async () => {
    // Create and reject a post
    const post = createTestPost({ content: 'Generic AI sounding post', status: 'pending' });

    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    await POST(
      createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: {
          category: 'generic',
          comment: 'Avoid generic AI sounding phrases like additionally and furthermore',
        },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    // Directly store a pattern from the rejection feedback
    const { storePattern, findSimilarPatterns } = await import('@/lib/learning/patterns');

    const result = storePattern(
      'Avoid generic AI phrases like additionally and furthermore',
      'rejection',
      1,
      'rejection'
    );

    expect(result.action).toBe('created');
    expect(result.patternId).toBeGreaterThan(0);

    // Verify pattern can be found
    const similar = findSimilarPatterns(
      'Avoid using AI phrases additionally furthermore',
      'rejection'
    );
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0].similarity).toBeGreaterThanOrEqual(0.5);
  });

  it('edit feedback can be used to store edit patterns', async () => {
    // Create and edit a post
    const post = createTestPost({
      content: 'This post lacks energy and enthusiasm.',
      status: 'pending',
    });

    const { POST } = await import('@/app/api/posts/[id]/edit/route');
    await POST(
      createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: {
          content: 'This post is packed with energy and enthusiasm!',
          comment: 'Added exclamation and stronger words',
        },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    // Store pattern from edit feedback
    const { storePattern, getEditPatterns } = await import('@/lib/learning/patterns');

    storePattern('Use stronger, more energetic language with exclamations', 'edit', 1, 'edit');

    // Verify edit patterns can be retrieved
    const editPatterns = getEditPatterns(1);
    expect(editPatterns.length).toBeGreaterThan(0);
    expect(editPatterns.some((p) => p.description.includes('energetic'))).toBe(true);
  });

  it('pattern retrieval for generation considers decay and weighted scores', async () => {
    // Create patterns with different evidence counts
    createPattern({
      patternType: 'voice',
      description: 'High evidence pattern for voice',
      evidenceCount: 10,
      editEvidenceCount: 5,
      rejectionEvidenceCount: 2,
    });
    createPattern({
      patternType: 'voice',
      description: 'Low evidence pattern for voice',
      evidenceCount: 1,
      editEvidenceCount: 0,
      rejectionEvidenceCount: 1,
    });
    createPattern({
      patternType: 'rejection',
      description: 'High evidence rejection pattern',
      evidenceCount: 8,
      editEvidenceCount: 2,
      rejectionEvidenceCount: 6,
    });

    const { getPatternsForGeneration } = await import('@/lib/learning/patterns');

    // Get patterns for generation - should prioritize by decay score then weighted score
    const patterns = getPatternsForGeneration({
      types: ['voice', 'rejection'],
      minEvidenceCount: 1,
      limit: 10,
    });

    expect(patterns.length).toBe(3);

    // High evidence patterns should have higher weighted scores
    const highEvidence = patterns.find((p) => p.description.includes('High evidence'));
    const lowEvidence = patterns.find((p) => p.description.includes('Low evidence'));

    expect(highEvidence).toBeDefined();
    expect(lowEvidence).toBeDefined();
    if (highEvidence && lowEvidence) {
      expect(highEvidence.weightedScore).toBeGreaterThan(lowEvidence.weightedScore);
    }
  });
});

// ============================================================================
// End-to-End Workflow Tests
// ============================================================================

describe('Queue Management Integration - Full Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('complete workflow: create -> edit -> approve -> not in queue', async () => {
    // Step 1: Create post and add to queue
    const post = createTestPost({ content: 'Initial draft', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 5 });

    // Verify in queue
    const { GET } = await import('@/app/api/queue/route');
    let queueResponse = GET(createMockRequest('/api/queue'));
    let queueData = await queueResponse.json();
    let queuePosts = queueData.posts as Array<{ id: number }>;
    expect(queuePosts.some((p) => p.id === post.id)).toBe(true);

    // Step 2: Edit the post
    const { POST: EditPost } = await import('@/app/api/posts/[id]/edit/route');
    await EditPost(
      createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'Improved draft', comment: 'Better wording' },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    // Still in queue after edit
    queueResponse = GET(createMockRequest('/api/queue'));
    queueData = await queueResponse.json();
    queuePosts = queueData.posts as Array<{ id: number }>;
    expect(queuePosts.some((p) => p.id === post.id)).toBe(true);

    // Step 3: Approve the post
    const { POST: ApprovePost } = await import('@/app/api/posts/[id]/approve/route');
    await ApprovePost(
      createMockRequest(`/api/posts/${post.id}/approve`, {
        method: 'POST',
        body: { comment: 'Ready to post' },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    // No longer in queue after approval
    queueResponse = GET(createMockRequest('/api/queue'));
    queueData = await queueResponse.json();
    queuePosts = queueData.posts as Array<{ id: number }>;
    expect(queuePosts.some((p) => p.id === post.id)).toBe(false);

    // Verify feedback trail
    const feedback = getFeedbackByPostId(post.id);
    expect(feedback).toHaveLength(2);
    expect(feedback.map((f) => f.action).sort()).toEqual(['approve', 'edit']);
  });

  it('complete workflow: create -> reject -> feedback stored', async () => {
    const post = createTestPost({ content: 'Poor quality post', status: 'pending' });
    createQueueItem({ postId: post.id, priority: 3 });

    // Reject with detailed feedback
    const { POST } = await import('@/app/api/posts/[id]/reject/route');
    await POST(
      createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: {
          category: 'tone',
          comment: 'Too formal, needs to be more conversational',
        },
      }),
      { params: Promise.resolve({ id: String(post.id) }) }
    );

    // Verify state
    const updatedPost = getPostById(post.id);
    expect(updatedPost?.status).toBe('rejected');

    // Not in queue
    expect(getQueueItemByPostId(post.id)).toBeNull();

    // Feedback stored for learning
    const feedback = getFeedbackByPostId(post.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].category).toBe('tone');
    expect(feedback[0].comment).toContain('conversational');
  });

  it('handles high volume queue operations', async () => {
    // Create 20 posts with varying priorities
    for (let i = 0; i < 20; i++) {
      const post = createTestPost({ content: `Post ${i}`, status: 'pending' });
      createQueueItem({ postId: post.id, priority: i % 10 });
    }

    const { GET } = await import('@/app/api/queue/route');

    // Paginate through all
    const allPosts: Array<{ id: number }> = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const response = GET(createMockRequest(`/api/queue?limit=5&offset=${offset}`));
      const data = await response.json();
      const posts = data.posts as Array<{ id: number }>;
      allPosts.push(...posts);
      hasMore = data.hasMore as boolean;
      offset += 5;
    }

    expect(allPosts).toHaveLength(20);

    // Verify ordering is maintained (higher priority first)
    for (let i = 1; i < allPosts.length; i++) {
      const current = getQueueItemByPostId(allPosts[i].id);
      const previous = getQueueItemByPostId(allPosts[i - 1].id);
      const currentPriority = current?.priority ?? 0;
      const previousPriority = previous?.priority ?? 0;
      expect(currentPriority).toBeLessThanOrEqual(previousPriority);
    }
  });
});
