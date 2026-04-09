/**
 * API Integration Test Suite
 *
 * Tests all API endpoints with real database, checking responses
 * match expected schemas and business logic works.
 *
 * Groups tested:
 * - Bootstrap APIs (voice-guidelines, gold-examples, accounts)
 * - Queue APIs (list, approve, reject, edit)
 * - Generation APIs (generate, langgraph jobs)
 * - Config APIs (thresholds, settings)
 * - Health APIs (llm, langgraph, workers)
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createPost } from '@/db/models/posts';
import { createQueueItem } from '@/db/models/queue';
import { createSource } from '@/db/models/sources';
import { getAccountByHandle } from '@/db/models/accounts';

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
  };
});

vi.mock('@/lib/voice/signature', () => ({
  generateSignature: vi.fn().mockReturnValue({
    sentenceLength: { mean: 15, stdDev: 5 },
    punctuation: {
      periodRate: 0.1,
      commaRate: 0.05,
      exclamationRate: 0.02,
      questionRate: 0.01,
      dashRate: 0.01,
      ellipsisRate: 0,
    },
    vocabulary: { typeTokenRatio: 0.8, hapaxRatio: 0.6 },
    functionWords: {
      the: 0.05,
      and: 0.03,
      but: 0.01,
      of: 0.02,
      to: 0.03,
      a: 0.04,
      in: 0.02,
      that: 0.02,
      is: 0.03,
      it: 0.02,
    },
    syntactic: { avgClauseDepth: 1.5, avgWordsPerClause: 8, subordinateClauseRatio: 0.2 },
    metadata: { textLength: 100, sampleCount: 1, generatedAt: new Date().toISOString() },
  }),
  saveBaselineSignatureToFile: vi.fn(),
  clearPersonaSignatureCache: vi.fn(),
  StyleSignature: {},
}));

vi.mock('@/lib/llm/gateway', () => ({
  checkGatewayHealth: vi.fn().mockResolvedValue({ providers: { anthropic: true, openai: true } }),
  isGatewayAvailable: vi.fn().mockResolvedValue(false),
  GatewayConnectionError: class extends Error {},
}));

vi.mock('@/lib/generation/langgraph-client', () => ({
  checkHealth: vi.fn().mockResolvedValue({
    status: 'unavailable',
    qdrant_connected: false,
    litellm_available: false,
    anthropic_configured: false,
    openai_configured: false,
    timestamp: new Date().toISOString(),
  }),
  isAvailableCached: vi.fn().mockResolvedValue(false),
  generateContent: vi.fn(),
  convertSourceToMaterial: vi.fn(),
  convertResultToGenerationOutput: vi.fn(),
  listRecentJobs: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/workers/client', () => ({
  checkAllWorkersHealth: vi.fn().mockResolvedValue({
    overall: 'unavailable',
    workers: {
      litellm: { status: 'unavailable', latencyMs: null },
      langgraph: { status: 'unavailable', latencyMs: null },
      stylometry: { status: 'unavailable', latencyMs: null },
    },
    timestamp: new Date().toISOString(),
  }),
  getWorkerUrls: vi.fn().mockReturnValue({
    litellm: 'http://localhost:8001',
    langgraph: 'http://localhost:8002',
    stylometry: 'http://localhost:8003',
  }),
}));

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
// Schema Validation Helpers
// ============================================================================

function assertVoiceGuidelinesResponse(data: unknown): void {
  expect(data).toHaveProperty('success');
  expect(data).toHaveProperty('parsed');
  const d = data as { parsed: unknown };
  expect(d.parsed).toHaveProperty('dosCount');
  expect(d.parsed).toHaveProperty('dontsCount');
  expect(d.parsed).toHaveProperty('examplesCount');
  expect(d.parsed).toHaveProperty('rulesCount');
}

function assertAccountsResponse(data: unknown): void {
  expect(data).toHaveProperty('success');
  expect(data).toHaveProperty('added');
  expect(data).toHaveProperty('skipped');
  const d = data as { added: number; skipped: number };
  expect(typeof d.added).toBe('number');
  expect(typeof d.skipped).toBe('number');
}

function assertQueueResponse(data: unknown): void {
  expect(data).toHaveProperty('posts');
  expect(data).toHaveProperty('total');
  expect(data).toHaveProperty('hasMore');
  const d = data as { posts: unknown[]; total: number; hasMore: boolean };
  expect(Array.isArray(d.posts)).toBe(true);
  expect(typeof d.total).toBe('number');
  expect(typeof d.hasMore).toBe('boolean');
}

function assertApproveResponse(data: unknown): void {
  expect(data).toHaveProperty('post');
  expect(data).toHaveProperty('feedbackId');
  const d = data as { post: { status: string }; feedbackId: number };
  expect(d.post.status).toBe('approved');
  expect(typeof d.feedbackId).toBe('number');
}

function assertRejectResponse(data: unknown): void {
  expect(data).toHaveProperty('post');
  expect(data).toHaveProperty('feedbackId');
  const d = data as { post: { status: string }; feedbackId: number };
  expect(d.post.status).toBe('rejected');
  expect(typeof d.feedbackId).toBe('number');
}

function assertEditResponse(data: unknown): void {
  expect(data).toHaveProperty('post');
  expect(data).toHaveProperty('feedbackId');
  expect(data).toHaveProperty('diffCaptured');
  const d = data as { post: { content: string }; feedbackId: number; diffCaptured: boolean };
  expect(typeof d.post.content).toBe('string');
  expect(typeof d.feedbackId).toBe('number');
  expect(typeof d.diffCaptured).toBe('boolean');
}

function assertThresholdsResponse(data: unknown): void {
  expect(data).toHaveProperty('thresholds');
  const d = data as { thresholds: Record<string, unknown> };
  expect(d.thresholds).toHaveProperty('voice');
  expect(d.thresholds).toHaveProperty('slop');
  expect(d.thresholds).toHaveProperty('stylometry');
  expect(d.thresholds).toHaveProperty('duplicate');
  expect(d.thresholds).toHaveProperty('learning');
}

function assertSettingsResponse(data: unknown): void {
  expect(data).toHaveProperty('notificationVerbosity');
  expect(data).toHaveProperty('notificationPreferences');
  expect(data).toHaveProperty('budgetLimits');
  expect(data).toHaveProperty('budgetStatus');
  expect(data).toHaveProperty('dataSourceConfig');
}

function assertLLMHealthResponse(data: unknown): void {
  expect(data).toHaveProperty('status');
  expect(data).toHaveProperty('gatewayEnabled');
  expect(data).toHaveProperty('gatewayReachable');
  expect(data).toHaveProperty('providers');
  expect(data).toHaveProperty('availableModels');
  expect(data).toHaveProperty('circuitBreakers');
  expect(data).toHaveProperty('timestamp');
  const d = data as { status: string };
  expect(['healthy', 'degraded', 'unavailable']).toContain(d.status);
}

function assertLangGraphHealthResponse(data: unknown): void {
  expect(data).toHaveProperty('status');
  expect(data).toHaveProperty('qdrant_connected');
  expect(data).toHaveProperty('litellm_available');
  expect(data).toHaveProperty('timestamp');
  const d = data as { status: string };
  expect(['healthy', 'degraded', 'unavailable']).toContain(d.status);
}

function assertWorkersHealthResponse(data: unknown): void {
  expect(data).toHaveProperty('overall');
  expect(data).toHaveProperty('workers');
  expect(data).toHaveProperty('timestamp');
  expect(data).toHaveProperty('urls');
  const d = data as { overall: string; workers: Record<string, unknown> };
  expect(['healthy', 'degraded', 'unavailable']).toContain(d.overall);
  expect(d.workers).toHaveProperty('litellm');
  expect(d.workers).toHaveProperty('langgraph');
  expect(d.workers).toHaveProperty('stylometry');
}

function assertBootstrapStatusResponse(data: unknown): void {
  expect(data).toHaveProperty('voiceGuidelinesLoaded');
  expect(data).toHaveProperty('approvedPostsCount');
  expect(data).toHaveProperty('hasMinimumCorpus');
  expect(data).toHaveProperty('accountsCount');
  expect(data).toHaveProperty('formulasCount');
  expect(data).toHaveProperty('apiKeysConfigured');
  expect(data).toHaveProperty('isReady');
  expect(data).toHaveProperty('missingRequirements');
}

// ============================================================================
// Bootstrap API Tests
// ============================================================================

describe('Bootstrap APIs Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('POST /api/bootstrap/voice-guidelines', () => {
    it('parses voice guidelines markdown and returns counts', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const content = `
## DO's
- Write with energy and enthusiasm
- Use direct language
- Keep it conversational

## DON'Ts
- Don't be boring
- Avoid jargon

## Examples
This is a great example tweet that shows the voice.
Another example of the tone we're going for.

## Rules
Always end with a call to action
      `;

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      assertVoiceGuidelinesResponse(data);
      expect(data.success).toBe(true);
      expect(data.parsed.dosCount).toBeGreaterThan(0);
      expect(data.parsed.dontsCount).toBeGreaterThan(0);
      expect(data.parsed.examplesCount).toBeGreaterThan(0);
      expect(data.parsed.rulesCount).toBeGreaterThan(0);
    });

    it('returns 400 when content is missing', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: {},
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('required');
    });

    it('returns 400 when no guidelines found', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: 'Just some random text without proper sections' },
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('No guidelines found');
    });
  });

  describe('POST /api/bootstrap/accounts', () => {
    it('adds curated accounts to database', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      const request = createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: {
          accounts: ['@techinfluencer, 1', '@startupfounder, 2', 'devadvocate', '# comment line'],
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      assertAccountsResponse(data);
      expect(data.success).toBe(true);
      expect(data.added).toBe(3);
      expect(data.skipped).toBe(0);

      // Verify data persisted in database
      const tech = getAccountByHandle('techinfluencer');
      expect(tech).not.toBeNull();
      expect(tech?.tier).toBe(1);

      const founder = getAccountByHandle('startupfounder');
      expect(founder).not.toBeNull();
      expect(founder?.tier).toBe(2);
    });

    it('skips duplicate accounts', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      // First request
      await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['@testuser, 1'] },
        })
      );

      // Second request with same account
      const response = await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['@testuser, 1', '@newuser, 2'] },
        })
      );

      const data = await response.json();
      expect(data.added).toBe(1);
      expect(data.skipped).toBe(1);
    });

    it('returns 400 when accounts array is missing', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      const request = createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: {},
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('Accounts array is required');
    });
  });

  describe('GET /api/bootstrap/status', () => {
    it('returns bootstrap completion status', async () => {
      const { GET } = await import('@/app/api/bootstrap/status/route');

      const response = await GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      assertBootstrapStatusResponse(data);
      expect(typeof data.isReady).toBe('boolean');
      expect(typeof data.voiceGuidelinesLoaded).toBe('boolean');
      expect(Array.isArray(data.missingRequirements)).toBe(true);
    });
  });
});

// ============================================================================
// Queue API Tests
// ============================================================================

describe('Queue APIs Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/queue', () => {
    it('returns pending posts with correct schema', async () => {
      // Seed database
      const post1 = createPost({ content: 'Post 1', type: 'single', status: 'pending' });
      const post2 = createPost({ content: 'Post 2', type: 'single', status: 'pending' });
      createQueueItem({ postId: post1.id, priority: 5 });
      createQueueItem({ postId: post2.id, priority: 10 });

      const { GET } = await import('@/app/api/queue/route');
      const request = createMockRequest('/api/queue');
      const response = GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      assertQueueResponse(data);
      expect(data.posts).toHaveLength(2);
      expect(data.total).toBe(2);
      // Higher priority should come first
      expect(data.posts[0].content).toBe('Post 2');
    });

    it('excludes non-pending posts from queue', async () => {
      createPost({ content: 'Pending', type: 'single', status: 'pending' });
      createPost({ content: 'Approved', type: 'single', status: 'approved' });
      createPost({ content: 'Rejected', type: 'single', status: 'rejected' });

      const { GET } = await import('@/app/api/queue/route');
      const response = GET(createMockRequest('/api/queue'));

      const data = await response.json();
      expect(data.posts).toHaveLength(1);
      expect(data.posts[0].content).toBe('Pending');
    });

    it('respects pagination parameters', async () => {
      for (let i = 0; i < 5; i++) {
        createPost({ content: `Post ${i}`, type: 'single', status: 'pending' });
      }

      const { GET } = await import('@/app/api/queue/route');
      const response = GET(createMockRequest('/api/queue?limit=2&offset=0'));

      const data = await response.json();
      expect(data.posts).toHaveLength(2);
      expect(data.total).toBe(5);
      expect(data.hasMore).toBe(true);
    });
  });

  describe('POST /api/posts/[id]/approve', () => {
    it('approves a pending post and returns correct schema', async () => {
      const post = createPost({ content: 'Test post', type: 'single', status: 'pending' });

      const { POST } = await import('@/app/api/posts/[id]/approve/route');
      const request = createMockRequest(`/api/posts/${post.id}/approve`, {
        method: 'POST',
        body: {},
      });

      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
      expect(response.status).toBe(200);

      const data = await response.json();
      assertApproveResponse(data);
      expect(data.feedbackId).toBeGreaterThan(0);
    });

    it('handles exceptional approval with starred flag', async () => {
      const post = createPost({ content: 'Exceptional post', type: 'single', status: 'pending' });

      const { POST } = await import('@/app/api/posts/[id]/approve/route');
      const request = createMockRequest(`/api/posts/${post.id}/approve`, {
        method: 'POST',
        body: { isExceptional: true, comment: 'This is brilliant!' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
      expect(response.status).toBe(200);
    });

    it('prevents double approval', async () => {
      const post = createPost({ content: 'Already approved', type: 'single', status: 'approved' });

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
  });

  describe('POST /api/posts/[id]/reject', () => {
    it('rejects a post with category and returns correct schema', async () => {
      const post = createPost({ content: 'Test post', type: 'single', status: 'pending' });

      const { POST } = await import('@/app/api/posts/[id]/reject/route');
      const request = createMockRequest(`/api/posts/${post.id}/reject`, {
        method: 'POST',
        body: { category: 'tone', comment: 'Too formal' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
      expect(response.status).toBe(200);

      const data = await response.json();
      assertRejectResponse(data);
      expect(data.feedbackId).toBeGreaterThan(0);
    });

    it('requires category field', async () => {
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

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
      const post = createPost({ content: 'Test', type: 'single', status: 'pending' });

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
  });

  describe('POST /api/posts/[id]/edit', () => {
    it('edits a post and captures diff', async () => {
      const post = createPost({ content: 'Original content', type: 'single', status: 'pending' });

      const { POST } = await import('@/app/api/posts/[id]/edit/route');
      const request = createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'Edited content', comment: 'Made it better' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
      expect(response.status).toBe(200);

      const data = await response.json();
      assertEditResponse(data);
      expect(data.post.content).toBe('Edited content');
      expect(data.diffCaptured).toBe(true);
    });

    it('sets diffCaptured to false when content unchanged', async () => {
      const post = createPost({ content: 'Same content', type: 'single', status: 'pending' });

      const { POST } = await import('@/app/api/posts/[id]/edit/route');
      const request = createMockRequest(`/api/posts/${post.id}/edit`, {
        method: 'POST',
        body: { content: 'Same content' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: String(post.id) }) });
      const data = await response.json();

      expect(data.diffCaptured).toBe(false);
    });
  });
});

// ============================================================================
// Generation API Tests
// ============================================================================

describe('Generation APIs Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('POST /api/generate', () => {
    it('validates sourceId is required', async () => {
      const { POST } = await import('@/app/api/generate/route');

      const request = createMockRequest('/api/generate', {
        method: 'POST',
        body: {},
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('Invalid request body');
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('returns 404 for non-existent source', async () => {
      const { POST } = await import('@/app/api/generate/route');

      const request = createMockRequest('/api/generate', {
        method: 'POST',
        body: { sourceId: 99999 },
      });

      const response = await POST(request);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.code).toBe('SOURCE_NOT_FOUND');
    });

    it('validates postType values', async () => {
      const source = createSource({
        sourceType: 'like',
        sourceId: 'test-123',
        content: 'Test source content',
        metadata: { authorHandle: 'testuser' },
      });

      const { POST } = await import('@/app/api/generate/route');

      const request = createMockRequest('/api/generate', {
        method: 'POST',
        body: { sourceId: source.id, postType: 'invalid' },
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('validates maxRewriteAttempts range (0-5)', async () => {
      const source = createSource({
        sourceType: 'like',
        sourceId: 'test-456',
        content: 'Test content',
        metadata: {},
      });

      const { POST } = await import('@/app/api/generate/route');

      const request = createMockRequest('/api/generate', {
        method: 'POST',
        body: { sourceId: source.id, maxRewriteAttempts: 10 },
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/langgraph/jobs', () => {
    it('returns list of generation jobs', async () => {
      const { GET } = await import('@/app/api/langgraph/jobs/route');

      const request = createMockRequest('/api/langgraph/jobs');
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('jobs');
      expect(Array.isArray(data.jobs)).toBe(true);
    });
  });
});

// ============================================================================
// Config API Tests
// ============================================================================

describe('Config APIs Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/config/thresholds', () => {
    it('returns all thresholds with correct schema', async () => {
      const { GET } = await import('@/app/api/config/thresholds/route');

      const response = GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      assertThresholdsResponse(data);
    });
  });

  describe('GET /api/settings', () => {
    it('returns all settings with correct schema', async () => {
      const { GET } = await import('@/app/api/settings/route');

      const response = await GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      assertSettingsResponse(data);
    });
  });

  describe('PATCH /api/settings', () => {
    it('validates notificationVerbosity values', async () => {
      const { PATCH } = await import('@/app/api/settings/route');

      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { notificationVerbosity: 'invalid_value' },
      });

      const response = await PATCH(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('notificationVerbosity');
    });

    it('validates budget limits are non-negative', async () => {
      const { PATCH } = await import('@/app/api/settings/route');

      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { anthropicDailyUsd: -5 },
      });

      const response = await PATCH(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('non-negative');
    });

    it('accepts valid settings update', async () => {
      const { PATCH } = await import('@/app/api/settings/route');

      const request = createMockRequest('/api/settings', {
        method: 'PATCH',
        body: { notificationVerbosity: 'rich' },
      });

      const response = await PATCH(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('GET /api/settings/thresholds', () => {
    it('returns threshold overrides', async () => {
      const { GET } = await import('@/app/api/settings/thresholds/route');

      const response = GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('overrides');
    });
  });
});

// ============================================================================
// Health API Tests
// ============================================================================

describe('Health APIs Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/llm/health', () => {
    it('returns LLM provider status with correct schema', async () => {
      const { GET } = await import('@/app/api/llm/health/route');

      const response = await GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      assertLLMHealthResponse(data);
    });

    it('reports provider availability based on env configuration', async () => {
      const { GET } = await import('@/app/api/llm/health/route');

      const response = await GET();
      const data = await response.json();

      // Check that providers are reported
      const providers = data.providers as Array<{ name: string }>;
      const anthropic = providers.find((p) => p.name === 'anthropic');
      const openai = providers.find((p) => p.name === 'openai');

      expect(anthropic).toBeDefined();
      expect(openai).toBeDefined();
    });
  });

  describe('GET /api/langgraph/health', () => {
    it('returns LangGraph worker status with correct schema', async () => {
      const { GET } = await import('@/app/api/langgraph/health/route');

      const response = await GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      assertLangGraphHealthResponse(data);
    });
  });

  describe('GET /api/workers/health', () => {
    it('returns all workers status with correct schema', async () => {
      const { GET } = await import('@/app/api/workers/health/route');

      const response = await GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      assertWorkersHealthResponse(data);
    });
  });
});

// ============================================================================
// Additional API Tests
// ============================================================================

describe('Dashboard Stats API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/dashboard/stats', () => {
    it('returns dashboard statistics', async () => {
      // Seed some data
      createPost({ content: 'Pending', type: 'single', status: 'pending' });
      createPost({ content: 'Approved', type: 'single', status: 'approved' });
      createPost({ content: 'Rejected', type: 'single', status: 'rejected' });

      const { GET } = await import('@/app/api/dashboard/stats/route');

      const response = GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('agentActivity');
      expect(data).toHaveProperty('queueSummary');
      expect(data).toHaveProperty('quickStats');
      expect(data).toHaveProperty('alerts');
      expect(data).toHaveProperty('timestamp');
      // Check that pending post is counted
      expect(data.queueSummary.pendingCount).toBe(1);
    });
  });
});

describe('Export API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/export', () => {
    it('exports data as JSON format', async () => {
      createPost({ content: 'Test post', type: 'single', status: 'pending' });

      const { GET } = await import('@/app/api/export/route');
      const request = createMockRequest('/api/export?format=json');

      const response = GET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('Content-Disposition')).toContain('attachment');

      const data = await response.json();
      expect(data).toHaveProperty('posts');
      expect(data).toHaveProperty('exportedAt');
      expect(data.posts).toHaveLength(1);
    });

    it('exports data as CSV format', async () => {
      createPost({ content: 'Test post', type: 'single', status: 'pending' });

      const { GET } = await import('@/app/api/export/route');
      const request = createMockRequest('/api/export?format=csv');

      const response = GET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/csv');

      const csvContent = await response.text();
      expect(csvContent).toContain('# Posts');
      expect(csvContent).toContain('id,content,type');
    });

    it('requires format parameter', async () => {
      const { GET } = await import('@/app/api/export/route');
      const request = createMockRequest('/api/export');

      const response = GET(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('format');
    });
  });
});
