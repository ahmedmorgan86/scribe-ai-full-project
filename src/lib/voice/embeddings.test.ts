import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as qdrantConnection from '@/db/qdrant/connection';
import * as qdrantEmbeddings from '@/db/qdrant/embeddings';
import * as embeddingService from '@/lib/embeddings/service';
import type { EmbeddingResult } from '@/lib/embeddings/service';
import * as guidelines from './guidelines';
import type { VoiceGuidelines } from './guidelines';
import {
  getSimilarApprovedPosts,
  countApprovedPosts,
  checkVoiceSimilarity,
  getApprovedPostsForComparison,
  findSimilarVoiceGuidelines,
  getVoiceCorpusStatus,
  quickVoiceCheck,
  formatSimilarityScore,
  categorizeSimilarity,
  DEFAULT_SIMILARITY_THRESHOLD,
} from './embeddings';

vi.mock('@/db/qdrant/connection');
vi.mock('@/db/qdrant/embeddings');
vi.mock('@/lib/embeddings/service');
vi.mock('./guidelines');

function mockEmbeddingResult(embedding: number[]): EmbeddingResult {
  return { embedding, tokens: 10 };
}

function mockVoiceGuidelines(overrides: Partial<VoiceGuidelines> = {}): VoiceGuidelines {
  return {
    dos: [],
    donts: [],
    rules: [],
    examples: [],
    raw: '',
    ...overrides,
  };
}

