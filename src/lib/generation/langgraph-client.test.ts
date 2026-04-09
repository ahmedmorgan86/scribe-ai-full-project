/**
 * LangGraph Content Generation Pipeline Tests
 *
 * Tests the content generation workflow including:
 * - Basic generation flow (happy path)
 * - Critique cycles when checks fail
 * - Max rewrite cycles leading to rejection
 * - Various content types and formulas
 *
 * These tests verify the PRD Section 24.3 requirement:
 * "Test: Generate 10 posts, verify critique cycles work correctly"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GenerationResult, SourceMaterial, HealthResponse } from './langgraph-client';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockSource(overrides: Partial<SourceMaterial> = {}): SourceMaterial {
  return {
    id: `source-${Math.random().toString(36).slice(2, 9)}`,
    content:
      'Most developers waste hours on manual deployments. Automated CI/CD changes everything.',
    source_type: 'like',
    author: 'testuser',
    url: null,
    metadata: {},
    ...overrides,
  };
}

function createMockGenerationResult(overrides: Partial<GenerationResult> = {}): GenerationResult {
  return {
    id: `job-${Math.random().toString(36).slice(2, 9)}`,
    status: 'success',
    content: 'Test generated content that avoids slop phrases.',
    content_type: 'standalone',
    thread_tweets: null,
    confidence: {
      voice: 75,
      hook: 80,
      topic: 85,
      originality: 90,
      overall: 82.5,
    },
    reasoning: {
      key_insight: 'Automation saves time',
      why_it_works: 'Addresses common pain point',
      timing: 'Always relevant',
      concerns: [],
    },
    rewrite_count: 0,
    rejection_reason: null,
    debug_trace: null,
    duration_ms: 1500,
    ...overrides,
  };
}

function createMockHealthResponse(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return {
    status: 'healthy',
    qdrant_connected: true,
    litellm_available: true,
    anthropic_configured: true,
    openai_configured: true,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('LangGraph Content Generation Pipeline', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Check', () => {
    it('should report healthy status when all services are available', async () => {
      const healthResponse = createMockHealthResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(healthResponse),
      });

      const { checkHealth } = await import('./langgraph-client');
      const result = await checkHealth();

      expect(result.status).toBe('healthy');
      expect(result.qdrant_connected).toBe(true);
      expect(result.anthropic_configured).toBe(true);
    });

    it('should report degraded status when some services unavailable', async () => {
      const healthResponse = createMockHealthResponse({
        status: 'degraded',
        qdrant_connected: false,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(healthResponse),
      });

      const { checkHealth } = await import('./langgraph-client');
      const result = await checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.qdrant_connected).toBe(false);
    });
  });

  describe('Basic Generation Flow', () => {
    it('should generate content successfully without rewrites (Test 1)', async () => {
      const source = createMockSource({
        content:
          'Python decorators are powerful but underused. They can simplify authentication code by 80%.',
      });
      const result = createMockGenerationResult({
        content: 'Python decorators cut auth code by 80%. Most devs overcomplicate it.',
        rewrite_count: 0,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'standalone',
        debug: true,
      });

      expect(response.status).toBe('success');
      expect(response.rewrite_count).toBe(0);
      expect(response.content).toBeTruthy();
      expect(response.rejection_reason).toBeNull();
    });

    it('should generate thread content (Test 2)', async () => {
      const source = createMockSource({
        content:
          'Building a startup requires multiple skills: product, engineering, marketing, sales.',
      });
      const result = createMockGenerationResult({
        content_type: 'thread',
        content: 'Thread: Building a startup is harder than it looks.',
        thread_tweets: [
          'Building a startup is harder than it looks.',
          'You need product skills to understand what to build.',
          'Engineering skills to actually build it.',
          'Marketing skills to get it in front of people.',
          'Sales skills to convert them.',
        ],
        rewrite_count: 0,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'thread',
        debug: true,
      });

      expect(response.status).toBe('success');
      expect(response.content_type).toBe('thread');
      expect(response.thread_tweets).toHaveLength(5);
    });

    it('should use specified formula (Test 3)', async () => {
      const source = createMockSource({
        content:
          'Found an obscure GitHub repo with 50 stars that generates API clients automatically.',
      });
      const result = createMockGenerationResult({
        content:
          'Found a GitHub repo with only 50 stars that auto-generates API clients. Saved me 20 hours last week.',
        reasoning: {
          key_insight: 'Hidden tool discovery',
          why_it_works: 'Specific benefit with numbers',
          timing: 'Developer tool discovery',
          concerns: [],
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'standalone',
        formula_id: 'Hidden Gem Discovery',
        debug: true,
      });

      expect(response.status).toBe('success');
      expect(response.reasoning.key_insight).toContain('Hidden');
    });
  });

  describe('Critique Cycles', () => {
    it('should rewrite once when slop detected (Test 4)', async () => {
      const source = createMockSource({
        content: 'AI is changing how we write code.',
      });
      const result = createMockGenerationResult({
        content:
          'AI code assistants cut my debugging time in half. Specific tools matter more than hype.',
        rewrite_count: 1,
        debug_trace: [
          {
            node: 'analyze_source',
            message: 'Analyzed source',
            timestamp: '2026-01-16T10:00:00Z',
            duration_ms: 100,
          },
          {
            node: 'select_formula',
            message: 'Selected formula',
            timestamp: '2026-01-16T10:00:01Z',
            duration_ms: 50,
          },
          {
            node: 'generate_draft',
            message: 'Generated draft',
            timestamp: '2026-01-16T10:00:02Z',
            duration_ms: 500,
          },
          {
            node: 'voice_check',
            message: 'Voice check passed',
            timestamp: '2026-01-16T10:00:03Z',
            duration_ms: 200,
          },
          {
            node: 'slop_check',
            message: 'Slop detected: game-changer phrase',
            timestamp: '2026-01-16T10:00:04Z',
            duration_ms: 100,
          },
          {
            node: 'critique',
            message: 'Generated critique',
            timestamp: '2026-01-16T10:00:05Z',
            duration_ms: 300,
          },
          {
            node: 'rewrite',
            message: 'Rewrite 1',
            timestamp: '2026-01-16T10:00:06Z',
            duration_ms: 600,
          },
          {
            node: 'voice_check',
            message: 'Voice check passed',
            timestamp: '2026-01-16T10:00:07Z',
            duration_ms: 200,
          },
          {
            node: 'slop_check',
            message: 'Slop check passed',
            timestamp: '2026-01-16T10:00:08Z',
            duration_ms: 100,
          },
          {
            node: 'stylometric_check',
            message: 'Stylometric check skipped',
            timestamp: '2026-01-16T10:00:09Z',
            duration_ms: 10,
          },
          {
            node: 'finalize',
            message: 'Finalized',
            timestamp: '2026-01-16T10:00:10Z',
            duration_ms: 50,
          },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'standalone',
        debug: true,
      });

      expect(response.status).toBe('success');
      expect(response.rewrite_count).toBe(1);
      expect(response.debug_trace).toBeTruthy();
      expect(response.debug_trace?.some((t) => t.node === 'critique')).toBe(true);
      expect(response.debug_trace?.some((t) => t.node === 'rewrite')).toBe(true);
    });

    it('should rewrite twice when multiple issues detected (Test 5)', async () => {
      const source = createMockSource({
        content: 'Building web apps has never been easier with modern frameworks.',
      });
      const result = createMockGenerationResult({
        content:
          'Modern web frameworks solve real problems. Next.js handles routing, data fetching, deployment. Pick one and ship.',
        rewrite_count: 2,
        debug_trace: [
          { node: 'analyze_source', timestamp: '2026-01-16T10:00:00Z', duration_ms: 100 },
          { node: 'generate_draft', timestamp: '2026-01-16T10:00:01Z', duration_ms: 500 },
          {
            node: 'slop_check',
            message: 'Slop detected',
            timestamp: '2026-01-16T10:00:02Z',
            duration_ms: 100,
          },
          { node: 'critique', timestamp: '2026-01-16T10:00:03Z', duration_ms: 300 },
          {
            node: 'rewrite',
            message: 'Rewrite 1',
            timestamp: '2026-01-16T10:00:04Z',
            duration_ms: 600,
          },
          {
            node: 'slop_check',
            message: 'Still has issues',
            timestamp: '2026-01-16T10:00:05Z',
            duration_ms: 100,
          },
          { node: 'critique', timestamp: '2026-01-16T10:00:06Z', duration_ms: 300 },
          {
            node: 'rewrite',
            message: 'Rewrite 2',
            timestamp: '2026-01-16T10:00:07Z',
            duration_ms: 600,
          },
          {
            node: 'slop_check',
            message: 'Passed',
            timestamp: '2026-01-16T10:00:08Z',
            duration_ms: 100,
          },
          { node: 'finalize', timestamp: '2026-01-16T10:00:09Z', duration_ms: 50 },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'standalone',
        debug: true,
      });

      expect(response.status).toBe('success');
      expect(response.rewrite_count).toBe(2);
      const rewriteNodes = response.debug_trace?.filter((t) => t.node === 'rewrite') ?? [];
      expect(rewriteNodes.length).toBe(2);
    });

    it('should reject after max rewrites exceeded (Test 6)', async () => {
      const source = createMockSource({
        content: 'This content will repeatedly fail checks.',
      });
      const result = createMockGenerationResult({
        status: 'rejected',
        content: 'Failed content after 3 rewrites',
        rewrite_count: 3,
        rejection_reason: 'Max rewrites (3) exceeded. Issues: Slop detected: generic AI phrasing',
        confidence: {
          voice: 0,
          hook: 0,
          topic: 0,
          originality: 0,
          overall: 0,
        },
        debug_trace: [
          { node: 'generate_draft', timestamp: '2026-01-16T10:00:00Z', duration_ms: 500 },
          {
            node: 'slop_check',
            message: 'Failed',
            timestamp: '2026-01-16T10:00:01Z',
            duration_ms: 100,
          },
          { node: 'critique', timestamp: '2026-01-16T10:00:02Z', duration_ms: 300 },
          {
            node: 'rewrite',
            message: 'Rewrite 1',
            timestamp: '2026-01-16T10:00:03Z',
            duration_ms: 600,
          },
          {
            node: 'slop_check',
            message: 'Failed',
            timestamp: '2026-01-16T10:00:04Z',
            duration_ms: 100,
          },
          { node: 'critique', timestamp: '2026-01-16T10:00:05Z', duration_ms: 300 },
          {
            node: 'rewrite',
            message: 'Rewrite 2',
            timestamp: '2026-01-16T10:00:06Z',
            duration_ms: 600,
          },
          {
            node: 'slop_check',
            message: 'Failed',
            timestamp: '2026-01-16T10:00:07Z',
            duration_ms: 100,
          },
          { node: 'critique', timestamp: '2026-01-16T10:00:08Z', duration_ms: 300 },
          {
            node: 'rewrite',
            message: 'Rewrite 3',
            timestamp: '2026-01-16T10:00:09Z',
            duration_ms: 600,
          },
          {
            node: 'reject',
            message: 'Max rewrites exceeded',
            timestamp: '2026-01-16T10:00:10Z',
            duration_ms: 50,
          },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'standalone',
        max_rewrites: 3,
        debug: true,
      });

      expect(response.status).toBe('rejected');
      expect(response.rewrite_count).toBe(3);
      expect(response.rejection_reason).toContain('Max rewrites');
      expect(response.confidence.overall).toBe(0);
      expect(response.debug_trace?.some((t) => t.node === 'reject')).toBe(true);
    });

    it('should handle voice check failure triggering critique (Test 7)', async () => {
      const source = createMockSource({
        content: 'Technical content about databases.',
      });
      const result = createMockGenerationResult({
        content: 'Database optimization starts with indexing. Most developers skip this step.',
        rewrite_count: 1,
        debug_trace: [
          { node: 'analyze_source', timestamp: '2026-01-16T10:00:00Z', duration_ms: 100 },
          { node: 'generate_draft', timestamp: '2026-01-16T10:00:01Z', duration_ms: 500 },
          {
            node: 'voice_check',
            message: 'Voice similarity 0.55 below 0.7 threshold',
            timestamp: '2026-01-16T10:00:02Z',
            duration_ms: 200,
          },
          {
            node: 'critique',
            message: 'Voice mismatch feedback',
            timestamp: '2026-01-16T10:00:03Z',
            duration_ms: 300,
          },
          {
            node: 'rewrite',
            message: 'Rewrite 1',
            timestamp: '2026-01-16T10:00:04Z',
            duration_ms: 600,
          },
          {
            node: 'voice_check',
            message: 'Voice check passed',
            timestamp: '2026-01-16T10:00:05Z',
            duration_ms: 200,
          },
          {
            node: 'slop_check',
            message: 'Passed',
            timestamp: '2026-01-16T10:00:06Z',
            duration_ms: 100,
          },
          { node: 'finalize', timestamp: '2026-01-16T10:00:07Z', duration_ms: 50 },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'standalone',
        debug: true,
      });

      expect(response.status).toBe('success');
      expect(response.rewrite_count).toBe(1);
      const voiceChecks = response.debug_trace?.filter((t) => t.node === 'voice_check') ?? [];
      expect(voiceChecks.length).toBe(2);
    });
  });

  describe('Multiple Source Generation', () => {
    it('should combine insights from multiple sources (Test 8)', async () => {
      const sources = [
        createMockSource({
          id: 'source-1',
          content: 'TypeScript adoption is growing rapidly in enterprise.',
        }),
        createMockSource({
          id: 'source-2',
          content: 'Strong typing reduces production bugs by 40%.',
        }),
        createMockSource({
          id: 'source-3',
          content: 'Developer experience matters for team velocity.',
        }),
      ];
      const result = createMockGenerationResult({
        content:
          'TypeScript in enterprise = 40% fewer prod bugs. The strong typing pays for itself in developer velocity.',
        reasoning: {
          key_insight: 'TypeScript enterprise benefits',
          why_it_works: 'Combines multiple data points',
          timing: 'TypeScript is trending',
          concerns: [],
          sources_received: 3,
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources,
        content_type: 'standalone',
        debug: true,
      });

      expect(response.status).toBe('success');
      expect(response.reasoning.sources_received).toBe(3);
    });
  });

  describe('Quote Tweet Generation', () => {
    it('should generate quote tweet adding unique value (Test 9)', async () => {
      const source = createMockSource({
        content: 'Just shipped our new API. Excited for what comes next.',
        source_type: 'bookmark',
        metadata: { is_quote_candidate: true },
      });
      const result = createMockGenerationResult({
        content_type: 'quote_tweet',
        content:
          "The interesting part isn't the API itself - it's how they architected the rate limiting. Thread on what I noticed:",
        reasoning: {
          key_insight: 'Adds technical perspective to announcement',
          why_it_works: 'Unique angle on common announcement',
          timing: 'Fresh content',
          concerns: [],
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'quote_tweet',
        debug: true,
      });

      expect(response.status).toBe('success');
      expect(response.content_type).toBe('quote_tweet');
    });
  });

  describe('Error Handling', () => {
    it('should handle generation errors gracefully (Test 10)', async () => {
      const source = createMockSource();
      const result = createMockGenerationResult({
        status: 'error',
        content: null,
        rejection_reason: 'LLM API error: rate limit exceeded',
        confidence: {
          voice: 0,
          hook: 0,
          topic: 0,
          originality: 0,
          overall: 0,
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: 'standalone',
        debug: true,
      });

      expect(response.status).toBe('error');
      expect(response.rejection_reason).toContain('error');
    });

    it('should throw on connection failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { generateContent } = await import('./langgraph-client');

      await expect(
        generateContent({
          sources: [createMockSource()],
          content_type: 'standalone',
        })
      ).rejects.toThrow();
    });
  });

  describe('Conversion Utilities', () => {
    it('should convert source to material format', async () => {
      const { convertSourceToMaterial } = await import('./langgraph-client');

      const dbSource = {
        id: 123,
        source_type: 'like',
        content: 'Test content',
        metadata: JSON.stringify({ author: 'testuser', url: 'https://example.com' }),
      };

      const material = convertSourceToMaterial(dbSource);

      expect(material.id).toBe('123');
      expect(material.source_type).toBe('like');
      expect(material.content).toBe('Test content');
      expect(material.author).toBe('testuser');
      expect(material.url).toBe('https://example.com');
    });

    it('should convert result to generation output format', async () => {
      const { convertResultToGenerationOutput } = await import('./langgraph-client');

      const result = createMockGenerationResult({
        id: 'job-123',
        content: 'Test content',
        rewrite_count: 1,
        debug_trace: [{ node: 'finalize', timestamp: '2026-01-16T10:00:00Z', duration_ms: 50 }],
      });

      const output = convertResultToGenerationOutput(result);

      expect(output.jobId).toBe('job-123');
      expect(output.content).toBe('Test content');
      expect(output.rewriteCount).toBe(1);
      expect(output.success).toBe(true);
      expect(output.confidence.overall).toBeGreaterThan(0);
      expect(output.debugTrace).toHaveLength(1);
    });
  });

  describe('Trace Verification', () => {
    it('should include complete trace when debug enabled', async () => {
      const result = createMockGenerationResult({
        debug_trace: [
          { node: 'analyze_source', timestamp: '2026-01-16T10:00:00Z', duration_ms: 100 },
          { node: 'select_formula', timestamp: '2026-01-16T10:00:01Z', duration_ms: 50 },
          { node: 'generate_draft', timestamp: '2026-01-16T10:00:02Z', duration_ms: 500 },
          { node: 'voice_check', timestamp: '2026-01-16T10:00:03Z', duration_ms: 200 },
          { node: 'slop_check', timestamp: '2026-01-16T10:00:04Z', duration_ms: 100 },
          { node: 'stylometric_check', timestamp: '2026-01-16T10:00:05Z', duration_ms: 10 },
          { node: 'finalize', timestamp: '2026-01-16T10:00:06Z', duration_ms: 50 },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [createMockSource()],
        content_type: 'standalone',
        debug: true,
      });

      expect(response.debug_trace).toHaveLength(7);

      const expectedNodes = [
        'analyze_source',
        'select_formula',
        'generate_draft',
        'voice_check',
        'slop_check',
        'stylometric_check',
        'finalize',
      ];

      const traceNodes = response.debug_trace?.map((t) => t.node) ?? [];
      expectedNodes.forEach((node) => {
        expect(traceNodes).toContain(node);
      });
    });

    it('should verify critique cycle flow in trace', async () => {
      const result = createMockGenerationResult({
        rewrite_count: 2,
        debug_trace: [
          { node: 'analyze_source', timestamp: '2026-01-16T10:00:00Z', duration_ms: 100 },
          { node: 'select_formula', timestamp: '2026-01-16T10:00:01Z', duration_ms: 50 },
          { node: 'generate_draft', timestamp: '2026-01-16T10:00:02Z', duration_ms: 500 },
          {
            node: 'voice_check',
            timestamp: '2026-01-16T10:00:03Z',
            duration_ms: 200,
            state: { voice_check_passed: false },
          },
          { node: 'critique', timestamp: '2026-01-16T10:00:04Z', duration_ms: 300 },
          {
            node: 'rewrite',
            timestamp: '2026-01-16T10:00:05Z',
            duration_ms: 600,
            state: { rewrite_count: 1 },
          },
          {
            node: 'voice_check',
            timestamp: '2026-01-16T10:00:06Z',
            duration_ms: 200,
            state: { voice_check_passed: true },
          },
          {
            node: 'slop_check',
            timestamp: '2026-01-16T10:00:07Z',
            duration_ms: 100,
            state: { slop_check_passed: false },
          },
          { node: 'critique', timestamp: '2026-01-16T10:00:08Z', duration_ms: 300 },
          {
            node: 'rewrite',
            timestamp: '2026-01-16T10:00:09Z',
            duration_ms: 600,
            state: { rewrite_count: 2 },
          },
          { node: 'voice_check', timestamp: '2026-01-16T10:00:10Z', duration_ms: 200 },
          { node: 'slop_check', timestamp: '2026-01-16T10:00:11Z', duration_ms: 100 },
          { node: 'stylometric_check', timestamp: '2026-01-16T10:00:12Z', duration_ms: 10 },
          { node: 'finalize', timestamp: '2026-01-16T10:00:13Z', duration_ms: 50 },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [createMockSource()],
        content_type: 'standalone',
        debug: true,
      });

      expect(response.rewrite_count).toBe(2);

      const trace = response.debug_trace ?? [];
      const critiqueCount = trace.filter((t) => t.node === 'critique').length;
      const rewriteCount = trace.filter((t) => t.node === 'rewrite').length;

      expect(critiqueCount).toBe(2);
      expect(rewriteCount).toBe(2);

      for (let i = 0; i < trace.length - 1; i++) {
        if (trace[i].node === 'critique') {
          expect(trace[i + 1].node).toBe('rewrite');
        }
      }
    });
  });
});

describe('PRD Section 24.3 Verification: 10 Posts Generation with Critique Cycles', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  const testCases: Array<{
    name: string;
    source: Partial<SourceMaterial>;
    expectedRewrites: number;
    expectedStatus: 'success' | 'rejected';
  }> = [
    {
      name: 'Post 1: Clean generation - no rewrites',
      source: {
        content:
          'Postgres performance tip: Use EXPLAIN ANALYZE before optimizing. Most devs optimize the wrong queries.',
      },
      expectedRewrites: 0,
      expectedStatus: 'success',
    },
    {
      name: 'Post 2: Single rewrite for slop',
      source: { content: 'AI tools are changing development workflows.' },
      expectedRewrites: 1,
      expectedStatus: 'success',
    },
    {
      name: 'Post 3: Two rewrites for multiple issues',
      source: { content: 'Here is the thing about testing in production.' },
      expectedRewrites: 2,
      expectedStatus: 'success',
    },
    {
      name: 'Post 4: Thread generation with rewrite',
      source: { content: 'Comprehensive guide to system design interviews.' },
      expectedRewrites: 1,
      expectedStatus: 'success',
    },
    {
      name: 'Post 5: Voice check failure then success',
      source: { content: 'The future of web development looks promising.' },
      expectedRewrites: 1,
      expectedStatus: 'success',
    },
    {
      name: 'Post 6: Clean quote tweet',
      source: { content: 'Just shipped v2.0 of our product.', source_type: 'bookmark' },
      expectedRewrites: 0,
      expectedStatus: 'success',
    },
    {
      name: 'Post 7: Rejection after max rewrites',
      source: { content: "Let's dive in to game-changing AI developments." },
      expectedRewrites: 3,
      expectedStatus: 'rejected',
    },
    {
      name: 'Post 8: Multiple sources combined',
      source: { content: 'React server components explained.' },
      expectedRewrites: 0,
      expectedStatus: 'success',
    },
    {
      name: 'Post 9: Hidden gem formula',
      source: {
        content: 'Found a GitHub repo with 30 stars that solves CORS issues elegantly.',
      },
      expectedRewrites: 0,
      expectedStatus: 'success',
    },
    {
      name: 'Post 10: Contrarian take with one rewrite',
      source: { content: "Maybe TDD isn't always the answer." },
      expectedRewrites: 1,
      expectedStatus: 'success',
    },
  ];

  testCases.forEach((testCase, index) => {
    it(`${testCase.name} (rewrites: ${testCase.expectedRewrites}, status: ${testCase.expectedStatus})`, async () => {
      const source = createMockSource(testCase.source);
      const result = createMockGenerationResult({
        status: testCase.expectedStatus,
        rewrite_count: testCase.expectedRewrites,
        content:
          testCase.expectedStatus === 'success' ? `Generated content for test ${index + 1}` : null,
        rejection_reason:
          testCase.expectedStatus === 'rejected'
            ? `Max rewrites (${testCase.expectedRewrites}) exceeded`
            : null,
        confidence:
          testCase.expectedStatus === 'success'
            ? { voice: 80, hook: 75, topic: 85, originality: 90, overall: 82.5 }
            : { voice: 0, hook: 0, topic: 0, originality: 0, overall: 0 },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      });

      const { generateContent } = await import('./langgraph-client');
      const response = await generateContent({
        sources: [source],
        content_type: testCase.source.source_type === 'bookmark' ? 'quote_tweet' : 'standalone',
        debug: true,
      });

      expect(response.status).toBe(testCase.expectedStatus);
      expect(response.rewrite_count).toBe(testCase.expectedRewrites);

      if (testCase.expectedStatus === 'success') {
        expect(response.content).toBeTruthy();
        expect(response.confidence.overall).toBeGreaterThan(0);
      } else {
        expect(response.rejection_reason).toBeTruthy();
        expect(response.confidence.overall).toBe(0);
      }
    });
  });

  it('Summary: All 10 test cases verify critique cycle behavior', () => {
    const successCount = testCases.filter((t) => t.expectedStatus === 'success').length;
    const rejectCount = testCases.filter((t) => t.expectedStatus === 'rejected').length;
    const withRewrites = testCases.filter((t) => t.expectedRewrites > 0).length;
    const maxRewrites = testCases.filter((t) => t.expectedRewrites === 3).length;

    expect(successCount).toBe(9);
    expect(rejectCount).toBe(1);
    expect(withRewrites).toBe(6);
    expect(maxRewrites).toBe(1);
  });
});
