import { QdrantClient } from '@qdrant/js-client-rest';

let client: QdrantClient | null = null;

interface QdrantConfig {
  url: string;
  apiKey?: string;
  timeout: number;
}

const DEFAULT_QDRANT_TIMEOUT_MS = 10000;

function getQdrantConfig(): QdrantConfig {
  const url = process.env.QDRANT_URL ?? 'http://localhost:6333';
  const apiKey = process.env.QDRANT_API_KEY ?? undefined;
  const timeout = parseInt(process.env.QDRANT_TIMEOUT_MS ?? '', 10) || DEFAULT_QDRANT_TIMEOUT_MS;
  return { url, apiKey, timeout };
}

export function getQdrantClient(): QdrantClient {
  if (client) {
    return client;
  }

  const config = getQdrantConfig();
  client = new QdrantClient({
    url: config.url,
    apiKey: config.apiKey,
    timeout: config.timeout,
    // Disable version check - server 1.12.5, client 1.16.2
    checkCompatibility: false,
  });

  return client;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const qdrantClient = getQdrantClient();
    await qdrantClient.getCollections();
    return true;
  } catch {
    return false;
  }
}

export async function listCollections(): Promise<string[]> {
  const qdrantClient = getQdrantClient();
  const result = await qdrantClient.getCollections();
  return result.collections.map((c) => c.name);
}

export async function collectionExists(name: string): Promise<boolean> {
  try {
    const qdrantClient = getQdrantClient();
    await qdrantClient.getCollection(name);
    return true;
  } catch {
    return false;
  }
}

export function resetQdrantClient(): void {
  client = null;
}

export const QDRANT_COLLECTION_NAMES = {
  APPROVED_POSTS: 'approved_posts',
  VOICE_GUIDELINES: 'voice_guidelines',
  SOURCES: 'sources',
  AI_SLOP_CORPUS: 'ai_slop_corpus',
} as const;

export type QdrantCollectionName =
  (typeof QDRANT_COLLECTION_NAMES)[keyof typeof QDRANT_COLLECTION_NAMES];