describe('Voice Matching with Qdrant', () => {
  const mockEmbedding: number[] = Array.from({ length: 1536 }, () => 0.1);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getSimilarApprovedPosts', () => {
    it('returns empty array when collection does not exist', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(false);

      const results = await getSimilarApprovedPosts('test content');

      expect(results).toEqual([]);
      expect(qdrantConnection.collectionExists).toHaveBeenCalledWith('approved_posts');
    });

    it('returns transformed posts when collection exists', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([
        {
          id: 'post-1',
          text: 'Sample approved post content',
          metadata: {
            post_id: 123,
            created_at: '2025-01-15T00:00:00Z',
            voice_score: 0.85,
          },
          score: 0.92,
        },
        {
          id: 'post-2',
          text: 'Another approved post',
          metadata: {
            post_id: 456,
            created_at: '2025-01-14T00:00:00Z',
            voice_score: 0.78,
          },
          score: 0.81,
        },
      ]);

      const results = await getSimilarApprovedPosts('test content');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: 'post-1',
        content: 'Sample approved post content',
        postId: 123,
        approvedAt: '2025-01-15T00:00:00Z',
        voiceScore: 0.85,
        similarity: 0.92,
      });
      expect(results[1]).toEqual({
        id: 'post-2',
        content: 'Another approved post',
        postId: 456,
        approvedAt: '2025-01-14T00:00:00Z',
        voiceScore: 0.78,
        similarity: 0.81,
      });
    });

    it('passes nResults and threshold options to search', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([]);

      await getSimilarApprovedPosts('test', { nResults: 10, threshold: 0.8 });

      expect(qdrantEmbeddings.search).toHaveBeenCalledWith('approved_posts', mockEmbedding, {
        limit: 10,
        scoreThreshold: 0.8,
      });
    });

    it('uses default options when none provided', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([]);

      await getSimilarApprovedPosts('test');

      expect(qdrantEmbeddings.search).toHaveBeenCalledWith('approved_posts', mockEmbedding, {
        limit: 5,
        scoreThreshold: DEFAULT_SIMILARITY_THRESHOLD,
      });
    });

    it('handles missing metadata gracefully', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([
        {
          id: 'post-1',
          text: 'Content without metadata',
          metadata: {},
          score: 0.75,
        },
      ]);

      const results = await getSimilarApprovedPosts('test');

      expect(results[0].postId).toBe(0);
      expect(results[0].approvedAt).toBe('');
      expect(results[0].voiceScore).toBeUndefined();
    });

    it('returns empty array on embedding generation error', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockRejectedValue(
        new Error('API rate limit')
      );

      const results = await getSimilarApprovedPosts('test');

      expect(results).toEqual([]);
    });

    it('returns empty array on search error', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockRejectedValue(new Error('Connection timeout'));

      const results = await getSimilarApprovedPosts('test');

      expect(results).toEqual([]);
    });
  });

  describe('countApprovedPosts', () => {
    it('returns 0 when collection does not exist', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(false);

      const count = await countApprovedPosts();

      expect(count).toBe(0);
    });

    it('returns count from Qdrant when collection exists', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(150);

      const count = await countApprovedPosts();

      expect(count).toBe(150);
      expect(qdrantEmbeddings.countDocuments).toHaveBeenCalledWith('approved_posts');
    });
  });

  describe('checkVoiceSimilarity', () => {
    const mockApprovedPostResults = [
      {
        id: 'post-1',
        text: 'Approved post 1',
        metadata: { post_id: 1, created_at: '2025-01-15', voice_score: 0.9 },
        score: 0.85,
      },
      {
        id: 'post-2',
        text: 'Approved post 2',
        metadata: { post_id: 2, created_at: '2025-01-14', voice_score: 0.8 },
        score: 0.75,
      },
    ];

    const mockGuidelineResults = [
      {
        id: 'guide-1',
        text: 'Voice guideline 1',
        metadata: { guideline_type: 'do', category: 'tone' },
        score: 0.8,
      },
    ];

    it('combines approved posts and guidelines in results', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce(mockApprovedPostResults)
        .mockResolvedValueOnce(mockGuidelineResults);

      const result = await checkVoiceSimilarity('test content', { includeGuidelines: true });

      expect(result.matchCount).toBeGreaterThan(0);
      const sources = result.matches.map((m) => m.source);
      expect(sources).toContain('approved_post');
      expect(sources).toContain('voice_guideline');
    });

    it('excludes guidelines when includeGuidelines is false', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue(mockApprovedPostResults);

      const result = await checkVoiceSimilarity('test content', { includeGuidelines: false });

      const sources = result.matches.map((m) => m.source);
      expect(sources).not.toContain('voice_guideline');
    });

    it('calculates average, max, and min similarity correctly', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce([
          { id: '1', text: 'Post 1', metadata: {}, score: 0.9 },
          { id: '2', text: 'Post 2', metadata: {}, score: 0.8 },
          { id: '3', text: 'Post 3', metadata: {}, score: 0.7 },
        ])
        .mockResolvedValueOnce([]);

      const result = await checkVoiceSimilarity('test', { includeGuidelines: false, nResults: 3 });

      expect(result.maxSimilarity).toBe(0.9);
      expect(result.minSimilarity).toBe(0.7);
      expect(result.averageSimilarity).toBeCloseTo(0.8, 2);
    });

    it('returns passesThreshold true when average meets threshold', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce([
          { id: '1', text: 'Post 1', metadata: {}, score: 0.85 },
          { id: '2', text: 'Post 2', metadata: {}, score: 0.75 },
        ])
        .mockResolvedValueOnce([]);

      const result = await checkVoiceSimilarity('test', {
        threshold: 0.7,
        includeGuidelines: false,
      });

      expect(result.passesThreshold).toBe(true);
    });

    it('returns passesThreshold false when average below threshold', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce([
          { id: '1', text: 'Post 1', metadata: {}, score: 0.5 },
          { id: '2', text: 'Post 2', metadata: {}, score: 0.4 },
        ])
        .mockResolvedValueOnce([]);

      const result = await checkVoiceSimilarity('test', {
        threshold: 0.7,
        includeGuidelines: false,
      });

      expect(result.passesThreshold).toBe(false);
    });

    it('returns zero values when no matches found', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([]);

      const result = await checkVoiceSimilarity('test', { includeGuidelines: false });

      expect(result.averageSimilarity).toBe(0);
      expect(result.maxSimilarity).toBe(0);
      expect(result.minSimilarity).toBe(0);
      expect(result.matchCount).toBe(0);
      expect(result.passesThreshold).toBe(false);
    });

    it('sorts matches by similarity descending', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce([
          { id: '1', text: 'Low score', metadata: {}, score: 0.5 },
          { id: '2', text: 'High score', metadata: {}, score: 0.9 },
        ])
        .mockResolvedValueOnce([{ id: '3', text: 'Medium score', metadata: {}, score: 0.7 }]);

      const result = await checkVoiceSimilarity('test', { includeGuidelines: true });

      expect(result.matches[0].similarity).toBe(0.9);
      expect(result.matches[1].similarity).toBe(0.7);
      expect(result.matches[2].similarity).toBe(0.5);
    });

    it('limits results to nResults parameter', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce([
          { id: '1', text: 'Post 1', metadata: {}, score: 0.9 },
          { id: '2', text: 'Post 2', metadata: {}, score: 0.85 },
          { id: '3', text: 'Post 3', metadata: {}, score: 0.8 },
          { id: '4', text: 'Post 4', metadata: {}, score: 0.75 },
          { id: '5', text: 'Post 5', metadata: {}, score: 0.7 },
        ])
        .mockResolvedValueOnce([{ id: '6', text: 'Guide 1', metadata: {}, score: 0.88 }]);

      const result = await checkVoiceSimilarity('test', { nResults: 3, includeGuidelines: true });

      expect(result.matches.length).toBe(3);
    });
  });

  describe('getApprovedPostsForComparison', () => {
    it('calls getSimilarApprovedPosts with zero threshold', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([]);

      await getApprovedPostsForComparison('test content', 10);

      expect(qdrantEmbeddings.search).toHaveBeenCalledWith('approved_posts', mockEmbedding, {
        limit: 10,
        scoreThreshold: 0,
      });
    });
  });

  describe('findSimilarVoiceGuidelines', () => {
    it('returns empty array when collection does not exist', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(false);

      const results = await findSimilarVoiceGuidelines('test content');

      expect(results).toEqual([]);
    });

    it('returns transformed guidelines when collection exists', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([
        {
          id: 'guide-1',
          text: 'Use clear language',
          metadata: { guideline_type: 'do' },
          score: 0.88,
        },
      ]);

      const results = await findSimilarVoiceGuidelines('test content');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: 'guide-1',
        content: 'Use clear language',
        metadata: { guideline_type: 'do' },
        similarity: 0.88,
      });
    });
  });

  describe('getVoiceCorpusStatus', () => {
    it('returns correct status with sufficient corpus', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(100);
      vi.mocked(guidelines.getVoiceGuidelinesFromQdrant).mockResolvedValue(
        mockVoiceGuidelines({ dos: ['Do this'], donts: ['Dont do this'] })
      );

      const status = await getVoiceCorpusStatus();

      expect(status.approvedPostsCount).toBe(100);
      expect(status.hasMinimumCorpus).toBe(true);
      expect(status.guidelinesLoaded).toBe(true);
    });

    it('returns hasMinimumCorpus false when below 50 posts', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(30);
      vi.mocked(guidelines.getVoiceGuidelinesFromQdrant).mockResolvedValue(mockVoiceGuidelines());

      const status = await getVoiceCorpusStatus();

      expect(status.hasMinimumCorpus).toBe(false);
    });

    it('returns guidelinesLoaded true when any guideline type has content', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(0);
      vi.mocked(guidelines.getVoiceGuidelinesFromQdrant).mockResolvedValue(
        mockVoiceGuidelines({ rules: ['Rule 1'] })
      );

      const status = await getVoiceCorpusStatus();

      expect(status.guidelinesLoaded).toBe(true);
    });

    it('returns guidelinesLoaded false when all arrays empty', async () => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(0);
      vi.mocked(guidelines.getVoiceGuidelinesFromQdrant).mockResolvedValue(mockVoiceGuidelines());

      const status = await getVoiceCorpusStatus();

      expect(status.guidelinesLoaded).toBe(false);
    });
  });

  describe('quickVoiceCheck', () => {
    beforeEach(() => {
      vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
    });

    it('returns passed true when no corpus available', async () => {
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(0);
      vi.mocked(guidelines.getVoiceGuidelinesFromQdrant).mockResolvedValue(mockVoiceGuidelines());

      const result = await quickVoiceCheck('test content');

      expect(result.passed).toBe(true);
      expect(result.similarity).toBe(0);
      expect(result.reason).toContain('No voice corpus available');
    });

    it('returns passed true when similarity meets threshold', async () => {
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(100);
      vi.mocked(guidelines.getVoiceGuidelinesFromQdrant).mockResolvedValue(
        mockVoiceGuidelines({ dos: ['Do this'] })
      );
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce([{ id: '1', text: 'Post', metadata: {}, score: 0.85 }])
        .mockResolvedValueOnce([{ id: '2', text: 'Guide', metadata: {}, score: 0.8 }]);

      const result = await quickVoiceCheck('test content', 0.7);

      expect(result.passed).toBe(true);
      expect(result.similarity).toBeGreaterThan(0.7);
      expect(result.reason).toContain('meets threshold');
    });

    it('returns passed false when similarity below threshold', async () => {
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(100);
      vi.mocked(guidelines.getVoiceGuidelinesFromQdrant).mockResolvedValue(
        mockVoiceGuidelines({ dos: ['Do this'] })
      );
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce([{ id: '1', text: 'Post', metadata: {}, score: 0.5 }])
        .mockResolvedValueOnce([{ id: '2', text: 'Guide', metadata: {}, score: 0.4 }]);

      const result = await quickVoiceCheck('test content', 0.7);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('below');
    });

    it('returns passed false when no matches found', async () => {
      vi.mocked(qdrantEmbeddings.countDocuments).mockResolvedValue(100);
      vi.mocked(guidelines.getVoiceGuidelinesFromQdrant).mockResolvedValue(mockVoiceGuidelines());
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([]);

      const result = await quickVoiceCheck('test content');

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('No similar content found');
    });
  });

  describe('formatSimilarityScore', () => {
    it('formats similarity as percentage with one decimal', () => {
      expect(formatSimilarityScore(0.856)).toBe('85.6%');
      expect(formatSimilarityScore(0.7)).toBe('70.0%');
      expect(formatSimilarityScore(1.0)).toBe('100.0%');
      expect(formatSimilarityScore(0.0)).toBe('0.0%');
    });
  });

  describe('categorizeSimilarity', () => {
    it('returns high for scores >= 0.8', () => {
      expect(categorizeSimilarity(0.8)).toBe('high');
      expect(categorizeSimilarity(0.95)).toBe('high');
      expect(categorizeSimilarity(1.0)).toBe('high');
    });

    it('returns medium for scores >= 0.6 and < 0.8', () => {
      expect(categorizeSimilarity(0.6)).toBe('medium');
      expect(categorizeSimilarity(0.7)).toBe('medium');
      expect(categorizeSimilarity(0.79)).toBe('medium');
    });

    it('returns low for scores < 0.6', () => {
      expect(categorizeSimilarity(0.5)).toBe('low');
      expect(categorizeSimilarity(0.3)).toBe('low');
      expect(categorizeSimilarity(0.0)).toBe('low');
    });
  });

  describe('DEFAULT_SIMILARITY_THRESHOLD', () => {
    it('exports default threshold of 0.7', () => {
      expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.7);
    });
  });
});

