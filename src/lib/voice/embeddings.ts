import { QDRANT_COLLECTION_NAMES, collectionExists } from '@/db/qdrant/connection';
import {
  search,
  countDocuments,
  SearchResult,
  DEFAULT_SIMILARITY_THRESHOLD,
} from '@/db/qdrant/embeddings';
import { generateQueryEmbedding } from '@/lib/embeddings/service';
import { getVoiceGuidelinesFromQdrant, VoiceGuidelines } from './guidelines';
import { createLogger } from '@/lib/logger';

const logger = createLogger('voice:embeddings');

export interface SimilarApprovedPost {
  id: string;
  content: string;
  postId: number;
  approvedAt: string;
  voiceScore?: number;
  similarity: number;
}

export interface GetSimilarApprovedPostsOptions {
  nResults?: number;
  threshold?: number;
}

export interface VoiceEmbeddingMatch {
  similarity: number;
  content: string;
  source: 'approved_post' | 'voice_guideline';
  metadata?: Record<string, unknown>;
}

export interface VoiceSimilarityResult {
  averageSimilarity: number;
  maxSimilarity: number;
  minSimilarity: number;
  matchCount: number;
  matches: VoiceEmbeddingMatch[];
  passesThreshold: boolean;
}

export interface VoiceEmbeddingCheckOptions {
  threshold?: number;
  nResults?: number;
  includeGuidelines?: boolean;
}

function qdrantResultToSimilarPost(result: SearchResult): SimilarApprovedPost {
  return {
    id: result.id,
    content: result.text,
    postId: (result.metadata.post_id as number) ?? 0,
    approvedAt: (result.metadata.created_at as string) ?? '',
    voiceScore: result.metadata.voice_score as number | undefined,
    similarity: result.score,
  };
}

export async function getSimilarApprovedPosts(
  draftContent: string,
  options: GetSimilarApprovedPostsOptions = {}
): Promise<SimilarApprovedPost[]> {
  const { nResults = 5, threshold = DEFAULT_SIMILARITY_THRESHOLD } = options;

  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
  if (!exists) {
    logger.debug('approved_posts collection does not exist');
    return [];
  }

  try {
    const embeddingResult = await generateQueryEmbedding(draftContent);

    const results = await search(
      QDRANT_COLLECTION_NAMES.APPROVED_POSTS,
      embeddingResult.embedding,
      {
        limit: nResults,
        scoreThreshold: threshold,
      }
    );

    return results.map(qdrantResultToSimilarPost);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Error searching approved posts', { error: errorMsg });
    return [];
  }
}

