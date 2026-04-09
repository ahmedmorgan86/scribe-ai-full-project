import { QDRANT_COLLECTION_NAMES } from '@/db/qdrant/connection';
import { hybridSearch, addDocument, search, SearchResult } from '@/db/qdrant/embeddings';
import { generateEmbedding, generateQueryEmbedding } from '@/lib/embeddings/service';
import { textToSparseVector } from '@/db/qdrant/sparse-vectors';
import { createLogger } from '@/lib/logger';
import type { SourceType, SourceMetadata } from '@/types';

const logger = createLogger('sources:deduplication');

export const SOURCE_SIMILARITY_THRESHOLD = 0.85;

export interface SourceDeduplicationMatch {
  sourceId: string;
  text: string;
  similarity: number;
  sourceType: string;
  accountHandle?: string;
}

export interface SourceDeduplicationResult {
  isDuplicate: boolean;
  highestSimilarity: number;
  matches: SourceDeduplicationMatch[];
}

export interface HybridDeduplicationOptions {
  threshold?: number;
  maxResults?: number;
  sourceType?: SourceType;
  excludeSourceId?: string;
}

const DEFAULT_OPTIONS: Required<
  Omit<HybridDeduplicationOptions, 'sourceType' | 'excludeSourceId'>
> = {
  threshold: SOURCE_SIMILARITY_THRESHOLD,
  maxResults: 5,
};

function mapSearchResultToMatch(result: SearchResult): SourceDeduplicationMatch {
  return {
    sourceId: result.id,
    text: result.text,
    similarity: result.score,
    sourceType: (result.metadata.source_type as string) ?? 'unknown',
    accountHandle: (result.metadata.account_handle as string) ?? undefined,
  };
}

export async function checkSourceDuplicateHybrid(
  content: string,
  options: HybridDeduplicationOptions = {}
): Promise<SourceDeduplicationResult> {
  const { threshold = DEFAULT_OPTIONS.threshold, maxResults = DEFAULT_OPTIONS.maxResults } =
    options;

  try {
    const [embeddingResult, sparseVector] = await Promise.all([
      generateQueryEmbedding(content),
      Promise.resolve(textToSparseVector(content)),
    ]);

    const filter: {
      must?: Array<{ key: string; match: { value: string | number | boolean } }>;
      must_not?: Array<{ key: string; match: { value: string | number | boolean } }>;
    } = {};

    if (options.sourceType) {
      filter.must = [{ key: 'source_type', match: { value: options.sourceType } }];
    }

    if (options.excludeSourceId) {
      filter.must_not = [{ key: 'source_id', match: { value: options.excludeSourceId } }];
    }

    const searchResults = await hybridSearch(
      QDRANT_COLLECTION_NAMES.SOURCES,
      embeddingResult.embedding,
      sparseVector,
      {
        limit: maxResults,
        scoreThreshold: threshold,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      }
    );

    const matches = searchResults.map(mapSearchResultToMatch);
    const highestSimilarity = matches.length > 0 ? matches[0].similarity : 0;
    const isDuplicate = highestSimilarity >= threshold;

    if (isDuplicate) {
      logger.debug(`Found duplicate source content`, {
        similarity: highestSimilarity,
        matchCount: matches.length,
      });
    }

    return {
      isDuplicate,
      highestSimilarity,
      matches,
    };
  } catch (error) {
    logger.warn(`Hybrid deduplication check failed, falling back to no duplicate`, { error });
    return {
      isDuplicate: false,
      highestSimilarity: 0,
      matches: [],
    };
  }
}

