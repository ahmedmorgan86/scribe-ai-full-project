import type { SlopDetector } from '@/types';
import { QDRANT_COLLECTION_NAMES } from '@/db/qdrant/connection';
import {
  search,
  addDocument,
  addDocumentsBatch,
  deleteDocument,
  deleteDocumentsBatch,
  getDocument,
  countDocuments,
  deleteByFilter,
} from '@/db/qdrant/embeddings';
import { createAiSlopCorpusCollection } from '@/db/qdrant/collections';
import { generateEmbedding, generateEmbeddingsBatch } from '@/lib/embeddings/service';
import { textToSparseVector } from '@/db/qdrant/sparse-vectors';
import { createLogger } from '@/lib/logger';

const logger = createLogger('slop:semantic');

export interface SemanticMatch {
  id: string;
  content: string;
  similarity: number;
  source: string;
}

export interface SemanticCheckResult {
  isSlop: boolean;
  matches: SemanticMatch[];
  maxSimilarity: number;
  averageSimilarity: number;
  detector: SlopDetector;
}

export interface SemanticCheckOptions {
  threshold?: number;
  nResults?: number;
}

export const AI_CORPUS_COLLECTION = QDRANT_COLLECTION_NAMES.AI_SLOP_CORPUS;
export const DEFAULT_SEMANTIC_THRESHOLD = 0.85;
export const DEFAULT_N_RESULTS = 5;

async function ensureCollectionExists(): Promise<void> {
  await createAiSlopCorpusCollection();
}

export async function checkSemanticSimilarity(
  content: string,
  options: SemanticCheckOptions = {}
): Promise<SemanticCheckResult> {
  const { threshold = DEFAULT_SEMANTIC_THRESHOLD, nResults = DEFAULT_N_RESULTS } = options;

  await ensureCollectionExists();

  const count = await countDocuments(AI_CORPUS_COLLECTION);

  if (count === 0) {
    return {
      isSlop: false,
      matches: [],
      maxSimilarity: 0,
      averageSimilarity: 0,
      detector: 'semantic',
    };
  }

  const embeddingResult = await generateEmbedding(content);

  const results = await search(AI_CORPUS_COLLECTION, embeddingResult.embedding, {
    limit: nResults,
  });

  if (results.length === 0) {
    return {
      isSlop: false,
      matches: [],
      maxSimilarity: 0,
      averageSimilarity: 0,
      detector: 'semantic',
    };
  }

  const matches: SemanticMatch[] = results.map((result) => ({
    id: result.id,
    content: result.text,
    similarity: result.score,
    source: typeof result.metadata?.source === 'string' ? result.metadata.source : 'unknown',
  }));

  const similarities = matches.map((m) => m.similarity);
  const maxSimilarity = Math.max(...similarities);
  const averageSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

  const highSimilarityMatches = matches.filter((m) => m.similarity >= threshold);

  return {
    isSlop: highSimilarityMatches.length > 0,
    matches: highSimilarityMatches,
    maxSimilarity,
    averageSimilarity,
    detector: 'semantic',
  };
}

export interface AiCorpusEntry {
  id: string;
  content: string;
  source?: string;
  category?: string;
}

export async function addToAiCorpus(entry: AiCorpusEntry): Promise<void> {
  await ensureCollectionExists();

  const embeddingResult = await generateEmbedding(entry.content);
  const sparseVector = textToSparseVector(entry.content);

  await addDocument(
    AI_CORPUS_COLLECTION,
    entry.id,
    entry.content,
    embeddingResult.embedding,
    {
      source: entry.source ?? 'manual',
      category: entry.category ?? 'generic',
      added_at: new Date().toISOString(),
    },
    sparseVector
  );

  logger.debug(`Added entry ${entry.id} to AI slop corpus`);
}

export async function addToAiCorpusBatch(entries: AiCorpusEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await ensureCollectionExists();

  const texts = entries.map((e) => e.content);
  const embeddingResults = await generateEmbeddingsBatch(texts);

  const documents = entries.map((entry, index) => {
    const sparseVector = textToSparseVector(entry.content);
    return {
      id: entry.id,
      text: entry.content,
      embedding: embeddingResults[index].embedding,
      metadata: {
        source: entry.source ?? 'manual',
        category: entry.category ?? 'generic',
        added_at: new Date().toISOString(),
      },
      sparseVector,
    };
  });

  await addDocumentsBatch(AI_CORPUS_COLLECTION, documents);

  logger.debug(`Added ${entries.length} entries to AI slop corpus`);
}

