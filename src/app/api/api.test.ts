/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createPost } from '@/db/models/posts';
import { createFeedback } from '@/db/models/feedback';
import { createPattern } from '@/db/models/patterns';
import { createQueueItem } from '@/db/models/queue';

vi.mock('@/db/chroma/collections/approved-posts', () => ({
  addApprovedPost: vi.fn().mockResolvedValue(undefined),
}));

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

describe('Posts API Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/posts', () => {
    it('returns empty list when no posts exist', async () => {
      const { GET } = await import('./posts/route');
      const request = createMockRequest('/api/posts');
      const response = GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.posts).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.hasMore).toBe(false);
    });

    it('returns posts with pagination', async () => {
      createPost({ content: 'Post 1', type: 'single', status: 'pending' });
      createPost({ content: 'Post 2', type: 'single', status: 'pending' });
      createPost({ content: 'Post 3', type: 'single', status: 'pending' });

      const { GET } = await import('./posts/route');
      const request = createMockRequest('/api/posts?limit=2&offset=0');
      const response = GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.posts).toHaveLength(2);
      expect(data.total).toBe(3);
      expect(data.hasMore).toBe(true);
    });

    it('filters by status', async () => {
      createPost({ content: 'Draft', type: 'single', status: 'draft' });
      createPost({ content: 'Pending', type: 'single', status: 'pending' });
      createPost({ content: 'Approved', type: 'single', status: 'approved' });

      const { GET } = await import('./posts/route');
      const request = createMockRequest('/api/posts?status=pending');
      const response = GET(request);

      const data = await response.json();
      expect(data.posts).toHaveLength(1);
      expect(data.posts[0].content).toBe('Pending');
    });

    it('orders by created_at desc by default', async () => {
      createPost({ content: 'First', type: 'single' });
      createPost({ content: 'Second', type: 'single' });
      createPost({ content: 'Third', type: 'single' });

      const { GET } = await import('./posts/route');
      const request = createMockRequest('/api/posts');
      const response = GET(request);

      const data = await response.json();
      expect(data.posts[0].content).toBe('Third');
    });

    it('supports ordering by confidence_score', async () => {
      createPost({ content: 'Low', type: 'single', confidenceScore: 30 });
      createPost({ content: 'High', type: 'single', confidenceScore: 90 });
      createPost({ content: 'Medium', type: 'single', confidenceScore: 60 });

      const { GET } = await import('./posts/route');
      const request = createMockRequest('/api/posts?orderBy=confidence_score&orderDir=desc');
      const response = GET(request);

      const data = await response.json();
      expect(data.posts[0].content).toBe('High');
    });
  });

  describe('POST /api/posts', () => {
    it('creates a new post', async () => {
      const { POST } = await import('./posts/route');
      const request = createMockRequest('/api/posts', {
        method: 'POST',
        body: { content: 'Test post', type: 'single' },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.content).toBe('Test post');
      expect(data.type).toBe('single');
      expect(data.status).toBe('draft');
      expect(data.id).toBeDefined();
    });

    it('validates required content field', async () => {
      const { POST } = await import('./posts/route');
      const request = createMockRequest('/api/posts', {
        method: 'POST',
        body: { type: 'single' },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('content is required');
    });

    it('validates required type field', async () => {
      const { POST } = await import('./posts/route');
      const request = createMockRequest('/api/posts', {
        method: 'POST',
        body: { content: 'Test' },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('type is required');
    });

    it('validates type value', async () => {
      const { POST } = await import('./posts/route');
      const request = createMockRequest('/api/posts', {
        method: 'POST',
        body: { content: 'Test', type: 'invalid' },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('type');
    });

    it('validates confidenceScore range', async () => {
      const { POST } = await import('./posts/route');
      const request = createMockRequest('/api/posts', {
        method: 'POST',
        body: { content: 'Test', type: 'single', confidenceScore: 150 },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('confidenceScore');
    });

    it('creates post with optional fields', async () => {
      const { POST } = await import('./posts/route');
      const request = createMockRequest('/api/posts', {
        method: 'POST',
        body: {
          content: 'Test',
          type: 'thread',
          status: 'pending',
          confidenceScore: 75,
          reasoning: { source: 'Test source', concerns: ['Concern 1'] },
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.status).toBe('pending');
      expect(data.confidenceScore).toBe(75);
      expect(data.reasoning.source).toBe('Test source');
    });
  });

  describe('GET /api/posts/[id]', () => {
    it('returns a specific post', async () => {
      const post = createPost({ content: 'Test', type: 'single' });

      const { GET } = await import('./posts/[id]/route');
      const request = createMockRequest(`/api/posts/${post.id}`);
      const response = await GET(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(post.id);
      expect(data.content).toBe('Test');
    });

    it('returns 404 for non-existent post', async () => {
      const { GET } = await import('./posts/[id]/route');
      const request = createMockRequest('/api/posts/9999');
      const response = await GET(request, { params: Promise.resolve({ id: '9999' }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Post not found');
    });

    it('returns 400 for invalid ID', async () => {
      const { GET } = await import('./posts/[id]/route');
      const request = createMockRequest('/api/posts/invalid');
      const response = await GET(request, { params: Promise.resolve({ id: 'invalid' }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid post ID');
    });
  });

  describe('PATCH /api/posts/[id]', () => {
    it('updates a post', async () => {
      const post = createPost({ content: 'Original', type: 'single' });

      const { PATCH } = await import('./posts/[id]/route');
      const request = createMockRequest(`/api/posts/${post.id}`, {
        method: 'PATCH',
        body: { content: 'Updated' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content).toBe('Updated');
    });

    it('returns 404 for non-existent post', async () => {
      const { PATCH } = await import('./posts/[id]/route');
      const request = createMockRequest('/api/posts/9999', {
        method: 'PATCH',
        body: { content: 'Test' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: '9999' }) });

      expect(response.status).toBe(404);
    });

    it('validates type value on update', async () => {
      const post = createPost({ content: 'Test', type: 'single' });

      const { PATCH } = await import('./posts/[id]/route');
      const request = createMockRequest(`/api/posts/${post.id}`, {
        method: 'PATCH',
        body: { type: 'invalid' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/posts/[id]', () => {
    it('deletes a post', async () => {
      const post = createPost({ content: 'Test', type: 'single' });

      const { DELETE } = await import('./posts/[id]/route');
      const request = createMockRequest(`/api/posts/${post.id}`, { method: 'DELETE' });
      const response = await DELETE(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('returns 404 for non-existent post', async () => {
      const { DELETE } = await import('./posts/[id]/route');
      const request = createMockRequest('/api/posts/9999', { method: 'DELETE' });
      const response = await DELETE(request, { params: Promise.resolve({ id: '9999' }) });

      expect(response.status).toBe(404);
    });
  });
});

describe('Post Action Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('POST /api/posts/[id]/approve', () => {
    it('approves a pending post', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

      const { POST } = await import('./posts/[id]/approve/route');
      const request = createMockRequest(`/api/posts/${post.id}/approve`, {
        method: 'POST',
        body: {},
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.post.status).toBe('approved');
      expect(data.feedbackId).toBeDefined();
    });

    it('handles exceptional approval flag', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

      const { POST } = await import('./posts/[id]/approve/route');
      const request = createMockRequest(`/api/posts/${post.id}/approve`, {
        method: 'POST',
        body: { isExceptional: true, comment: 'Great post!' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
    });

    it('prevents double approval', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'approved' });

      const { POST } = await import('./posts/[id]/approve/route');
      const request = createMockRequest(`/api/posts/${post.id}/approve`, {
        method: 'POST',
        body: {},
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('already approved');
    });

    it('validates voiceScore range', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

      const { POST } = await import('./posts/[id]/approve/route');
      const request = createMockRequest(`/api/posts/${post.id}/approve`, {
        method: 'POST',
        body: { voiceScore: 150 },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('voiceScore');
    });
  });

  describe('POST /api/posts/[id]/reject', () => {
    it('rejects a pending post with category', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

      const { POST } = await import('./posts/[id]/reject/route');
      const request = createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: { category: 'generic' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.post.status).toBe('rejected');
      expect(data.feedbackId).toBeDefined();
    });

    it('requires category field', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

      const { POST } = await import('./posts/[id]/reject/route');
      const request = createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: {},
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('category is required');
    });

    it('validates category value', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

      const { POST } = await import('./posts/[id]/reject/route');
      const request = createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: { category: 'invalid' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('category must be one of');
    });

    it('prevents double rejection', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'rejected' });

      const { POST } = await import('./posts/[id]/reject/route');
      const request = createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: { category: 'generic' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('already rejected');
    });

    it('accepts optional comment', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

      const { POST } = await import('./posts/[id]/reject/route');
      const request = createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: { category: 'tone', comment: 'Too formal' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
    });
  });
});

describe('Queue API Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/queue', () => {
    it('returns empty queue when no pending posts', async () => {
      const { GET } = await import('./queue/route');
      const request = createMockRequest('/api/queue');
      const response = GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.posts).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('returns pending posts ordered by priority', async () => {
      const post1 = createPost({ content: 'Low priority', type: 'single', status: 'pending' });
      const post2 = createPost({ content: 'High priority', type: 'single', status: 'pending' });
      createQueueItem({ postId: post1.id, priority: 1 });
      createQueueItem({ postId: post2.id, priority: 10 });

      const { GET } = await import('./queue/route');
      const request = createMockRequest('/api/queue');
      const response = GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.posts[0].content).toBe('High priority');
    });

    it('respects limit parameter', async () => {
      createPost({ content: 'Post 1', type: 'single', status: 'pending' });
      createPost({ content: 'Post 2', type: 'single', status: 'pending' });
      createPost({ content: 'Post 3', type: 'single', status: 'pending' });

      const { GET } = await import('./queue/route');
      const request = createMockRequest('/api/queue?limit=2');
      const response = GET(request);

      const data = await response.json();
      expect(data.posts).toHaveLength(2);
      expect(data.hasMore).toBe(true);
    });

    it('excludes non-pending posts', async () => {
      createPost({ content: 'Pending', type: 'single', status: 'pending' });
      createPost({ content: 'Approved', type: 'single', status: 'approved' });
      createPost({ content: 'Draft', type: 'single', status: 'draft' });

      const { GET } = await import('./queue/route');
      const request = createMockRequest('/api/queue');
      const response = GET(request);

      const data = await response.json();
      expect(data.posts).toHaveLength(1);
      expect(data.posts[0].content).toBe('Pending');
    });
  });

  describe('POST /api/queue', () => {
    it('creates or updates queue priority', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

      const { POST } = await import('./queue/route');
      const request = createMockRequest('/api/queue', {
        method: 'POST',
        body: { postId: post.id, priority: 5 },
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.item.priority).toBe(5);
      expect(data.created).toBe(true);
    });

    it('updates existing queue item', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });
      createQueueItem({ postId: post.id, priority: 1 });

      const { POST } = await import('./queue/route');
      const request = createMockRequest('/api/queue', {
        method: 'POST',
        body: { postId: post.id, priority: 10 },
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.item.priority).toBe(10);
      expect(data.created).toBe(false);
    });

    it('validates postId is integer', async () => {
      const { POST } = await import('./queue/route');
      const request = createMockRequest('/api/queue', {
        method: 'POST',
        body: { postId: 'invalid', priority: 5 },
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('postId');
    });

    it('validates priority is integer', async () => {
      const { POST } = await import('./queue/route');
      const request = createMockRequest('/api/queue', {
        method: 'POST',
        body: { postId: 1, priority: 'high' },
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('priority');
    });
  });
});

describe('Patterns API Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/patterns', () => {
    it('returns empty list when no patterns exist', async () => {
      const { GET } = await import('./patterns/route');
      const request = createMockRequest('/api/patterns');
      const response = GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.patterns).toEqual([]);
    });

    it('returns patterns with pagination', async () => {
      createPattern({ patternType: 'voice', description: 'Pattern 1' });
      createPattern({ patternType: 'hook', description: 'Pattern 2' });

      const { GET } = await import('./patterns/route');
      const request = createMockRequest('/api/patterns');
      const response = GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.patterns).toHaveLength(2);
    });

    it('filters by pattern type', async () => {
      createPattern({ patternType: 'voice', description: 'Voice pattern' });
      createPattern({ patternType: 'hook', description: 'Hook pattern' });

      const { GET } = await import('./patterns/route');
      const request = createMockRequest('/api/patterns?patternType=voice');
      const response = GET(request);

      const data = await response.json();
      expect(data.patterns).toHaveLength(1);
      expect(data.patterns[0].description).toBe('Voice pattern');
    });
  });

  describe('DELETE /api/patterns/[id]', () => {
    it('deletes a pattern', async () => {
      const pattern = createPattern({ patternType: 'voice', description: 'Test' });

      const { DELETE } = await import('./patterns/[id]/route');
      const request = createMockRequest(`/api/patterns/${pattern.id}`, { method: 'DELETE' });
      const response = await DELETE(request, {
        params: Promise.resolve({ id: String(pattern.id) }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('returns 404 for non-existent pattern', async () => {
      const { DELETE } = await import('./patterns/[id]/route');
      const request = createMockRequest('/api/patterns/9999', { method: 'DELETE' });
      const response = await DELETE(request, { params: Promise.resolve({ id: '9999' }) });

      expect(response.status).toBe(404);
    });
  });
});

describe('Feedback API Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/feedback', () => {
    it('returns feedback history', async () => {
      const post = createPost({ content: 'Test', type: 'single' });
      createFeedback({ postId: post.id, action: 'approve' });
      createFeedback({ postId: post.id, action: 'reject', category: 'tone' });

      const { GET } = await import('./feedback/route');
      const request = createMockRequest('/api/feedback');
      const response = GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.feedback).toHaveLength(2);
    });

    it('filters by action', async () => {
      const post = createPost({ content: 'Test', type: 'single' });
      createFeedback({ postId: post.id, action: 'approve' });
      createFeedback({ postId: post.id, action: 'reject', category: 'tone' });

      const { GET } = await import('./feedback/route');
      const request = createMockRequest('/api/feedback?action=reject');
      const response = GET(request);

      const data = await response.json();
      expect(data.feedback).toHaveLength(1);
      expect(data.feedback[0].action).toBe('reject');
    });

    it('filters by postId', async () => {
      const post1 = createPost({ content: 'Post 1', type: 'single' });
      const post2 = createPost({ content: 'Post 2', type: 'single' });
      createFeedback({ postId: post1.id, action: 'approve' });
      createFeedback({ postId: post2.id, action: 'approve' });

      const { GET } = await import('./feedback/route');
      const request = createMockRequest(`/api/feedback?postId=${post1.id}`);
      const response = GET(request);

      const data = await response.json();
      expect(data.feedback).toHaveLength(1);
      expect(data.feedback[0].postId).toBe(post1.id);
    });
  });
});

describe('Stats API Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/stats', () => {
    it('returns dashboard statistics', async () => {
      createPost({ content: 'Pending 1', type: 'single', status: 'pending' });
      createPost({ content: 'Pending 2', type: 'single', status: 'pending' });
      createPost({ content: 'Approved', type: 'single', status: 'approved' });

      const { GET } = await import('./stats/route');
      const response = GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.queue.pendingCount).toBe(2);
      expect(data.posts.approvedCount).toBe(1);
      expect(data.timestamp).toBeDefined();
    });

    it('returns all stat sections', async () => {
      const { GET } = await import('./stats/route');
      const response = GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.queue).toBeDefined();
      expect(data.posts).toBeDefined();
      expect(data.feedback).toBeDefined();
      expect(data.patterns).toBeDefined();
      expect(data.sources).toBeDefined();
      expect(data.accounts).toBeDefined();
      expect(data.costs).toBeDefined();
    });

    it('calculates approval rates', async () => {
      const post1 = createPost({ content: 'Post 1', type: 'single', status: 'approved' });
      const post2 = createPost({ content: 'Post 2', type: 'single', status: 'rejected' });
      createFeedback({ postId: post1.id, action: 'approve' });
      createFeedback({ postId: post2.id, action: 'reject', category: 'generic' });

      const { GET } = await import('./stats/route');
      const response = GET();

      const data = await response.json();
      expect(data.feedback.approvalRate7d).toBeGreaterThanOrEqual(0);
      expect(data.feedback.approvalRate30d).toBeGreaterThanOrEqual(0);
      expect(data.feedback.trend).toBeDefined();
    });
  });
});

describe('Edit API Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('POST /api/posts/[id]/edit', () => {
    it('edits a post and captures diff', async () => {
      const post = createPost({ content: 'Original content', type: 'single', status: 'pending' });

      const { POST } = await import('./posts/[id]/edit/route');
      const request = createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'Edited content' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.post.content).toBe('Edited content');
      expect(data.feedbackId).toBeDefined();
      expect(data.diffCaptured).toBe(true);
    });

    it('requires content field', async () => {
      const post = createPost({ content: 'Test', type: 'single' });

      const { POST } = await import('./posts/[id]/edit/route');
      const request = createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: {},
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('content is required');
    });

    it('rejects empty content', async () => {
      const post = createPost({ content: 'Test', type: 'single' });

      const { POST } = await import('./posts/[id]/edit/route');
      const request = createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: '   ' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('cannot be empty');
    });

    it('returns 404 for non-existent post', async () => {
      const { POST } = await import('./posts/[id]/edit/route');
      const request = createMockRequest('/api/posts/9999/edit', {
        method: 'POST',
        body: { content: 'Test' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: '9999' }) });

      expect(response.status).toBe(404);
    });

    it('accepts optional comment', async () => {
      const post = createPost({ content: 'Original', type: 'single' });

      const { POST } = await import('./posts/[id]/edit/route');
      const request = createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'New content', comment: 'Made it more concise' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
    });

    it('sets diffCaptured to false when content unchanged', async () => {
      const post = createPost({ content: 'Same content', type: 'single' });

      const { POST } = await import('./posts/[id]/edit/route');
      const request = createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'Same content' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.diffCaptured).toBe(false);
    });
  });
});

describe('Export API Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/export', () => {
    it('requires format parameter', async () => {
      const { GET } = await import('./export/route');
      const request = createMockRequest('/api/export');
      const response = GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('format');
    });

    it('rejects invalid format', async () => {
      const { GET } = await import('./export/route');
      const request = createMockRequest('/api/export?format=xml');
      const response = GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('json or ?format=csv');
    });

    it('exports data as JSON', async () => {
      createPost({ content: 'Test post', type: 'single' });
      createPattern({ patternType: 'voice', description: 'Test pattern' });

      const { GET } = await import('./export/route');
      const request = createMockRequest('/api/export?format=json');
      const response = GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('Content-Disposition')).toContain('attachment');
      expect(response.headers.get('Content-Disposition')).toContain('.json');

      const data = await response.json();
      expect(data.exportedAt).toBeDefined();
      expect(data.version).toBe('1.0');
      expect(data.posts).toHaveLength(1);
      expect(data.patterns).toHaveLength(1);
    });

    it('exports data as CSV', async () => {
      createPost({ content: 'Test post', type: 'single' });

      const { GET } = await import('./export/route');
      const request = createMockRequest('/api/export?format=csv');
      const response = GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/csv');
      expect(response.headers.get('Content-Disposition')).toContain('attachment');
      expect(response.headers.get('Content-Disposition')).toContain('.csv');

      const csvContent = await response.text();
      expect(csvContent).toContain('# Posts');
      expect(csvContent).toContain('id,content,type');
      expect(csvContent).toContain('Test post');
    });

    it('returns empty arrays when no data exists', async () => {
      const { GET } = await import('./export/route');
      const request = createMockRequest('/api/export?format=json');
      const response = GET(request);

      const data = await response.json();
      expect(data.posts).toEqual([]);
      expect(data.feedback).toEqual([]);
      expect(data.patterns).toEqual([]);
    });

    it('exports feedback with post association', async () => {
      const post = createPost({ content: 'Test', type: 'single' });
      createFeedback({
        postId: post.id,
        action: 'reject',
        category: 'tone',
        comment: 'Too formal',
      });

      const { GET } = await import('./export/route');
      const request = createMockRequest('/api/export?format=json');
      const response = GET(request);

      const data = await response.json();
      expect(data.feedback).toHaveLength(1);
      expect(data.feedback[0].postId).toBe(post.id);
      expect(data.feedback[0].category).toBe('tone');
    });
  });
});

describe('Settings API Routes', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/settings', () => {
    it('returns settings configuration', async () => {
      const { GET } = await import('./settings/route');
      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.notificationVerbosity).toBeDefined();
      expect(data.notificationPreferences).toBeDefined();
      expect(data.budgetLimits).toBeDefined();
      expect(data.budgetStatus).toBeDefined();
      expect(data.dataSourceConfig).toBeDefined();
    });

    it('returns budget limits with defaults', async () => {
      const { GET } = await import('./settings/route');
      const response = await GET();

      const data = await response.json();
      expect(data.budgetLimits.anthropicDailyUsd).toBeGreaterThan(0);
      expect(data.budgetLimits.anthropicMonthlyUsd).toBeGreaterThan(0);
      expect(data.budgetLimits.apifyMonthlyUsd).toBeGreaterThan(0);
    });

    it('returns data source configuration', async () => {
      const { GET } = await import('./settings/route');
      const response = await GET();

      const data = await response.json();
      expect(typeof data.dataSourceConfig.smaugEnabled).toBe('boolean');
      expect(typeof data.dataSourceConfig.apifyEnabled).toBe('boolean');
      expect(data.dataSourceConfig.smaugPollIntervalMinutes).toBeGreaterThan(0);
    });

    it('returns notification preferences', async () => {
      const { GET } = await import('./settings/route');
      const response = await GET();

      const data = await response.json();
      expect(data.notificationPreferences.enabledTypes).toBeDefined();
      expect(typeof data.notificationPreferences.enabledTypes.content_ready).toBe('boolean');
      expect(typeof data.notificationPreferences.enabledTypes.time_sensitive).toBe('boolean');
    });
  });

  describe('PATCH /api/settings', () => {
    it('validates notification verbosity values', async () => {
      const { PATCH } = await import('./settings/route');
      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { notificationVerbosity: 'invalid' },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('notificationVerbosity');
    });

    it('accepts valid notification verbosity', async () => {
      const { PATCH } = await import('./settings/route');
      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { notificationVerbosity: 'rich' },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('validates anthropicDailyUsd is non-negative', async () => {
      const { PATCH } = await import('./settings/route');
      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { anthropicDailyUsd: -5 },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('non-negative');
    });

    it('validates smaugPollIntervalMinutes range', async () => {
      const { PATCH } = await import('./settings/route');
      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { smaugPollIntervalMinutes: 100 },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('between 1 and 60');
    });

    it('validates apifyTier1IntervalMinutes range', async () => {
      const { PATCH } = await import('./settings/route');
      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { apifyTier1IntervalMinutes: 5 },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('between 15 and 180');
    });

    it('validates apifyTier2IntervalMinutes range', async () => {
      const { PATCH } = await import('./settings/route');
      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { apifyTier2IntervalMinutes: 30 },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('between 60 and 480');
    });

    it('accepts valid budget configuration', async () => {
      const { PATCH } = await import('./settings/route');
      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: {
          anthropicDailyUsd: 20,
          anthropicMonthlyUsd: 200,
          apifyMonthlyUsd: 100,
        },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });
});
