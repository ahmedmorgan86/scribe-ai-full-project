/**
 * Integration Test: Validation Consistency Between Direct and API Paths
 *
 * This test verifies that the same input produces the same validation result
 * whether called directly via TypeScript functions or via the API routes
 * that Python workers use.
 *
 * Architecture Decision (Phase 1.6 task 30.1.3):
 * TypeScript was chosen as the single runtime for validation logic.
 * Python LangGraph workers call TypeScript APIs for voice/slop validation.
 *
 * This test ensures:
 * 1. /api/voice/check produces same result as embeddingSimilarityFilter()
 * 2. /api/slop/detect produces same result as detectSlop()
 * 3. Thresholds are consistently applied from the centralized config
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST as voiceCheckHandler, VoiceCheckResponse } from '@/app/api/voice/check/route';
import { POST as slopDetectHandler, SlopDetectResponse } from '@/app/api/slop/detect/route';
import { embeddingSimilarityFilter } from '@/lib/voice/fast-filter';
import { detectSlop, getSlopSeverityScore } from '@/lib/slop/detector';
import { VOICE_THRESHOLDS, SLOP_THRESHOLDS } from '@/lib/config/thresholds';

// Mock voice/embeddings module for both direct and API-internal calls
vi.mock('@/lib/voice/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/voice/embeddings')>();
  return {
    ...actual,
    checkVoiceSimilarity: vi.fn().mockResolvedValue({
      similarity: 0.75,
      matches: [
        { content: 'Similar post 1', similarity: 0.8, source: 'approved_posts' },
        { content: 'Similar post 2', similarity: 0.7, source: 'approved_posts' },
      ],
    }),
    getVoiceCorpusStatus: vi.fn().mockResolvedValue({
      approvedPostsCount: 100,
      hasMinimumCorpus: true,
      guidelinesLoaded: true,
    }),
  };
});

vi.mock('@/lib/slop/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/slop/semantic')>();
  return {
    ...actual,
    checkSemanticSimilarity: vi.fn().mockResolvedValue({
      isSlop: false,
      similarity: 0.3,
      closestMatch: null,
      matches: [],
      corpusSize: 50,
    }),
  };
});

vi.mock('@/lib/slop/voice-contrast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/slop/voice-contrast')>();
  return {
    ...actual,
    checkVoiceContrast: vi.fn().mockResolvedValue({
      hasDeviation: false,
      deviations: [],
      overallScore: 0.9,
    }),
    hasHighSeverityDeviation: vi.fn().mockReturnValue(false),
  };
});

function createMockRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function getVoiceResponse(request: NextRequest): Promise<VoiceCheckResponse> {
  const response = await voiceCheckHandler(request);
  return response.json() as Promise<VoiceCheckResponse>;
}

async function getSlopResponse(request: NextRequest): Promise<SlopDetectResponse> {
  const response = await slopDetectHandler(request);
  return response.json() as Promise<SlopDetectResponse>;
}

describe('Validation Consistency: Direct vs API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Note: Don't use vi.restoreAllMocks() here - it would undo vi.mock() factories

  describe('Voice Validation Consistency', () => {
    const testCases = [
      {
        name: 'clean content',
        content: 'Built a CLI tool that helps developers write better code.',
        expectedPass: true,
      },
      {
        name: 'content with good voice match',
        content: 'You struggle with Docker image sizes. Here is how to reduce them by 60%.',
        expectedPass: true,
      },
      {
        name: 'very short content',
        content: 'AI.',
        expectedPass: true,
      },
      {
        name: 'content with technical jargon',
        content:
          'The API uses REST endpoints with JWT authentication and supports WebSocket connections for real-time updates.',
        expectedPass: true,
      },
    ];

    for (const testCase of testCases) {
      it(`same pass/fail result for ${testCase.name}`, async () => {
        const threshold = VOICE_THRESHOLDS.similarity;

        const directResult = await embeddingSimilarityFilter(testCase.content, {
          threshold,
          nResults: 5,
          includeGuidelines: true,
          requireCorpus: false,
        });

        const apiRequest = createMockRequest({
          content: testCase.content,
          threshold,
        });
        const apiData = await getVoiceResponse(apiRequest);

        expect(apiData.success).toBe(true);
        expect(apiData.result).not.toBeNull();

        expect(apiData.result?.pass).toBe(directResult.passed);
        expect(apiData.result?.threshold).toBe(directResult.threshold);
        expect(apiData.result?.corpusAvailable).toBe(directResult.corpusAvailable);
      });
    }

    it('uses same threshold from centralized config', async () => {
      const content = 'Test content for threshold verification.';

      const directResult = await embeddingSimilarityFilter(content, {});

      const apiRequest = createMockRequest({ content });
      const apiData = await getVoiceResponse(apiRequest);

      expect(directResult.threshold).toBe(VOICE_THRESHOLDS.similarity);
      expect(apiData.result?.threshold).toBe(VOICE_THRESHOLDS.similarity);
    });

    it('custom threshold is respected in both paths', async () => {
      const content = 'Test content for custom threshold.';
      const customThreshold = 0.5;

      const directResult = await embeddingSimilarityFilter(content, {
        threshold: customThreshold,
      });

      const apiRequest = createMockRequest({
        content,
        threshold: customThreshold,
      });
      const apiData = await getVoiceResponse(apiRequest);

      expect(directResult.threshold).toBe(customThreshold);
      expect(apiData.result?.threshold).toBe(customThreshold);
    });
  });

  describe('Slop Detection Consistency', () => {
    const testCases = [
      {
        name: 'clean professional content',
        content:
          'Built a CLI tool that reduces Docker image sizes by 60%. Uses multi-stage builds and Alpine base images.',
        expectedPass: true,
      },
      {
        name: 'content with banned phrase',
        content: "Let's dive in to this amazing topic that will revolutionize everything.",
        expectedPass: false,
      },
      {
        name: 'content with hashtags',
        content: 'Check out this cool tool #AI #coding #tech',
        expectedPass: false,
      },
      {
        name: 'content with listicle format',
        content: '1. First point\n2. Second point\n3. Third point\n4. Fourth point',
        expectedPass: false,
      },
      {
        name: 'content with excessive emoji',
        content: '🚀🔥💯🎉 Amazing stuff happening here!',
        expectedPass: false,
      },
    ];

    for (const testCase of testCases) {
      it(`same pass/fail result for ${testCase.name}`, async () => {
        const threshold = SLOP_THRESHOLDS.maxScore;

        const directResult = await detectSlop(testCase.content, {
          skipSemantic: false,
          skipVoiceContrast: false,
        });
        const directScore = getSlopSeverityScore(directResult);
        const directPass = directScore < threshold;

        const apiRequest = createMockRequest({
          content: testCase.content,
          threshold,
          skipSemantic: false,
          skipVoiceContrast: false,
        });
        const apiData = await getSlopResponse(apiRequest);

        expect(apiData.success).toBe(true);
        expect(apiData.result).not.toBeNull();

        expect(apiData.result?.pass).toBe(directPass);

        expect(apiData.result?.score).toBe(directScore);

        expect(apiData.result?.detectedBy).toEqual(directResult.detectedBy);
      });
    }

    it('uses same threshold from centralized config', async () => {
      const content = 'Test content for threshold verification.';

      const directResult = await detectSlop(content, {});
      const directScore = getSlopSeverityScore(directResult);

      const apiRequest = createMockRequest({ content });
      const apiData = await getSlopResponse(apiRequest);

      expect(apiData.result?.threshold).toBe(SLOP_THRESHOLDS.maxScore);

      const expectedPass = directScore < SLOP_THRESHOLDS.maxScore;
      expect(apiData.result?.pass).toBe(expectedPass);
    });

    it('custom threshold is respected in both paths', async () => {
      const content = 'Test content for custom threshold.';
      const customThreshold = 50;

      const directResult = await detectSlop(content, {});
      const directScore = getSlopSeverityScore(directResult);
      const directPass = directScore < customThreshold;

      const apiRequest = createMockRequest({
        content,
        threshold: customThreshold,
      });
      const apiData = await getSlopResponse(apiRequest);

      expect(apiData.result?.threshold).toBe(customThreshold);
      expect(apiData.result?.pass).toBe(directPass);
    });

    it('skip options are respected in both paths', async () => {
      const content = 'Test content for skip options.';

      const directResult = await detectSlop(content, {
        skipSemantic: true,
        skipVoiceContrast: true,
      });

      const apiRequest = createMockRequest({
        content,
        skipSemantic: true,
        skipVoiceContrast: true,
      });
      const apiData = await getSlopResponse(apiRequest);

      expect(apiData.result?.detectedBy).toEqual(directResult.detectedBy);

      expect(directResult.detectedBy).not.toContain('semantic');
      expect(directResult.detectedBy).not.toContain('voice_contrast');
    });

    it('issue details match between direct and API', async () => {
      const content = "Let's dive in #hashtag";

      const directResult = await detectSlop(content, {
        skipSemantic: true,
        skipVoiceContrast: true,
      });

      const apiRequest = createMockRequest({
        content,
        skipSemantic: true,
        skipVoiceContrast: true,
      });
      const apiData = await getSlopResponse(apiRequest);

      const directIssueDescriptions = directResult.issues.map((i) => i.description);
      const apiIssueDescriptions = apiData.result?.issues.map((i) => i.description);

      expect(apiIssueDescriptions).toEqual(directIssueDescriptions);
    });
  });

  describe('Error Handling Consistency', () => {
    it('voice check handles empty content consistently', async () => {
      const apiRequest = createMockRequest({ content: '' });
      const apiData = await getVoiceResponse(apiRequest);

      expect(apiData.success).toBe(false);
      expect(apiData.error).toContain('required');
    });

    it('slop detect handles empty content consistently', async () => {
      const apiRequest = createMockRequest({ content: '' });
      const apiData = await getSlopResponse(apiRequest);

      expect(apiData.success).toBe(false);
      expect(apiData.error).toContain('required');
    });

    it('voice check handles missing content field', async () => {
      const apiRequest = createMockRequest({});
      const apiResponse = await voiceCheckHandler(apiRequest);
      const apiData = (await apiResponse.json()) as VoiceCheckResponse;

      expect(apiData.success).toBe(false);
      expect(apiResponse.status).toBe(400);
    });

    it('slop detect handles missing content field', async () => {
      const apiRequest = createMockRequest({});
      const apiResponse = await slopDetectHandler(apiRequest);
      const apiData = (await apiResponse.json()) as SlopDetectResponse;

      expect(apiData.success).toBe(false);
      expect(apiResponse.status).toBe(400);
    });
  });

  describe('Threshold Configuration Consistency', () => {
    it('all validation thresholds are accessible', () => {
      expect(VOICE_THRESHOLDS.similarity).toBeGreaterThan(0);
      expect(VOICE_THRESHOLDS.similarity).toBeLessThanOrEqual(1);

      expect(SLOP_THRESHOLDS.maxScore).toBeGreaterThan(0);
      expect(SLOP_THRESHOLDS.maxScore).toBeLessThanOrEqual(100);

      expect(SLOP_THRESHOLDS.semanticThreshold).toBeGreaterThan(0);
      expect(SLOP_THRESHOLDS.semanticThreshold).toBeLessThanOrEqual(1);
    });

    it('default thresholds match expected values', () => {
      expect(VOICE_THRESHOLDS.similarity).toBe(0.7);
      expect(SLOP_THRESHOLDS.maxScore).toBe(30);
      expect(SLOP_THRESHOLDS.semanticThreshold).toBe(0.85);
    });
  });
});

describe('Cross-Path Validation: Combined Checks', () => {
  it('content that passes both voice and slop in direct path passes in API path', async () => {
    const cleanContent =
      'Found a GitHub repo with only 500 stars that solves the cold start problem for serverless functions. It pre-warms containers intelligently based on usage patterns.';

    const directVoice = await embeddingSimilarityFilter(cleanContent, {
      threshold: VOICE_THRESHOLDS.similarity,
      requireCorpus: false,
    });
    const directSlop = await detectSlop(cleanContent, {
      skipSemantic: true,
      skipVoiceContrast: true,
    });
    const directSlopScore = getSlopSeverityScore(directSlop);

    const voiceRequest = createMockRequest({
      content: cleanContent,
      threshold: VOICE_THRESHOLDS.similarity,
    });
    const voiceData = await getVoiceResponse(voiceRequest);

    const slopRequest = createMockRequest({
      content: cleanContent,
      threshold: SLOP_THRESHOLDS.maxScore,
      skipSemantic: true,
      skipVoiceContrast: true,
    });
    const slopData = await getSlopResponse(slopRequest);

    expect(voiceData.result?.pass).toBe(directVoice.passed);
    expect(slopData.result?.pass).toBe(directSlopScore < SLOP_THRESHOLDS.maxScore);
  });

  it('content that fails both voice and slop in direct path fails in API path', async () => {
    const badContent =
      "Let's dive in! #AI #coding\n1. First amazing point\n2. Second incredible point\nThis is a game changer that will revolutionize everything 🚀🔥💯";

    const directSlop = await detectSlop(badContent, {
      skipSemantic: true,
      skipVoiceContrast: true,
    });
    const directSlopScore = getSlopSeverityScore(directSlop);

    const slopRequest = createMockRequest({
      content: badContent,
      threshold: SLOP_THRESHOLDS.maxScore,
      skipSemantic: true,
      skipVoiceContrast: true,
    });
    const slopData = await getSlopResponse(slopRequest);

    expect(slopData.result?.pass).toBe(false);
    expect(directSlopScore >= SLOP_THRESHOLDS.maxScore).toBe(true);
  });
});