export async function countApprovedPosts(): Promise<number> {
  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
  if (!exists) {
    return 0;
  }
  return countDocuments(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
}

export async function countGoldExamples(): Promise<number> {
  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
  if (!exists) {
    return 0;
  }
  return countDocuments(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, {
    must: [{ key: 'content_type', match: { value: 'gold_example' } }],
  });
}

interface SimilarityResult {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  similarity: number;
}

async function queryVoiceGuidelines(
  queryText: string,
  nResults: number = 10
): Promise<SimilarityResult[]> {
  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
  if (!exists) {
    logger.debug('voice_guidelines collection does not exist');
    return [];
  }

  try {
    const embeddingResult = await generateQueryEmbedding(queryText);

    const results = await search(
      QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES,
      embeddingResult.embedding,
      {
        limit: nResults,
      }
    );

    return results.map((r) => ({
      id: r.id,
      content: r.text,
      metadata: r.metadata as Record<string, unknown>,
      similarity: r.score,
    }));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Error searching voice guidelines', { error: errorMsg });
    return [];
  }
}

export async function checkVoiceSimilarity(
  draftContent: string,
  options: VoiceEmbeddingCheckOptions = {}
): Promise<VoiceSimilarityResult> {
  const {
    threshold = DEFAULT_SIMILARITY_THRESHOLD,
    nResults = 10,
    includeGuidelines = true,
  } = options;

  const matches: VoiceEmbeddingMatch[] = [];

  const approvedPosts = await getSimilarApprovedPosts(draftContent, {
    nResults,
    threshold: 0,
  });

  for (const post of approvedPosts) {
    matches.push({
      similarity: post.similarity,
      content: post.content,
      source: 'approved_post',
      metadata: {
        postId: post.postId,
        approvedAt: post.approvedAt,
        voiceScore: post.voiceScore,
      },
    });
  }

  if (includeGuidelines) {
    const guidelineResults = await queryVoiceGuidelines(draftContent, nResults);

    for (const result of guidelineResults) {
      matches.push({
        similarity: result.similarity,
        content: result.content,
        source: 'voice_guideline',
        metadata: result.metadata,
      });
    }
  }

  matches.sort((a, b) => b.similarity - a.similarity);

  const topMatches = matches.slice(0, nResults);

  if (topMatches.length === 0) {
    return {
      averageSimilarity: 0,
      maxSimilarity: 0,
      minSimilarity: 0,
      matchCount: 0,
      matches: [],
      passesThreshold: false,
    };
  }

  const similarities = topMatches.map((m) => m.similarity);
  const averageSimilarity = similarities.reduce((sum, s) => sum + s, 0) / similarities.length;
  const maxSimilarity = Math.max(...similarities);
  const minSimilarity = Math.min(...similarities);

  return {
    averageSimilarity,
    maxSimilarity,
    minSimilarity,
    matchCount: topMatches.length,
    matches: topMatches,
    passesThreshold: averageSimilarity >= threshold,
  };
}

export async function getApprovedPostsForComparison(
  draftContent: string,
  count: number = 5
): Promise<SimilarApprovedPost[]> {
  return getSimilarApprovedPosts(draftContent, {
    nResults: count,
    threshold: 0,
  });
}

export async function findSimilarVoiceGuidelines(
  content: string,
  nResults: number = 5
): Promise<SimilarityResult[]> {
  return queryVoiceGuidelines(content, nResults);
}

export interface VoiceCorpusStatus {
  approvedPostsCount: number;
  hasMinimumCorpus: boolean;
  guidelinesLoaded: boolean;
}

const MINIMUM_CORPUS_SIZE = 50;

export async function getVoiceCorpusStatus(): Promise<VoiceCorpusStatus> {
  let goldExamplesCount: number;
  let guidelines: VoiceGuidelines;

  try {
    // Count gold examples specifically, not all approved posts
    goldExamplesCount = await countGoldExamples();
  } catch (err) {
    logger.error('countGoldExamples failed', { error: err });
    goldExamplesCount = 0;
  }

  try {
    guidelines = await getVoiceGuidelinesFromQdrant();
  } catch (err) {
    logger.error('getVoiceGuidelinesFromQdrant failed', { error: err });
    guidelines = { dos: [], donts: [], examples: [], rules: [], raw: '' };
  }

  const guidelinesLoaded =
    guidelines.dos.length > 0 ||
    guidelines.donts.length > 0 ||
    guidelines.rules.length > 0 ||
    guidelines.examples.length > 0;

  return {
    approvedPostsCount: goldExamplesCount,
    hasMinimumCorpus: goldExamplesCount >= MINIMUM_CORPUS_SIZE,
    guidelinesLoaded,
  };
}

export interface QuickVoiceCheckResult {
  passed: boolean;
  similarity: number;
  reason: string;
}

export async function quickVoiceCheck(
  draftContent: string,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Promise<QuickVoiceCheckResult> {
  const corpusStatus = await getVoiceCorpusStatus();

  if (!corpusStatus.hasMinimumCorpus && !corpusStatus.guidelinesLoaded) {
    return {
      passed: true,
      similarity: 0,
      reason: 'No voice corpus available for comparison',
    };
  }

  const result = await checkVoiceSimilarity(draftContent, {
    threshold,
    nResults: 5,
    includeGuidelines: corpusStatus.guidelinesLoaded,
  });

  if (result.matchCount === 0) {
    return {
      passed: false,
      similarity: 0,
      reason: 'No similar content found in voice corpus',
    };
  }

  if (result.passesThreshold) {
    return {
      passed: true,
      similarity: result.averageSimilarity,
      reason: `Voice similarity ${(result.averageSimilarity * 100).toFixed(1)}% meets threshold`,
    };
  }

  return {
    passed: false,
    similarity: result.averageSimilarity,
    reason: `Voice similarity ${(result.averageSimilarity * 100).toFixed(1)}% below ${(threshold * 100).toFixed(0)}% threshold`,
  };
}

export function formatSimilarityScore(similarity: number): string {
  return `${(similarity * 100).toFixed(1)}%`;
}

export function categorizeSimilarity(similarity: number): 'high' | 'medium' | 'low' {
  if (similarity >= 0.8) return 'high';
  if (similarity >= 0.6) return 'medium';
  return 'low';
}

export { DEFAULT_SIMILARITY_THRESHOLD };
