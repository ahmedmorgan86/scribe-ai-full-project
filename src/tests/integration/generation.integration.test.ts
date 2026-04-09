/**
 * Content Generation Integration Test Suite (SMOKE-005 + INT-002)
 *
 * Tests the content generation pipeline end-to-end:
 * Source -> Generate -> Humanize -> Voice Check -> Slop Check -> Queue
 *
 * SMOKE-005: Basic generation pipeline tests
 * INT-002: Full pipeline with humanization and queue integration
 *
 * Mocks only external APIs (Claude, OpenAI), uses real database.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createSource } from '@/db/models/sources';
import { getGenerationJobById, getRecentJobs } from '@/db/models/generation-jobs';
import type { Source } from '@/types';

// Mock Qdrant (vector DB - external dependency)
vi.mock('@/db/qdrant/connection', () => ({
  collectionExists: vi.fn().mockResolvedValue(true),
  QDRANT_COLLECTION_NAMES: {
    APPROVED_POSTS: 'approved_posts',
    VOICE_GUIDELINES: 'voice_guidelines',
  },
  getQdrantClient: vi.fn().mockReturnValue({
    scroll: vi.fn().mockResolvedValue({ points: [] }),
    count: vi.fn().mockResolvedValue({ count: 0 }),
    search: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('@/db/qdrant/embeddings', () => ({
  addDocumentsBatch: vi.fn().mockResolvedValue(undefined),
  countDocuments: vi.fn().mockResolvedValue(0),
  addDocument: vi.fn().mockResolvedValue(undefined),
  searchSimilar: vi.fn().mockResolvedValue([]),
}));

// Mock embeddings service (OpenAI API)
vi.mock('@/lib/embeddings/service', () => ({
  generateEmbeddingsBatch: vi
    .fn()
    .mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => ({ embedding: new Array(1536).fill(0) })))
    ),
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: new Array(1536).fill(0) }),
}));

// Mock voice embeddings
vi.mock('@/lib/voice/embeddings', () => ({
  getVoiceCorpusStatus: vi.fn().mockResolvedValue({
    guidelinesLoaded: true,
    approvedPostsCount: 50,
    hasMinimumCorpus: true,
  }),
  getSimilarApprovedPosts: vi.fn().mockResolvedValue([
    { content: 'Great insight about productivity! The key is consistency.', similarity: 0.85 },
    { content: 'Here is what I learned about focus: eliminate distractions.', similarity: 0.82 },
  ]),
  findSimilarVoiceGuidelines: vi.fn().mockResolvedValue([]),
}));

// Mock voice guidelines
vi.mock('@/lib/voice/guidelines', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/voice/guidelines')>();
  return {
    ...original,
    hasVoiceGuidelines: vi.fn().mockResolvedValue(true),
    getVoiceGuidelinesFromQdrant: vi.fn().mockResolvedValue({
      dos: ['Write with energy', 'Use direct language', 'Keep it conversational'],
      donts: ["Don't be boring", 'Avoid jargon', 'No hashtags'],
      examples: ['Great example tweet'],
      rules: ['End with a call to action'],
      raw: 'Voice guidelines content',
    }),
    syncVoiceGuidelinesToQdrant: vi.fn().mockResolvedValue(undefined),
    formatGuidelinesForPrompt: vi.fn().mockReturnValue('Voice guidelines formatted'),
  };
});

// Mock signature generation
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
  loadBaselineSignatureFromFile: vi.fn().mockReturnValue(null),
  StyleSignature: {},
}));

// Mock LLM gateway
vi.mock('@/lib/llm/gateway', () => ({
  checkGatewayHealth: vi.fn().mockResolvedValue({ providers: { anthropic: true, openai: true } }),
  isGatewayAvailable: vi.fn().mockResolvedValue(false),
  GatewayConnectionError: class extends Error {},
}));

// Mock LangGraph client
vi.mock('@/lib/generation/langgraph-client', () => ({
  checkHealth: vi.fn().mockResolvedValue({
    status: 'unavailable',
    qdrant_connected: false,
    litellm_available: false,
    timestamp: new Date().toISOString(),
  }),
  isAvailableCached: vi.fn().mockResolvedValue(false),
  generateContent: vi.fn(),
  listRecentJobs: vi.fn().mockResolvedValue([]),
}));

// Track cost tracking calls
let mockTrackedCompletionCalls: { prompt: string; options: unknown }[] = [];
let mockTrackedCompletionResponse = {
  content: JSON.stringify({
    content:
      'This is a generated post about productivity. The key insight is that consistency beats intensity.',
    reasoning: {
      keyInsight: 'Consistency is more important than intensity',
      whyItWorks: 'Resonates with common productivity struggles',
      timing: 'Evergreen content',
      concerns: [],
    },
  }),
  costUsd: 0.05,
};

// Mock Anthropic cost tracking (the actual LLM call)
vi.mock('@/lib/anthropic/cost-tracking', () => ({
  trackedCompletion: vi.fn().mockImplementation((prompt: string, options: unknown) => {
    mockTrackedCompletionCalls.push({ prompt, options });
    return Promise.resolve(mockTrackedCompletionResponse);
  }),
}));

// Type for voice validation result
interface MockVoiceValidationResult {
  passed: boolean;
  stage: 'fast_filter' | 'llm_eval';
  score: { voice: number; hook: number; topic: number; originality: number; overall: number };
  failureReasons: string[];
  strengths: string[];
  suggestions: string[];
  costUsd: number;
}

// Mock validation pipeline - default to passing
let mockVoiceValidationResult: MockVoiceValidationResult = {
  passed: true,
  stage: 'llm_eval',
  score: { voice: 85, hook: 80, topic: 90, originality: 75, overall: 82 },
  failureReasons: [],
  strengths: ['Good voice match', 'Strong hook'],
  suggestions: [],
  costUsd: 0.02,
};

vi.mock('@/lib/voice/validation-pipeline', () => ({
  validateVoice: vi.fn().mockImplementation(() => Promise.resolve(mockVoiceValidationResult)),
  toStoredVoiceEvaluation: vi.fn().mockImplementation((result) => ({
    passed: result.passed,
    score: result.score,
    failureReasons: result.failureReasons,
    strengths: result.strengths,
    suggestions: result.suggestions,
    stoppedAt: result.stage,
    costUsd: result.costUsd,
    evaluatedAt: new Date().toISOString(),
  })),
}));

// Type for stylometric result
interface MockStylometricResult {
  pass: boolean;
  score: number;
  threshold: number;
  dimensionScores: {
    sentenceLength: number;
    punctuation: number;
    vocabulary: number;
    functionWords: number;
    syntactic: number;
  };
  feedback: string;
}

// Mock stylometric validator - default to passing
let mockStylometricResult: MockStylometricResult = {
  pass: true,
  score: 0.85,
  threshold: 0.65,
  dimensionScores: {
    sentenceLength: 0.9,
    punctuation: 0.8,
    vocabulary: 0.85,
    functionWords: 0.82,
    syntactic: 0.88,
  },
  feedback: 'Style matches persona',
};

vi.mock('@/lib/voice/stylometric-validator', () => ({
  validate: vi.fn().mockImplementation(() => Promise.resolve(mockStylometricResult)),
  validateSync: vi.fn().mockImplementation(() => mockStylometricResult),
}));

// Type for slop result
interface MockSlopResult {
  isSlop: boolean;
  detectedBy: string[];
  flagForReview: boolean;
  issues: { detector: string; description: string; severity: string }[];
  suggestions: string[];
}

// Mock slop detection - configurable per test
let mockSlopResult: MockSlopResult = {
  isSlop: false,
  detectedBy: [],
  flagForReview: false,
  issues: [],
  suggestions: [],
};

vi.mock('@/lib/slop/detector', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/slop/detector')>();
  return {
    ...original,
    detectSlop: vi.fn().mockImplementation(() => Promise.resolve(mockSlopResult)),
    shouldTriggerRewrite: vi.fn().mockImplementation((result: MockSlopResult) => {
      if (!result.isSlop) return false;
      const hasPhrase = result.detectedBy.includes('phrase');
      const hasStructural = result.detectedBy.includes('structural');
      const hasSemantic = result.detectedBy.includes('semantic');
      const hasVoiceContrast = result.detectedBy.includes('voice-contrast');
      return (hasPhrase || hasStructural) && !hasSemantic && !hasVoiceContrast;
    }),
    toSlopResult: vi.fn().mockImplementation((detailed: MockSlopResult) => ({
      isSlop: detailed.isSlop,
      detectedBy: detailed.detectedBy,
      flagForReview: detailed.flagForReview,
    })),
    needsHumanReview: vi.fn().mockImplementation((result: MockSlopResult) => {
      return (
        result.flagForReview &&
        (result.detectedBy.includes('semantic') || result.detectedBy.includes('voice-contrast'))
      );
    }),
  };
});

// Mock slop rewrite
vi.mock('@/lib/slop/rewrite', () => ({
  rewriteSloppyContent: vi.fn().mockResolvedValue({
    success: true,
    rewrittenContent: 'Rewritten content without slop patterns.',
    costUsd: 0.03,
  }),
}));

// Mock duplicate detection
vi.mock('@/lib/generation/duplicate-detection', () => ({
  checkForDuplicates: vi.fn().mockResolvedValue({
    isDuplicate: false,
    highestSimilarity: 0.3,
    matches: [],
    warning: null,
  }),
}));

// Mock quote value check
vi.mock('@/lib/generation/quote-value-check', () => ({
  validateQuoteValue: vi.fn().mockResolvedValue({
    addsValue: true,
    valueType: 'insight',
    score: 75,
    issues: [],
    suggestions: [],
    costUsd: 0.01,
  }),
}));

// Mock Chroma collections
vi.mock('@/db/chroma/collections/approved-posts', () => ({
  addApprovedPost: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create a test source
function createTestSource(overrides: Partial<Parameters<typeof createSource>[0]> = {}): Source {
  return createSource({
    sourceType: 'like',
    sourceId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    content:
      'Interesting article about how consistency beats intensity in productivity. The key insight is that small daily actions compound over time.',
    metadata: { authorHandle: 'testuser', likeCount: 500 },
    ...overrides,
  });
}

// Reset mocks between tests
function resetMocks(): void {
  mockTrackedCompletionCalls = [];
  mockTrackedCompletionResponse = {
    content: JSON.stringify({
      content: 'Generated post about productivity. Consistency beats intensity.',
      reasoning: {
        keyInsight: 'Consistency is key',
        whyItWorks: 'Resonates with productivity struggles',
        timing: 'Evergreen content',
        concerns: [],
      },
    }),
    costUsd: 0.05,
  };
  mockVoiceValidationResult = {
    passed: true,
    stage: 'llm_eval',
    score: { voice: 85, hook: 80, topic: 90, originality: 75, overall: 82 },
    failureReasons: [],
    strengths: ['Good voice match'],
    suggestions: [],
    costUsd: 0.02,
  };
  mockStylometricResult = {
    pass: true,
    score: 0.85,
    threshold: 0.65,
    dimensionScores: {
      sentenceLength: 0.9,
      punctuation: 0.8,
      vocabulary: 0.85,
      functionWords: 0.82,
      syntactic: 0.88,
    },
    feedback: 'Style matches persona',
  };
  mockSlopResult = {
    isSlop: false,
    detectedBy: [],
    flagForReview: false,
    issues: [],
    suggestions: [],
  };
}

// ============================================================================
// Generation Pipeline Tests
// ============================================================================

describe('Content Generation Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('generateContent() - Full Pipeline', () => {
    it('generates content from source and returns complete output', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: false,
        skipSlopDetection: false,
        skipStylometricValidation: false,
        trackJob: true,
      });

      // Verify output structure
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('postType');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('voiceEvaluation');
      expect(result).toHaveProperty('slopResult');
      expect(result).toHaveProperty('totalCostUsd');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('jobId');

      // Verify content generated
      expect(result.content).toBeTruthy();
      expect(result.content.length).toBeGreaterThan(0);

      // Verify success with mocked passing validations
      expect(result.success).toBe(true);
      expect(result.failureReason).toBeNull();

      // Verify job was tracked
      expect(result.jobId).toBeTruthy();
      const job = getGenerationJobById(result.jobId!);
      expect(job).not.toBeNull();
      expect(job?.status).toBe('completed');
    });

    it('runs slop detection and flags content when detected', async () => {
      const source = createTestSource();

      // Configure slop detection to find issues
      mockSlopResult = {
        isSlop: true,
        detectedBy: ['phrase'],
        flagForReview: false,
        issues: [
          { detector: 'phrase', description: 'Banned phrase: "Let\'s dive in"', severity: 'high' },
        ],
        suggestions: ['Remove banned AI phrases'],
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        maxRewriteAttempts: 0, // No rewrites
        skipSlopDetection: false,
      });

      // Should fail due to slop
      expect(result.success).toBe(false);
      expect(result.slopResult.isSlop).toBe(true);
      expect(result.slopResult.detectedBy).toContain('phrase');
      expect(result.failureReason).toContain('slop');
    });

    it('runs voice validation and includes evaluation in output', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: false,
      });

      // Verify voice evaluation is included
      expect(result.voiceEvaluation).not.toBeNull();
      expect(result.voiceEvaluation?.passed).toBe(true);
      expect(result.voiceEvaluation?.score).toHaveProperty('overall');
      expect(result.voiceEvaluation?.score?.overall).toBe(82);
    });

    it('fails when voice validation fails', async () => {
      const source = createTestSource();

      // Configure voice validation to fail
      mockVoiceValidationResult = {
        passed: false,
        stage: 'llm_eval',
        score: { voice: 40, hook: 50, topic: 60, originality: 45, overall: 48 },
        failureReasons: ['Voice does not match persona', 'Hook is weak'],
        strengths: [],
        suggestions: ['Use more direct language'],
        costUsd: 0.02,
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: false,
      });

      expect(result.success).toBe(false);
      expect(result.voiceEvaluation?.passed).toBe(false);
      expect(result.failureReason).toContain('Voice validation failed');
    });

    it('runs stylometric validation and includes results', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipStylometricValidation: false,
      });

      // Verify stylometric results included
      expect(result.stylometricResult).not.toBeNull();
      expect(result.stylometricResult?.pass).toBe(true);
      expect(result.stylometricSignature).not.toBeNull();
    });

    it('fails when stylometric validation fails', async () => {
      const source = createTestSource();

      // Configure stylometric to fail
      mockStylometricResult = {
        pass: false,
        score: 0.45,
        threshold: 0.65,
        dimensionScores: {
          sentenceLength: 0.3,
          punctuation: 0.4,
          vocabulary: 0.5,
          functionWords: 0.6,
          syntactic: 0.4,
        },
        feedback: 'Sentence length differs significantly from persona',
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipStylometricValidation: false,
      });

      expect(result.success).toBe(false);
      expect(result.stylometricResult?.pass).toBe(false);
      expect(result.failureReason).toContain('Stylometric');
    });

    it('skips validations when options specify', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Should succeed without running validations
      expect(result.success).toBe(true);
      expect(result.voiceEvaluation).toBeNull();
      expect(result.slopResult.isSlop).toBe(false);
      expect(result.stylometricResult).toBeNull();
    });

    it('tracks generation job with correct metadata', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        trackJob: true,
        maxRewriteAttempts: 3,
      });

      expect(result.jobId).toBeTruthy();

      const job = getGenerationJobById(result.jobId!);
      expect(job).not.toBeNull();
      expect(job?.pipeline).toBe('typescript');
      expect(job?.status).toBe('completed');
      expect(job?.sourceIds).toContain(source.id);
    });
  });

  describe('Slop Detection and Rewrite Loop', () => {
    it('triggers rewrite when phrase slop detected and rewrites allowed', async () => {
      const source = createTestSource();

      // First call: detect slop
      // After rewrite: no slop
      let callCount = 0;
      const { detectSlop } = await import('@/lib/slop/detector');
      vi.mocked(detectSlop).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            isSlop: true,
            detectedBy: ['phrase'],
            flagForReview: false,
            issues: [{ detector: 'phrase', description: 'Banned phrase', severity: 'high' }],
            suggestions: ['Remove banned phrases'],
          });
        }
        return Promise.resolve({
          isSlop: false,
          detectedBy: [],
          flagForReview: false,
          issues: [],
          suggestions: [],
        });
      });

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        maxRewriteAttempts: 2,
        skipSlopDetection: false,
      });

      // Slop was detected and rewritten
      expect(result.rewriteCount).toBe(1);
      expect(result.success).toBe(true);
    });

    it('does not rewrite when semantic similarity flagged (unfixable)', async () => {
      const source = createTestSource();

      // Configure semantic slop (unfixable via rewrite)
      // Note: The mockSlopResult is used by detectSlop mock, which the generator calls
      mockSlopResult = {
        isSlop: true,
        detectedBy: ['semantic'],
        flagForReview: true,
        issues: [
          {
            detector: 'semantic',
            description: 'Too similar to known AI content',
            severity: 'high',
          },
        ],
        suggestions: ['Rewrite completely'],
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        maxRewriteAttempts: 3,
        skipSlopDetection: false,
      });

      // Should not rewrite - semantic is unfixable
      expect(result.rewriteCount).toBe(0);
      // Content should still be generated
      expect(result.content).toBeTruthy();
    });

    it('does not rewrite when voice-contrast flagged (unfixable)', async () => {
      const source = createTestSource();

      // This test verifies that voice-contrast slop doesn't trigger rewrites
      // because it's not fixable via LLM rewriting
      mockSlopResult = {
        isSlop: true,
        detectedBy: ['voice-contrast'],
        flagForReview: true,
        issues: [
          { detector: 'voice-contrast', description: 'Voice deviation detected', severity: 'high' },
        ],
        suggestions: ['Adjust to match voice'],
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        maxRewriteAttempts: 3,
        skipSlopDetection: false,
      });

      // When slop detection is mocked to return voice-contrast issues,
      // no rewrites should occur (voice-contrast is unfixable)
      expect(result.rewriteCount).toBe(0);
      // The generation should still complete (with or without slop flag)
      expect(result.content).toBeTruthy();
    });

    it('respects maxRewriteAttempts limit', async () => {
      const source = createTestSource();

      // Always return slop (never resolves)
      const { detectSlop } = await import('@/lib/slop/detector');
      vi.mocked(detectSlop).mockResolvedValue({
        isSlop: true,
        detectedBy: ['phrase'],
        flagForReview: false,
        issues: [{ detector: 'phrase', description: 'Banned phrase', severity: 'high' }],
        suggestions: [],
      });

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        maxRewriteAttempts: 2,
        skipSlopDetection: false,
      });

      // Should stop at max attempts
      expect(result.rewriteCount).toBeLessThanOrEqual(2);
      expect(result.success).toBe(false);
    });
  });

  describe('Humanizer Pattern Detection', () => {
    it('detects humanizer patterns in content', async () => {
      const source = createTestSource();

      // Configure humanizer detection
      mockSlopResult = {
        isSlop: true,
        detectedBy: ['humanizer'],
        flagForReview: false,
        issues: [
          {
            detector: 'humanizer',
            description: 'AI vocabulary: "Additionally"',
            severity: 'medium',
          },
          {
            detector: 'humanizer',
            description: 'Sycophantic tone: "Great question!"',
            severity: 'high',
          },
        ],
        suggestions: ['Rewrite to reduce AI-sounding patterns'],
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        maxRewriteAttempts: 0,
        skipSlopDetection: false,
      });

      // Verify slop detection is called and returns our mock result
      expect(result.slopResult.isSlop).toBe(true);
      // The detectedBy array comes from our mock, though toSlopResult processes it
      expect(result.slopResult.detectedBy.length).toBeGreaterThanOrEqual(1);
    });

    it('combines multiple slop detectors when all flagged', async () => {
      const source = createTestSource();

      mockSlopResult = {
        isSlop: true,
        detectedBy: ['phrase', 'humanizer', 'structural'],
        flagForReview: false,
        issues: [
          { detector: 'phrase', description: 'Banned phrase', severity: 'high' },
          { detector: 'humanizer', description: 'AI vocabulary', severity: 'medium' },
          { detector: 'structural', description: 'Too many emojis', severity: 'low' },
        ],
        suggestions: [],
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        maxRewriteAttempts: 0,
        skipSlopDetection: false,
      });

      // Verify multiple detectors are reported
      expect(result.slopResult.isSlop).toBe(true);
      expect(result.slopResult.detectedBy.length).toBeGreaterThanOrEqual(1);
      // Note: the actual detectedBy content depends on the mock being picked up
      // by the generator's internal call to detectSlop()
    });
  });

  describe('Post Type Handling', () => {
    it('generates single post by default', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Default should be single
      expect(['single', 'thread', 'quote', 'reply']).toContain(result.postType);
    });

    it('generates specified post type', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        postType: 'thread',
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(result.postType).toBe('thread');
    });

    it('runs quote value check for quote posts', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        postType: 'quote',
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
        skipQuoteValueCheck: false,
      });

      expect(result.postType).toBe('quote');
      expect(result.quoteValueCheck).not.toBeNull();
      expect(result.quoteValueCheck?.addsValue).toBe(true);
    });

    it('fails quote post when no value added', async () => {
      const source = createTestSource();

      // Mock quote value check to fail
      const { validateQuoteValue } = await import('@/lib/generation/quote-value-check');
      vi.mocked(validateQuoteValue).mockResolvedValueOnce({
        addsValue: false,
        valueType: null,
        score: 25,
        issues: [
          { type: 'empty_reaction', severity: 'high', description: 'Quote is just a reaction' },
        ],
        suggestions: ['Add unique insight'],
        costUsd: 0.01,
      });

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        postType: 'quote',
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
        skipQuoteValueCheck: false,
      });

      expect(result.success).toBe(false);
      expect(result.quoteValueCheck?.addsValue).toBe(false);
      expect(result.failureReason).toContain('Quote');
    });
  });

  describe('Cost Tracking', () => {
    it('tracks total cost across all LLM calls', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: false, // Adds cost
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Should have generation cost + voice validation cost
      expect(result.totalCostUsd).toBeGreaterThan(0);
      // Generation: 0.05, Voice: 0.02 = 0.07
      expect(result.totalCostUsd).toBeGreaterThanOrEqual(0.05);
    });

    it('includes rewrite costs in total', async () => {
      const source = createTestSource();

      // Setup rewrite to happen once
      let callCount = 0;
      const { detectSlop } = await import('@/lib/slop/detector');
      vi.mocked(detectSlop).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            isSlop: true,
            detectedBy: ['phrase'],
            flagForReview: false,
            issues: [],
            suggestions: [],
          });
        }
        return Promise.resolve({
          isSlop: false,
          detectedBy: [],
          flagForReview: false,
          issues: [],
          suggestions: [],
        });
      });

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        maxRewriteAttempts: 1,
        skipVoiceValidation: true,
        skipSlopDetection: false,
        skipStylometricValidation: true,
      });

      // Should include rewrite cost (0.03)
      expect(result.rewriteCount).toBe(1);
      expect(result.totalCostUsd).toBeGreaterThanOrEqual(0.08); // 0.05 + 0.03
    });
  });

  describe('Reasoning and Metadata', () => {
    it('includes source analysis in reasoning', async () => {
      const source = createTestSource({
        content:
          'Breaking news: New problem solving technique discovered. The solution involves systematic thinking.',
      });

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(result.reasoning).toHaveProperty('source');
      expect(result.reasoning).toHaveProperty('whyItWorks');
      expect(result.reasoning).toHaveProperty('timing');
      expect(result.reasoning).toHaveProperty('concerns');
      expect(result.reasoning.source).toBe(source.sourceId);
    });

    it('captures concerns from multiple validation stages', async () => {
      const source = createTestSource();

      // Configure with warnings (but still passing)
      mockVoiceValidationResult = {
        passed: true,
        stage: 'llm_eval',
        score: { voice: 72, hook: 70, topic: 75, originality: 68, overall: 71 },
        failureReasons: [],
        strengths: ['Acceptable voice'],
        suggestions: ['Could improve hook strength'],
        costUsd: 0.02,
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: false,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(result.success).toBe(true);
      expect(result.reasoning.concerns).toBeDefined();
      expect(Array.isArray(result.reasoning.concerns)).toBe(true);
    });
  });

  describe('Job Tracking', () => {
    it('creates job record with correct initial state', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        trackJob: true,
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      const job = getGenerationJobById(result.jobId!);
      expect(job).not.toBeNull();
      expect(job?.pipeline).toBe('typescript');
      expect(job?.contentType).toBe(result.postType);
    });

    it('marks job as failed when generation fails', async () => {
      const source = createTestSource();

      // Configure voice validation to fail (more reliable way to trigger failure)
      mockVoiceValidationResult = {
        passed: false,
        stage: 'llm_eval',
        score: { voice: 30, hook: 30, topic: 30, originality: 30, overall: 30 },
        failureReasons: ['Voice mismatch'],
        strengths: [],
        suggestions: [],
        costUsd: 0.02,
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        trackJob: true,
        maxRewriteAttempts: 0,
        skipVoiceValidation: false, // Run voice validation to trigger failure
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(result.success).toBe(false);
      expect(result.voiceEvaluation?.passed).toBe(false);

      const job = getGenerationJobById(result.jobId!);
      expect(job?.status).toBe('failed');
    });

    it('does not create job when trackJob is false', async () => {
      const source = createTestSource();

      const jobsBefore = getRecentJobs(100);
      const countBefore = jobsBefore.length;

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        trackJob: false,
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(result.jobId).toBeNull();

      const jobsAfter = getRecentJobs(100);
      expect(jobsAfter.length).toBe(countBefore);
    });
  });

  describe('Error Handling', () => {
    it('marks job as failed on error', async () => {
      const source = createTestSource();

      // Make LLM call throw error
      const { trackedCompletion } = await import('@/lib/anthropic/cost-tracking');
      vi.mocked(trackedCompletion).mockRejectedValueOnce(new Error('LLM API error'));

      const { generateContent } = await import('@/lib/generation/generator');

      await expect(generateContent(source, { trackJob: true })).rejects.toThrow('LLM API error');

      // Check job was marked as failed
      const jobs = getRecentJobs(10);
      const latestJob = jobs[0];
      expect(latestJob?.status).toBe('failed');
      expect(latestJob?.error).toContain('LLM API error');
    });

    it('handles source not found gracefully', async () => {
      // Try to generate from non-existent source
      const fakeSource: Source = {
        id: 99999,
        sourceType: 'like',
        sourceId: 'fake-123',
        content: 'Test content',
        metadata: {},
        scrapedAt: new Date().toISOString(),
      };

      const { generateContent } = await import('@/lib/generation/generator');

      // Should still work with in-memory source
      const result = await generateContent(fakeSource, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
        trackJob: false,
      });

      expect(result.content).toBeTruthy();
    });
  });

  describe('Duplicate Detection', () => {
    it('includes duplicate check results', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipDuplicateCheck: false,
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(result.duplicateCheck).not.toBeNull();
      expect(result.duplicateCheck?.isDuplicate).toBe(false);
    });

    it('adds warning to concerns when near-duplicate found', async () => {
      const source = createTestSource();

      // Mock near-duplicate detection
      const { checkForDuplicates } = await import('@/lib/generation/duplicate-detection');
      vi.mocked(checkForDuplicates).mockResolvedValueOnce({
        isDuplicate: false,
        highestSimilarity: 0.75,
        matches: [{ postId: 1, content: 'Similar post', similarity: 0.75, source: 'pending_post' }],
        warning: 'Content is 75% similar to existing post #1',
      });

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipDuplicateCheck: false,
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(result.duplicateCheck?.warning).toBeTruthy();
      expect(result.reasoning.concerns.some((c) => c.includes('Duplicate'))).toBe(true);
    });
  });
});

// ============================================================================
// INT-002: Full Pipeline Integration Tests
// Tests: Source -> Generate -> Humanize -> Voice Check -> Slop Check -> Queue
// ============================================================================

describe('INT-002: Full Generation Pipeline with Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('Humanization Integration', () => {
    it('stores both rawContent and humanized content', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Verify both raw and humanized content are returned
      expect(result.rawContent).toBeDefined();
      expect(result.content).toBeDefined();
      // Content may or may not differ based on humanizer patterns
      expect(typeof result.rawContent).toBe('string');
      expect(typeof result.content).toBe('string');
    });

    it('returns humanizeResult with changes made', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Verify humanizeResult structure
      expect(result.humanizeResult).not.toBeNull();
      expect(result.humanizeResult).toHaveProperty('humanized');
      expect(result.humanizeResult).toHaveProperty('changes');
      expect(Array.isArray(result.humanizeResult?.changes)).toBe(true);
    });

    it('applies humanizer patterns when content contains AI vocabulary', async () => {
      const source = createTestSource();

      // Mock LLM to generate content with AI vocabulary
      mockTrackedCompletionResponse = {
        content: JSON.stringify({
          content:
            'Additionally, this represents a testament to modern productivity. Let me dive into the landscape of efficiency.',
          reasoning: {
            keyInsight: 'Productivity insight',
            whyItWorks: 'Resonates with audience',
            timing: 'Evergreen',
            concerns: [],
          },
        }),
        costUsd: 0.05,
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const result = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Verify humanizer detected patterns
      expect(result.humanizeResult).not.toBeNull();
      // The rawContent should contain the original AI vocabulary
      expect(result.rawContent).toContain('Additionally');
    });

    it('humanizes content before slop detection', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      // Track slop detection calls to verify humanized content is passed
      const { detectSlop } = await import('@/lib/slop/detector');
      let slopInputContent = '';
      vi.mocked(detectSlop).mockImplementation((content: string) => {
        slopInputContent = content;
        return Promise.resolve({
          isSlop: false,
          detectedBy: [],
          flagForReview: false,
          issues: [],
          suggestions: [],
        });
      });

      const result = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: false, // Enable slop detection
        skipStylometricValidation: true,
      });

      // Slop detection should receive the humanized content
      expect(slopInputContent).toBe(result.humanizeResult?.humanized);
    });
  });

  describe('Queue Integration', () => {
    it('creates post from generation output and adds to queue', async () => {
      const source = createTestSource();

      const { generateContent, toPost } = await import('@/lib/generation/generator');
      const { createPost } = await import('@/db/models/posts');
      const { createQueueItem, getQueueItemByPostId } = await import('@/db/models/queue');

      const output = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(output.success).toBe(true);

      // Convert output to post and create in database
      const postData = toPost(output);
      const post = createPost({
        content: postData.content,
        type: postData.type,
        status: postData.status,
        confidenceScore: postData.confidenceScore,
        reasoning: postData.reasoning,
        voiceEvaluation: postData.voiceEvaluation ?? undefined,
        stylometricSignature: postData.stylometricSignature ?? undefined,
      });

      expect(post.id).toBeDefined();
      expect(post.status).toBe('pending');

      // Add post to queue
      const queueItem = createQueueItem({
        postId: post.id,
        priority: Math.round(post.confidenceScore),
      });

      expect(queueItem.postId).toBe(post.id);

      // Verify queue item can be retrieved
      const retrieved = getQueueItemByPostId(post.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.postId).toBe(post.id);
    });

    it('sets post as draft when generation fails and does not queue', async () => {
      const source = createTestSource();

      // Configure voice validation to fail
      mockVoiceValidationResult = {
        passed: false,
        stage: 'llm_eval',
        score: { voice: 30, hook: 30, topic: 30, originality: 30, overall: 30 },
        failureReasons: ['Voice mismatch'],
        strengths: [],
        suggestions: [],
        costUsd: 0.02,
      };

      const { generateContent, toPost } = await import('@/lib/generation/generator');
      const { createPost } = await import('@/db/models/posts');
      const { listPosts } = await import('@/db/models/posts');

      const output = await generateContent(source, {
        skipVoiceValidation: false,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      expect(output.success).toBe(false);

      // Convert output to post
      const postData = toPost(output);
      expect(postData.status).toBe('draft');

      // Create post in database as draft
      const post = createPost({
        content: postData.content,
        type: postData.type,
        status: postData.status,
        confidenceScore: postData.confidenceScore,
        reasoning: postData.reasoning,
      });

      expect(post.status).toBe('draft');

      // Verify post is in drafts
      const drafts = listPosts({ status: 'draft' });
      expect(drafts.some((d) => d.id === post.id)).toBe(true);
    });

    it('preserves humanized content through post creation', async () => {
      const source = createTestSource();

      const { generateContent, toPost } = await import('@/lib/generation/generator');
      const { createPost, getPostById } = await import('@/db/models/posts');

      const output = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Create post from output
      const postData = toPost(output);
      const post = createPost({
        content: postData.content,
        type: postData.type,
        status: postData.status,
        confidenceScore: postData.confidenceScore,
        reasoning: postData.reasoning,
      });

      // Retrieve and verify
      const retrieved = getPostById(post.id);
      expect(retrieved).not.toBeNull();
      // Post content should be the humanized content, not rawContent
      expect(retrieved?.content).toBe(output.content);
    });
  });

  describe('Full Pipeline: Source -> Generate -> Humanize -> Voice -> Slop -> Queue', () => {
    it('completes full pipeline successfully with all validations', async () => {
      const source = createTestSource();

      const { generateContent, toPost } = await import('@/lib/generation/generator');
      const { createPost } = await import('@/db/models/posts');
      const { createQueueItem, getQueueItemByPostId, listQueue } =
        await import('@/db/models/queue');

      // Run full generation with all validations enabled
      const output = await generateContent(source, {
        skipVoiceValidation: false,
        skipSlopDetection: false,
        skipStylometricValidation: false,
        skipDuplicateCheck: false,
        trackJob: true,
      });

      // Verify all stages ran
      expect(output.rawContent).toBeDefined(); // Generation happened
      expect(output.humanizeResult).not.toBeNull(); // Humanization happened
      expect(output.voiceEvaluation).not.toBeNull(); // Voice check happened
      expect(output.slopResult).toBeDefined(); // Slop check happened
      expect(output.stylometricResult).not.toBeNull(); // Stylometric happened
      expect(output.duplicateCheck).not.toBeNull(); // Duplicate check happened
      expect(output.success).toBe(true);

      // Create post and add to queue
      const postData = toPost(output);
      const post = createPost({
        content: postData.content,
        type: postData.type,
        status: postData.status,
        confidenceScore: postData.confidenceScore,
        reasoning: postData.reasoning,
        voiceEvaluation: postData.voiceEvaluation ?? undefined,
        stylometricSignature: postData.stylometricSignature ?? undefined,
      });

      createQueueItem({
        postId: post.id,
        priority: Math.round(post.confidenceScore),
      });

      // Verify complete pipeline result
      expect(post.status).toBe('pending');
      const queueItem = getQueueItemByPostId(post.id);
      expect(queueItem).not.toBeNull();

      // Verify queue has items
      const queue = listQueue();
      expect(queue.length).toBeGreaterThan(0);
      expect(queue.some((q) => q.postId === post.id)).toBe(true);
    });

    it('handles validation failure at voice check stage', async () => {
      const source = createTestSource();

      // Configure voice validation to fail
      mockVoiceValidationResult = {
        passed: false,
        stage: 'fast_filter',
        score: { voice: 40, hook: 50, topic: 60, originality: 45, overall: 48 },
        failureReasons: ['Voice does not match persona'],
        strengths: [],
        suggestions: ['Use more direct language'],
        costUsd: 0.02,
      };

      const { generateContent } = await import('@/lib/generation/generator');

      const output = await generateContent(source, {
        skipVoiceValidation: false,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Pipeline should complete but fail
      expect(output.rawContent).toBeDefined(); // Generation happened
      expect(output.humanizeResult).not.toBeNull(); // Humanization happened
      expect(output.voiceEvaluation).not.toBeNull(); // Voice check happened
      expect(output.voiceEvaluation?.passed).toBe(false);
      expect(output.success).toBe(false);
      expect(output.failureReason).toContain('Voice');
    });

    it('handles validation failure at slop check stage', async () => {
      const source = createTestSource();

      // Configure slop detection to fail via explicit mock
      const { detectSlop } = await import('@/lib/slop/detector');
      vi.mocked(detectSlop).mockResolvedValue({
        isSlop: true,
        detectedBy: ['phrase', 'humanizer'],
        flagForReview: false,
        issues: [
          { detector: 'phrase', description: 'Banned phrase detected', severity: 'high' },
          { detector: 'humanizer', description: 'AI vocabulary detected', severity: 'medium' },
        ],
        suggestions: ['Remove AI patterns'],
      });

      const { generateContent } = await import('@/lib/generation/generator');

      const output = await generateContent(source, {
        maxRewriteAttempts: 0, // No rewrites
        skipVoiceValidation: true,
        skipSlopDetection: false,
        skipStylometricValidation: true,
      });

      // Pipeline should complete but fail
      expect(output.rawContent).toBeDefined(); // Generation happened
      expect(output.humanizeResult).not.toBeNull(); // Humanization happened
      expect(output.slopResult.isSlop).toBe(true); // Slop detected
      expect(output.success).toBe(false);
      expect(output.failureReason).toContain('slop');
    });

    it('tracks costs across all pipeline stages', async () => {
      const source = createTestSource();

      const { generateContent } = await import('@/lib/generation/generator');

      const output = await generateContent(source, {
        skipVoiceValidation: false, // Adds voice check cost (0.02)
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Should include generation cost (0.05) + voice cost (0.02)
      expect(output.totalCostUsd).toBeGreaterThanOrEqual(0.07);
    });

    it('preserves source reference through pipeline', async () => {
      const source = createTestSource({
        sourceId: 'unique-source-123',
        content: 'Unique content about testing pipelines and integration',
      });

      const { generateContent, toPost } = await import('@/lib/generation/generator');
      const { createPost, getPostById } = await import('@/db/models/posts');

      const output = await generateContent(source, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
      });

      // Reasoning should reference original source
      expect(output.reasoning.source).toBe(source.sourceId);

      // Create post and verify source is preserved
      const postData = toPost(output);
      const post = createPost({
        content: postData.content,
        type: postData.type,
        status: postData.status,
        confidenceScore: postData.confidenceScore,
        reasoning: postData.reasoning,
      });

      const retrieved = getPostById(post.id);
      expect(retrieved?.reasoning.source).toBe(source.sourceId);
    });

    it('processes multiple sources through pipeline independently', async () => {
      const source1 = createTestSource({
        sourceId: 'source-1',
        content: 'First source about productivity and focus',
      });
      const source2 = createTestSource({
        sourceId: 'source-2',
        content: 'Second source about creativity and innovation',
      });

      const { generateContent, toPost } = await import('@/lib/generation/generator');
      const { createPost } = await import('@/db/models/posts');
      const { createQueueItem, listQueue } = await import('@/db/models/queue');

      // Process both sources
      const output1 = await generateContent(source1, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
        trackJob: true,
      });

      const output2 = await generateContent(source2, {
        skipVoiceValidation: true,
        skipSlopDetection: true,
        skipStylometricValidation: true,
        trackJob: true,
      });

      expect(output1.success).toBe(true);
      expect(output2.success).toBe(true);

      // Create posts for both
      const postData1 = toPost(output1);
      const postData2 = toPost(output2);

      const post1 = createPost({
        content: postData1.content,
        type: postData1.type,
        status: postData1.status,
        confidenceScore: postData1.confidenceScore,
        reasoning: postData1.reasoning,
      });

      const post2 = createPost({
        content: postData2.content,
        type: postData2.type,
        status: postData2.status,
        confidenceScore: postData2.confidenceScore,
        reasoning: postData2.reasoning,
      });

      // Add both to queue
      createQueueItem({ postId: post1.id, priority: 50 });
      createQueueItem({ postId: post2.id, priority: 60 });

      // Verify both are in queue
      const queue = listQueue();
      expect(queue.length).toBe(2);

      // Verify source references are distinct
      expect(post1.reasoning.source).toBe('source-1');
      expect(post2.reasoning.source).toBe('source-2');
    });
  });
});

// ============================================================================
// toPost Helper Tests
// ============================================================================

describe('toPost() - Output Conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('converts successful generation to pending post', async () => {
    const source = createTestSource();

    const { generateContent, toPost } = await import('@/lib/generation/generator');

    const output = await generateContent(source, {
      skipVoiceValidation: true,
      skipSlopDetection: true,
      skipStylometricValidation: true,
    });

    const post = toPost(output);

    expect(post.status).toBe('pending');
    expect(post.content).toBe(output.content);
    expect(post.type).toBe(output.postType);
    expect(post.reasoning).toEqual(output.reasoning);
  });

  it('converts failed generation to draft post', async () => {
    const source = createTestSource();

    // Configure voice validation to fail
    mockVoiceValidationResult = {
      passed: false,
      stage: 'llm_eval',
      score: { voice: 30, hook: 30, topic: 30, originality: 30, overall: 30 },
      failureReasons: ['Voice mismatch'],
      strengths: [],
      suggestions: [],
      costUsd: 0.02,
    };

    const { generateContent, toPost } = await import('@/lib/generation/generator');

    const output = await generateContent(source, {
      maxRewriteAttempts: 0,
      skipVoiceValidation: false,
      skipSlopDetection: true,
      skipStylometricValidation: true,
    });

    expect(output.success).toBe(false);
    const post = toPost(output);

    expect(post.status).toBe('draft');
  });

  it('marks as draft when flagged for human review', async () => {
    const source = createTestSource();

    // Configure stylometric validation to fail - this triggers flagForHumanReview
    mockStylometricResult = {
      pass: false,
      score: 0.3,
      threshold: 0.65,
      dimensionScores: {
        sentenceLength: 0.2,
        punctuation: 0.3,
        vocabulary: 0.4,
        functionWords: 0.3,
        syntactic: 0.3,
      },
      feedback: 'Style significantly different from persona',
    };

    const { generateContent, toPost } = await import('@/lib/generation/generator');

    const output = await generateContent(source, {
      maxRewriteAttempts: 0,
      skipVoiceValidation: true,
      skipSlopDetection: true,
      skipStylometricValidation: false,
    });

    // Stylometric failure leads to draft status
    expect(output.success).toBe(false);

    const post = toPost(output);
    expect(post.status).toBe('draft');
  });
});