describe('Voice Matching Quality Validation', () => {
  const mockEmbedding: number[] = Array.from({ length: 1536 }, () => 0.1);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(qdrantConnection.collectionExists).mockResolvedValue(true);
  });

  describe('search result ordering', () => {
    it('returns results in descending similarity order', async () => {
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([
        { id: '1', text: 'Most similar', metadata: { post_id: 1 }, score: 0.95 },
        { id: '2', text: 'Second most', metadata: { post_id: 2 }, score: 0.85 },
        { id: '3', text: 'Third', metadata: { post_id: 3 }, score: 0.75 },
      ]);

      const results = await getSimilarApprovedPosts('query', { nResults: 5, threshold: 0 });

      expect(results[0].similarity).toBe(0.95);
      expect(results[1].similarity).toBe(0.85);
      expect(results[2].similarity).toBe(0.75);
    });
  });

  describe('threshold filtering', () => {
    it('only returns results above threshold', async () => {
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([
        { id: '1', text: 'Above threshold', metadata: { post_id: 1 }, score: 0.85 },
        { id: '2', text: 'Above threshold', metadata: { post_id: 2 }, score: 0.75 },
      ]);

      const results = await getSimilarApprovedPosts('query', { threshold: 0.7 });

      expect(results.every((r) => r.similarity >= 0.7)).toBe(true);
    });
  });

  describe('metadata preservation', () => {
    it('preserves all metadata fields from Qdrant results', async () => {
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search).mockResolvedValue([
        {
          id: 'unique-id-123',
          text: 'Original post content',
          metadata: {
            post_id: 42,
            created_at: '2025-01-15T12:00:00Z',
            voice_score: 0.92,
            content_type: 'tweet',
            is_exceptional: true,
          },
          score: 0.88,
        },
      ]);

      const results = await getSimilarApprovedPosts('query');

      expect(results[0].id).toBe('unique-id-123');
      expect(results[0].content).toBe('Original post content');
      expect(results[0].postId).toBe(42);
      expect(results[0].approvedAt).toBe('2025-01-15T12:00:00Z');
      expect(results[0].voiceScore).toBe(0.92);
    });
  });

  describe('mixed source handling', () => {
    it('correctly tags approved posts vs voice guidelines', async () => {
      vi.mocked(embeddingService.generateQueryEmbedding).mockResolvedValue(
        mockEmbeddingResult(mockEmbedding)
      );
      vi.mocked(qdrantEmbeddings.search)
        .mockResolvedValueOnce([
          {
            id: 'post-1',
            text: 'Approved post content',
            metadata: { post_id: 1 },
            score: 0.9,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'guide-1',
            text: 'Voice guideline content',
            metadata: { guideline_type: 'do' },
            score: 0.85,
          },
        ]);

      const result = await checkVoiceSimilarity('test', { includeGuidelines: true });

      const approvedPostMatch = result.matches.find((m) => m.source === 'approved_post');
      const guidelineMatch = result.matches.find((m) => m.source === 'voice_guideline');

      expect(approvedPostMatch).toBeDefined();
      expect(guidelineMatch).toBeDefined();
      expect(approvedPostMatch?.content).toBe('Approved post content');
      expect(guidelineMatch?.content).toBe('Voice guideline content');
    });
  });
});