export async function checkSourceDuplicateSemantic(
  content: string,
  options: HybridDeduplicationOptions = {}
): Promise<SourceDeduplicationResult> {
  const { threshold = DEFAULT_OPTIONS.threshold, maxResults = DEFAULT_OPTIONS.maxResults } =
    options;

  try {
    const embeddingResult = await generateQueryEmbedding(content);

    const filter: {
      must?: Array<{ key: string; match: { value: string | number | boolean } }>;
      must_not?: Array<{ key: string; match: { value: string | number | boolean } }>;
    } = {};

    if (options.sourceType) {
      filter.must = [{ key: 'source_type', match: { value: options.sourceType } }];
    }

    if (options.excludeSourceId) {
      filter.must_not = [{ key: 'source_id', match: { value: options.excludeSourceId } }];
    }

    const searchResults = await search(QDRANT_COLLECTION_NAMES.SOURCES, embeddingResult.embedding, {
      limit: maxResults,
      scoreThreshold: threshold,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });

    const matches = searchResults.map(mapSearchResultToMatch);
    const highestSimilarity = matches.length > 0 ? matches[0].similarity : 0;
    const isDuplicate = highestSimilarity >= threshold;

    return {
      isDuplicate,
      highestSimilarity,
      matches,
    };
  } catch (error) {
    logger.warn(`Semantic deduplication check failed, falling back to no duplicate`, { error });
    return {
      isDuplicate: false,
      highestSimilarity: 0,
      matches: [],
    };
  }
}

export async function addSourceToQdrant(
  sourceId: string,
  content: string,
  sourceType: SourceType,
  metadata?: SourceMetadata
): Promise<void> {
  try {
    const [embeddingResult, sparseVector] = await Promise.all([
      generateEmbedding(content),
      Promise.resolve(textToSparseVector(content)),
    ]);

    const documentMetadata: Record<string, string | number | boolean | null> = {
      source_id: sourceId,
      source_type: sourceType,
      scraped_at: new Date().toISOString(),
    };

    if (metadata?.authorHandle) {
      documentMetadata.account_handle = metadata.authorHandle;
    }
    if (metadata?.authorName) {
      documentMetadata.author_name = metadata.authorName;
    }
    if (metadata?.url) {
      documentMetadata.url = metadata.url;
    }

    await addDocument(
      QDRANT_COLLECTION_NAMES.SOURCES,
      sourceId,
      content,
      embeddingResult.embedding,
      documentMetadata,
      sparseVector
    );

    logger.debug(`Added source to Qdrant`, { sourceId, sourceType });
  } catch (error) {
    logger.error(`Failed to add source to Qdrant`, { sourceId, error });
    throw error;
  }
}

export interface SourceInsertWithDeduplicationResult {
  inserted: boolean;
  isDuplicate: boolean;
  duplicateMatch?: SourceDeduplicationMatch;
  addedToQdrant: boolean;
}

export async function checkAndAddSourceToQdrant(
  sourceId: string,
  content: string,
  sourceType: SourceType,
  metadata?: SourceMetadata,
  options: HybridDeduplicationOptions = {}
): Promise<SourceInsertWithDeduplicationResult> {
  const deduplicationResult = await checkSourceDuplicateHybrid(content, {
    ...options,
    excludeSourceId: sourceId,
  });

  if (deduplicationResult.isDuplicate) {
    return {
      inserted: false,
      isDuplicate: true,
      duplicateMatch: deduplicationResult.matches[0],
      addedToQdrant: false,
    };
  }

  try {
    await addSourceToQdrant(sourceId, content, sourceType, metadata);
    return {
      inserted: true,
      isDuplicate: false,
      addedToQdrant: true,
    };
  } catch (error) {
    logger.error(`Failed to add source to Qdrant after deduplication check`, { sourceId, error });
    return {
      inserted: true,
      isDuplicate: false,
      addedToQdrant: false,
    };
  }
}

export async function findSimilarSources(
  content: string,
  options: HybridDeduplicationOptions = {}
): Promise<SourceDeduplicationMatch[]> {
  const { maxResults = 10 } = options;

  try {
    const [embeddingResult, sparseVector] = await Promise.all([
      generateQueryEmbedding(content),
      Promise.resolve(textToSparseVector(content)),
    ]);

    const filter: {
      must?: Array<{ key: string; match: { value: string | number | boolean } }>;
    } = {};

    if (options.sourceType) {
      filter.must = [{ key: 'source_type', match: { value: options.sourceType } }];
    }

    const searchResults = await hybridSearch(
      QDRANT_COLLECTION_NAMES.SOURCES,
      embeddingResult.embedding,
      sparseVector,
      {
        limit: maxResults,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      }
    );

    return searchResults.map(mapSearchResultToMatch);
  } catch (error) {
    logger.warn(`Failed to find similar sources`, { error });
    return [];
  }
}
