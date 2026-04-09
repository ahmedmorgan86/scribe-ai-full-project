import { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import { getQdrantClient, QdrantCollectionName, collectionExists } from './connection';
import { executeWithQdrantRetry } from './retry';
import { createLogger } from '@/lib/logger';

const logger = createLogger('qdrant:embeddings');

export interface DocumentMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface EmbeddingDocument {
  id: string;
  text: string;
  metadata?: DocumentMetadata;
}

export interface SearchResult {
  id: string;
  text: string;
  metadata: DocumentMetadata;
  score: number;
}

export interface SearchFilter {
  must?: FilterCondition[];
  should?: FilterCondition[];
  must_not?: FilterCondition[];
}

export interface FilterCondition {
  key: string;
  match?: { value: string | number | boolean };
  range?: { gte?: number; lte?: number; gt?: number; lt?: number };
}

export interface SearchOptions {
  limit?: number;
  filter?: SearchFilter;
  scoreThreshold?: number;
}

export interface HybridSearchOptions extends SearchOptions {
  fusionType?: 'rrf' | 'dbsf';
}

export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

function buildQdrantFilter(filter: SearchFilter): Schemas['Filter'] {
  const conditions: Schemas['Filter'] = {};

  if (filter.must && filter.must.length > 0) {
    conditions.must = filter.must.map(conditionToQdrant);
  }
  if (filter.should && filter.should.length > 0) {
    conditions.should = filter.should.map(conditionToQdrant);
  }
  if (filter.must_not && filter.must_not.length > 0) {
    conditions.must_not = filter.must_not.map(conditionToQdrant);
  }

  return conditions;
}

function conditionToQdrant(cond: FilterCondition): Schemas['Condition'] {
  if (cond.match) {
    return {
      key: cond.key,
      match: { value: cond.match.value },
    };
  }
  if (cond.range) {
    return {
      key: cond.key,
      range: cond.range,
    };
  }
  throw new Error(`Invalid filter condition for key: ${cond.key}`);
}

function extractTextFromPayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return '';
  return (payload.text as string) ?? '';
}

function extractMetadataFromPayload(
  payload: Record<string, unknown> | null | undefined
): DocumentMetadata {
  if (!payload) return {};
  const { text: _text, sparse_indices: _si, sparse_values: _sv, ...rest } = payload;
  const metadata: DocumentMetadata = {};
  for (const [key, value] of Object.entries(rest)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      metadata[key] = value;
    }
  }
  return metadata;
}

export async function addDocument(
  collection: QdrantCollectionName,
  id: string,
  text: string,
  embedding: number[],
  metadata?: DocumentMetadata,
  sparseVector?: { indices: number[]; values: number[] },
  client?: QdrantClient
): Promise<void> {
  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    throw new Error(`Collection ${collection} does not exist`);
  }

  const payload: Record<string, unknown> = {
    text,
    ...metadata,
  };

  const point: Schemas['PointStruct'] = {
    id,
    vector: sparseVector
      ? {
          dense: embedding,
          sparse: sparseVector,
        }
      : {
          dense: embedding,
        },
    payload,
  };

  await executeWithQdrantRetry(
    () =>
      qdrant.upsert(collection, {
        points: [point],
        wait: true,
      }),
    `addDocument:${collection}:${id}`
  );

  logger.debug(`Added document ${id} to ${collection}`);
}

export async function addDocumentsBatch(
  collection: QdrantCollectionName,
  documents: Array<{
    id: string;
    text: string;
    embedding: number[];
    metadata?: DocumentMetadata;
    sparseVector?: { indices: number[]; values: number[] };
  }>,
  client?: QdrantClient
): Promise<void> {
  if (documents.length === 0) return;

  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    throw new Error(`Collection ${collection} does not exist`);
  }

  const points: Schemas['PointStruct'][] = documents.map((doc) => ({
    id: doc.id,
    vector: doc.sparseVector
      ? {
          dense: doc.embedding,
          sparse: doc.sparseVector,
        }
      : {
          dense: doc.embedding,
        },
    payload: {
      text: doc.text,
      ...doc.metadata,
    },
  }));

  await executeWithQdrantRetry(
    () =>
      qdrant.upsert(collection, {
        points,
        wait: true,
      }),
    `addDocumentsBatch:${collection}:${documents.length}`
  );

  logger.debug(`Added ${documents.length} documents to ${collection}`);
}

export async function search(
  collection: QdrantCollectionName,
  embedding: number[],
  options: SearchOptions = {},
  client?: QdrantClient
): Promise<SearchResult[]> {
  const qdrant = client ?? getQdrantClient();
  const { limit = DEFAULT_SEARCH_LIMIT, filter, scoreThreshold } = options;

  const exists = await collectionExists(collection);
  if (!exists) {
    logger.warn(`Collection ${collection} does not exist, returning empty results`);
    return [];
  }

  const searchParams: Schemas['SearchRequest'] = {
    vector: {
      name: 'dense',
      vector: embedding,
    },
    limit,
    with_payload: true,
    score_threshold: scoreThreshold,
  };

  if (filter) {
    searchParams.filter = buildQdrantFilter(filter);
  }

  const results = await executeWithQdrantRetry(
    () => qdrant.search(collection, searchParams),
    `search:${collection}`
  );

  return results.map((result) => ({
    id: String(result.id),
    text: extractTextFromPayload(result.payload),
    metadata: extractMetadataFromPayload(result.payload),
    score: result.score,
  }));
}