export async function removeFromAiCorpus(id: string): Promise<void> {
  await deleteDocument(AI_CORPUS_COLLECTION, id);
  logger.debug(`Removed entry ${id} from AI slop corpus`);
}

export async function removeFromAiCorpusBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await deleteDocumentsBatch(AI_CORPUS_COLLECTION, ids);
  logger.debug(`Removed ${ids.length} entries from AI slop corpus`);
}

export async function getAiCorpusCount(): Promise<number> {
  await ensureCollectionExists();
  return countDocuments(AI_CORPUS_COLLECTION);
}

export async function clearAiCorpus(): Promise<void> {
  await ensureCollectionExists();
  await deleteByFilter(AI_CORPUS_COLLECTION, {
    must: [{ key: 'source', match: { value: 'seed' } }],
  });
  await deleteByFilter(AI_CORPUS_COLLECTION, {
    must: [{ key: 'source', match: { value: 'manual' } }],
  });
  logger.info('Cleared AI slop corpus');
}

export async function getAiCorpusEntry(id: string): Promise<AiCorpusEntry | null> {
  await ensureCollectionExists();

  const doc = await getDocument(AI_CORPUS_COLLECTION, id);
  if (!doc) {
    return null;
  }

  return {
    id: doc.id,
    content: doc.text,
    source: typeof doc.metadata?.source === 'string' ? doc.metadata.source : undefined,
    category: typeof doc.metadata?.category === 'string' ? doc.metadata.category : undefined,
  };
}

export function formatSemanticCheckResult(result: SemanticCheckResult): string {
  if (!result.isSlop) {
    return `No semantic slop detected. Max similarity: ${(result.maxSimilarity * 100).toFixed(1)}%`;
  }

  const lines = [
    `Semantic slop detected (${result.matches.length} high-similarity match${result.matches.length > 1 ? 'es' : ''}):`,
    `  Max similarity: ${(result.maxSimilarity * 100).toFixed(1)}%`,
    `  Avg similarity: ${(result.averageSimilarity * 100).toFixed(1)}%`,
    '',
    'Matches:',
  ];

  for (const match of result.matches) {
    const preview =
      match.content.length > 80 ? match.content.substring(0, 80) + '...' : match.content;
    lines.push(`  [${(match.similarity * 100).toFixed(1)}%] "${preview}"`);
    lines.push(`    Source: ${match.source}`);
  }

  return lines.join('\n');
}

export const KNOWN_AI_SLOP_EXAMPLES = [
  "In today's fast-paced digital landscape, staying ahead of the curve is more important than ever.",
  'Unlock the full potential of your workflow with these proven strategies.',
  'This revolutionary approach will change the way you think about productivity.',
  "Are you tired of the same old results? Here's what top performers do differently.",
  "The secret that industry leaders don't want you to know about success.",
  'Transform your mindset and watch your results skyrocket to new heights.',
  "Here's a comprehensive breakdown of everything you need to know.",
  'Let me share some game-changing insights that transformed my approach.',
  'This might just be the most important thing you read today.',
  "I've been doing this for years, and here's what nobody tells you.",
  'Buckle up because this is going to blow your mind.',
  'The truth is, most people are doing this completely wrong.',
  "After extensive research, I've discovered the ultimate solution.",
  'These actionable tips will help you level up your game immediately.',
  "What I'm about to share will revolutionize your entire perspective.",
  'Most people underestimate the power of this simple technique.',
  "Here's a hot take that might ruffle some feathers.",
  "I'm going to let you in on a little secret that changed everything.",
  "This is not just another ordinary piece of advice - it's a paradigm shift.",
  'Ready to unlock unprecedented growth? Let me show you how.',
] as const;

export async function seedAiCorpusWithDefaults(): Promise<number> {
  await ensureCollectionExists();

  const existingCount = await countDocuments(AI_CORPUS_COLLECTION);
  if (existingCount > 0) {
    return 0;
  }

  const entries: AiCorpusEntry[] = KNOWN_AI_SLOP_EXAMPLES.map((content, index) => ({
    id: `default-slop-${index + 1}`,
    content,
    source: 'seed',
    category: 'generic-ai',
  }));

  await addToAiCorpusBatch(entries);
  logger.info(`Seeded AI slop corpus with ${entries.length} default examples`);
  return entries.length;
}

export async function isAiCorpusInitialized(): Promise<boolean> {
  const count = await getAiCorpusCount();
  return count > 0;
}
