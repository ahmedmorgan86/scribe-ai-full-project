import { QdrantClient } from '@qdrant/js-client-rest';
import { getQdrantClient, QDRANT_COLLECTION_NAMES, collectionExists } from './connection';
import { createLogger } from '@/lib/logger';

const logger = createLogger('qdrant:collections');

interface CreateCollectionOptions {
  collectionName: string;
  vectorSize: number;
  config: CollectionConfig;
  payloadIndexes: Array<{ field_name: string; field_schema: 'keyword' | 'integer' | 'datetime' }>;
}

async function createCollectionWithFallback(
  qdrant: QdrantClient,
  options: CreateCollectionOptions
): Promise<void> {
  const { collectionName, vectorSize, config, payloadIndexes } = options;

  const baseVectors = {
    dense: {
      size: vectorSize,
      distance: 'Cosine' as const,
      on_disk: config.onDiskPayload ?? false,
    },
  };

  const sparseConfig = config.enableHybridSearch
    ? {
        sparse: {
          modifier: 'idf' as const,
        },
      }
    : undefined;

  const quantizationConfig =
    config.quantization === 'scalar'
      ? { scalar: { type: 'int8' as const, quantile: 0.99, always_ram: true } }
      : config.quantization === 'binary'
        ? { binary: { always_ram: true } }
        : undefined;

  // Try with full config first (sparse vectors + quantization)
  try {
    await qdrant.createCollection(collectionName, {
      vectors: baseVectors,
      sparse_vectors: sparseConfig,
      on_disk_payload: config.onDiskPayload,
      quantization_config: quantizationConfig,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to create collection ${collectionName} with full config: ${errMsg}`);

    // Fallback 1: Try without quantization
    if (quantizationConfig) {
      try {
        logger.info(`Retrying ${collectionName} without quantization...`);
        await qdrant.createCollection(collectionName, {
          vectors: baseVectors,
          sparse_vectors: sparseConfig,
          on_disk_payload: config.onDiskPayload,
        });
        logger.info(`Collection ${collectionName} created without quantization`);
      } catch (error2) {
        const errMsg2 = error2 instanceof Error ? error2.message : String(error2);
        logger.warn(`Still failed: ${errMsg2}`);

        // Fallback 2: Try without sparse vectors
        if (sparseConfig) {
          logger.info(`Retrying ${collectionName} without sparse vectors...`);
          await qdrant.createCollection(collectionName, {
            vectors: baseVectors,
            on_disk_payload: config.onDiskPayload,
          });
          logger.info(`Collection ${collectionName} created (dense-only, no quantization)`);
        } else {
          throw error2;
        }
      }
    } else if (sparseConfig) {
      // Fallback: Try without sparse vectors
      logger.info(`Retrying ${collectionName} without sparse vectors...`);
      await qdrant.createCollection(collectionName, {
        vectors: baseVectors,
        on_disk_payload: config.onDiskPayload,
      });
      logger.info(`Collection ${collectionName} created (dense-only)`);
    } else {
      throw error;
    }
  }

  // Create payload indexes
  for (const index of payloadIndexes) {
    try {
      await qdrant.createPayloadIndex(collectionName, index);
    } catch (indexError) {
      logger.warn(
        `Failed to create index ${index.field_name} on ${collectionName}: ${indexError instanceof Error ? indexError.message : String(indexError)}`
      );
    }
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function isDangerousRecreateAllowed(): boolean {
  return process.env.QDRANT_DANGEROUS_RECREATE === 'true';
}

export const VECTOR_SIZE_OPENAI = 1536;
export const VECTOR_SIZE_COHERE = 1024;

export type EmbeddingProvider = 'openai' | 'cohere';

export interface CollectionConfig {
  vectorSize: number;
  enableHybridSearch: boolean;
  onDiskPayload?: boolean;
  quantization?: 'scalar' | 'binary' | 'none';
}

const DEFAULT_COLLECTION_CONFIGS: Record<string, CollectionConfig> = {
  [QDRANT_COLLECTION_NAMES.APPROVED_POSTS]: {
    vectorSize: VECTOR_SIZE_OPENAI,
    enableHybridSearch: true,
    onDiskPayload: true,
    quantization: 'scalar',
  },
  [QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES]: {
    vectorSize: VECTOR_SIZE_OPENAI,
    enableHybridSearch: true,
    onDiskPayload: false,
    quantization: 'none',
  },
  [QDRANT_COLLECTION_NAMES.SOURCES]: {
    vectorSize: VECTOR_SIZE_OPENAI,
    enableHybridSearch: true,
    onDiskPayload: true,
    quantization: 'scalar',
  },
  [QDRANT_COLLECTION_NAMES.AI_SLOP_CORPUS]: {
    vectorSize: VECTOR_SIZE_OPENAI,
    enableHybridSearch: true,
    onDiskPayload: false,
    quantization: 'scalar',
  },
};

function getVectorSize(): number {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'openai';
  return provider === 'cohere' ? VECTOR_SIZE_COHERE : VECTOR_SIZE_OPENAI;
}

export async function createApprovedPostsCollection(client?: QdrantClient): Promise<void> {
  const qdrant = client ?? getQdrantClient();
  const collectionName = QDRANT_COLLECTION_NAMES.APPROVED_POSTS;

  const exists = await collectionExists(collectionName);
  if (exists) {
    logger.debug(`Collection ${collectionName} already exists`);
    return;
  }

  const vectorSize = getVectorSize();
  const config = DEFAULT_COLLECTION_CONFIGS[collectionName];

  logger.info(`Creating collection ${collectionName} with vector size ${vectorSize}`);

  await createCollectionWithFallback(qdrant, {
    collectionName,
    vectorSize,
    config,
    payloadIndexes: [
      { field_name: 'post_id', field_schema: 'keyword' },
      { field_name: 'created_at', field_schema: 'datetime' },
      { field_name: 'content_type', field_schema: 'keyword' },
    ],
  });

  logger.info(`Collection ${collectionName} created successfully`);
}

export async function createVoiceGuidelinesCollection(client?: QdrantClient): Promise<void> {
  const qdrant = client ?? getQdrantClient();
  const collectionName = QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES;

  const exists = await collectionExists(collectionName);
  if (exists) {
    logger.debug(`Collection ${collectionName} already exists`);
    return;
  }

  const vectorSize = getVectorSize();
  const config = DEFAULT_COLLECTION_CONFIGS[collectionName];

  logger.info(`Creating collection ${collectionName} with vector size ${vectorSize}`);

  await createCollectionWithFallback(qdrant, {
    collectionName,
    vectorSize,
    config,
    payloadIndexes: [
      { field_name: 'guideline_type', field_schema: 'keyword' },
      { field_name: 'priority', field_schema: 'integer' },
    ],
  });

  logger.info(`Collection ${collectionName} created successfully`);
}

export async function createSourcesCollection(client?: QdrantClient): Promise<void> {
  const qdrant = client ?? getQdrantClient();
  const collectionName = QDRANT_COLLECTION_NAMES.SOURCES;

  const exists = await collectionExists(collectionName);
  if (exists) {
    logger.debug(`Collection ${collectionName} already exists`);
    return;
  }

  const vectorSize = getVectorSize();
  const config = DEFAULT_COLLECTION_CONFIGS[collectionName];

  logger.info(`Creating collection ${collectionName} with vector size ${vectorSize}`);

  await createCollectionWithFallback(qdrant, {
    collectionName,
    vectorSize,
    config,
    payloadIndexes: [
      { field_name: 'source_id', field_schema: 'keyword' },
      { field_name: 'source_type', field_schema: 'keyword' },
      { field_name: 'scraped_at', field_schema: 'datetime' },
      { field_name: 'account_handle', field_schema: 'keyword' },
    ],
  });

  logger.info(`Collection ${collectionName} created successfully`);
}

export async function createAiSlopCorpusCollection(client?: QdrantClient): Promise<void> {
  const qdrant = client ?? getQdrantClient();
  const collectionName = QDRANT_COLLECTION_NAMES.AI_SLOP_CORPUS;

  const exists = await collectionExists(collectionName);
  if (exists) {
    logger.debug(`Collection ${collectionName} already exists`);
    return;
  }

  const vectorSize = getVectorSize();
  const config = DEFAULT_COLLECTION_CONFIGS[collectionName];

  logger.info(`Creating collection ${collectionName} with vector size ${vectorSize}`);

  await createCollectionWithFallback(qdrant, {
    collectionName,
    vectorSize,
    config,
    payloadIndexes: [
      { field_name: 'source', field_schema: 'keyword' },
      { field_name: 'category', field_schema: 'keyword' },
      { field_name: 'added_at', field_schema: 'datetime' },
    ],
  });

  logger.info(`Collection ${collectionName} created successfully`);
}

export async function initializeAllCollections(client?: QdrantClient): Promise<void> {
  logger.info('Initializing all Qdrant collections');

  await createApprovedPostsCollection(client);
  await createVoiceGuidelinesCollection(client);
  await createSourcesCollection(client);
  await createAiSlopCorpusCollection(client);

  logger.info('All Qdrant collections initialized');
}

export async function deleteCollection(
  collectionName: string,
  client?: QdrantClient,
  options?: { force?: boolean }
): Promise<void> {
  const qdrant = client ?? getQdrantClient();

  if (isProduction() && !isDangerousRecreateAllowed()) {
    if (options?.force !== true) {
      logger.error(
        `BLOCKED: Attempted to delete collection ${collectionName} in production. ` +
          `Set QDRANT_DANGEROUS_RECREATE=true to override (not recommended).`
      );
      throw new Error(
        `Cannot delete Qdrant collection in production without QDRANT_DANGEROUS_RECREATE=true`
      );
    }
    logger.warn(`Force-deleting collection ${collectionName} in production with force=true`);
  }

  const exists = await collectionExists(collectionName);
  if (!exists) {
    logger.debug(`Collection ${collectionName} does not exist`);
    return;
  }

  logger.info(`Deleting collection ${collectionName}`);
  await qdrant.deleteCollection(collectionName);
  logger.info(`Collection ${collectionName} deleted`);
}

export async function recreateCollection(
  collectionName: string,
  client?: QdrantClient
): Promise<void> {
  if (isProduction() && !isDangerousRecreateAllowed()) {
    logger.error(
      `BLOCKED: Attempted to recreate collection ${collectionName} in production. ` +
        `Set QDRANT_DANGEROUS_RECREATE=true to override (not recommended).`
    );
    throw new Error(
      `Cannot recreate Qdrant collection in production without QDRANT_DANGEROUS_RECREATE=true`
    );
  }

  if (isProduction()) {
    logger.warn(
      `WARNING: Recreating collection ${collectionName} in production with QDRANT_DANGEROUS_RECREATE=true`
    );
  }

  await deleteCollection(collectionName, client, { force: true });

  const createFunctions: Record<string, (c?: QdrantClient) => Promise<void>> = {
    [QDRANT_COLLECTION_NAMES.APPROVED_POSTS]: createApprovedPostsCollection,
    [QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES]: createVoiceGuidelinesCollection,
    [QDRANT_COLLECTION_NAMES.SOURCES]: createSourcesCollection,
    [QDRANT_COLLECTION_NAMES.AI_SLOP_CORPUS]: createAiSlopCorpusCollection,
  };

  const createFn = createFunctions[collectionName];
  if (createFn !== undefined) {
    await createFn(client);
  } else {
    throw new Error(`Unknown collection: ${collectionName}`);
  }
}

export async function getCollectionInfo(
  collectionName: string,
  client?: QdrantClient
): Promise<{
  exists: boolean;
  pointsCount?: number;
  vectorSize?: number;
  hasHybridSearch?: boolean;
}> {
  const qdrant = client ?? getQdrantClient();

  const exists = await collectionExists(collectionName);
  if (!exists) {
    return { exists: false };
  }

  const info = await qdrant.getCollection(collectionName);
  const vectorsConfig = info.config?.params?.vectors;

  let vectorSize: number | undefined;
  if (typeof vectorsConfig === 'object' && vectorsConfig !== null) {
    if ('size' in vectorsConfig) {
      vectorSize = vectorsConfig.size as number;
    } else if ('dense' in vectorsConfig && typeof vectorsConfig.dense === 'object') {
      vectorSize = (vectorsConfig.dense as { size: number }).size;
    }
  }

  const sparseVectors = info.config?.params?.sparse_vectors;
  const hasHybridSearch =
    sparseVectors != null &&
    typeof sparseVectors === 'object' &&
    Object.keys(sparseVectors).length > 0;

  return {
    exists: true,
    pointsCount: info.points_count ?? undefined,
    vectorSize,
    hasHybridSearch,
  };
}