export async function hybridSearch(
  collection: QdrantCollectionName,
  embedding: number[],
  sparseVector: { indices: number[]; values: number[] },
  options: HybridSearchOptions = {},
  client?: QdrantClient
): Promise<SearchResult[]> {
  const qdrant = client ?? getQdrantClient();
  const { limit = DEFAULT_SEARCH_LIMIT, filter, scoreThreshold, fusionType = 'rrf' } = options;

  const exists = await collectionExists(collection);
  if (!exists) {
    logger.warn(`Collection ${collection} does not exist, returning empty results`);
    return [];
  }

  const prefetch: Schemas['Prefetch'][] = [
    {
      query: {
        name: 'dense',
        vector: embedding,
      },
      limit: limit * 2,
    },
    {
      query: {
        name: 'sparse',
        vector: sparseVector,
      },
      limit: limit * 2,
    },
  ];

  const queryParams: Schemas['QueryRequest'] = {
    prefetch,
    query: { fusion: fusionType === 'rrf' ? 'rrf' : 'dbsf' },
    limit,
    with_payload: true,
    score_threshold: scoreThreshold,
  };

  if (filter) {
    queryParams.filter = buildQdrantFilter(filter);
  }

  const results = await executeWithQdrantRetry(
    () => qdrant.query(collection, queryParams),
    `hybridSearch:${collection}`
  );

  return results.points.map((result) => ({
    id: String(result.id),
    text: extractTextFromPayload(result.payload),
    metadata: extractMetadataFromPayload(result.payload),
    score: result.score ?? 0,
  }));
}

export async function deleteDocument(
  collection: QdrantCollectionName,
  id: string,
  client?: QdrantClient
): Promise<void> {
  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    logger.warn(`Collection ${collection} does not exist`);
    return;
  }

  await executeWithQdrantRetry(
    () =>
      qdrant.delete(collection, {
        points: [id],
        wait: true,
      }),
    `deleteDocument:${collection}:${id}`
  );

  logger.debug(`Deleted document ${id} from ${collection}`);
}

export async function deleteDocumentsBatch(
  collection: QdrantCollectionName,
  ids: string[],
  client?: QdrantClient
): Promise<void> {
  if (ids.length === 0) return;

  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    logger.warn(`Collection ${collection} does not exist`);
    return;
  }

  await executeWithQdrantRetry(
    () =>
      qdrant.delete(collection, {
        points: ids,
        wait: true,
      }),
    `deleteDocumentsBatch:${collection}:${ids.length}`
  );

  logger.debug(`Deleted ${ids.length} documents from ${collection}`);
}

export async function deleteByFilter(
  collection: QdrantCollectionName,
  filter: SearchFilter,
  client?: QdrantClient
): Promise<void> {
  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    logger.warn(`Collection ${collection} does not exist`);
    return;
  }

  await executeWithQdrantRetry(
    () =>
      qdrant.delete(collection, {
        filter: buildQdrantFilter(filter),
        wait: true,
      }),
    `deleteByFilter:${collection}`
  );

  logger.debug(`Deleted documents by filter from ${collection}`);
}

export async function getDocument(
  collection: QdrantCollectionName,
  id: string,
  client?: QdrantClient
): Promise<EmbeddingDocument | null> {
  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    return null;
  }

  const results = await executeWithQdrantRetry(
    () =>
      qdrant.retrieve(collection, {
        ids: [id],
        with_payload: true,
      }),
    `getDocument:${collection}:${id}`
  );

  if (results.length === 0) {
    return null;
  }

  const point = results[0];
  return {
    id: String(point.id),
    text: extractTextFromPayload(point.payload),
    metadata: extractMetadataFromPayload(point.payload),
  };
}

export async function getDocuments(
  collection: QdrantCollectionName,
  ids: string[],
  client?: QdrantClient
): Promise<EmbeddingDocument[]> {
  if (ids.length === 0) return [];

  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    return [];
  }

  const results = await qdrant.retrieve(collection, {
    ids,
    with_payload: true,
  });

  return results.map((point) => ({
    id: String(point.id),
    text: extractTextFromPayload(point.payload),
    metadata: extractMetadataFromPayload(point.payload),
  }));
}

export async function countDocuments(
  collection: QdrantCollectionName,
  filter?: SearchFilter,
  client?: QdrantClient
): Promise<number> {
  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    return 0;
  }

  const countParams: Parameters<QdrantClient['count']>[1] = {
    exact: true,
  };

  if (filter) {
    countParams.filter = buildQdrantFilter(filter);
  }

  const result = await qdrant.count(collection, countParams);
  return result.count;
}

export async function updateDocumentMetadata(
  collection: QdrantCollectionName,
  id: string,
  metadata: DocumentMetadata,
  client?: QdrantClient
): Promise<void> {
  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collection);
  if (!exists) {
    throw new Error(`Collection ${collection} does not exist`);
  }

  await qdrant.setPayload(collection, {
    points: [id],
    payload: metadata as Record<string, unknown>,
    wait: true,
  });

  logger.debug(`Updated metadata for document ${id} in ${collection}`);
}

export async function similaritySearch(
  collection: QdrantCollectionName,
  embedding: number[],
  options: SearchOptions = {},
  client?: QdrantClient
): Promise<SearchResult[]> {
  const threshold = options.scoreThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  return search(collection, embedding, { ...options, scoreThreshold: threshold }, client);
}

export async function hybridSimilaritySearch(
  collection: QdrantCollectionName,
  embedding: number[],
  sparseVector: { indices: number[]; values: number[] },
  options: HybridSearchOptions = {},
  client?: QdrantClient
): Promise<SearchResult[]> {
  const threshold = options.scoreThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  return hybridSearch(
    collection,
    embedding,
    sparseVector,
    { ...options, scoreThreshold: threshold },
    client
  );
}
