import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { addDocumentsBatch, countDocuments } from '@/db/qdrant/embeddings';
import { QDRANT_COLLECTION_NAMES, collectionExists, getQdrantClient } from '@/db/qdrant/connection';
import { generateEmbeddingsBatch } from '@/lib/embeddings/service';
import { textToSparseVector } from '@/db/qdrant/sparse-vectors';
import {
  generateSignature,
  StyleSignature,
  clearPersonaSignatureCache,
  saveBaselineSignatureToFile,
} from '@/lib/voice/signature';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:bootstrap:gold-examples');

interface GoldExample {
  id: string;
  text: string;
  createdAt: string;
}

interface GoldExamplesGetResponse {
  examples: GoldExample[];
  count: number;
  total: number;
}

interface GoldExamplesRequest {
  examples: string[];
}

interface GoldExamplesResponse {
  success: boolean;
  added: number;
  skipped: number;
  baselineSignatureGenerated: boolean;
}

interface ErrorResponse {
  error: string;
}

/**
 * GET /api/bootstrap/gold-examples
 * Retrieves all gold examples from Qdrant
 */
export async function GET(): Promise<NextResponse<GoldExamplesGetResponse | ErrorResponse>> {
  try {
    const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
    if (!exists) {
      return NextResponse.json({
        examples: [],
        count: 0,
        total: 0,
      });
    }

    const qdrant = getQdrantClient();

    // Count total gold examples
    const totalCount = await countDocuments(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, {
      must: [{ key: 'content_type', match: { value: 'gold_example' } }],
    });

    // Scroll through all gold examples (limit to 100 for display)
    const scrollResult = await qdrant.scroll(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, {
      filter: {
        must: [{ key: 'content_type', match: { value: 'gold_example' } }],
      },
      limit: 100,
      with_payload: true,
    });

    const examples: GoldExample[] = scrollResult.points.map((point) => ({
      id: String(point.id),
      text: (point.payload?.text as string) ?? '',
      createdAt: (point.payload?.created_at as string) ?? '',
    }));

    logger.debug(`Retrieved ${examples.length} gold examples (total: ${totalCount})`);

    return NextResponse.json({
      examples,
      count: examples.length,
      total: totalCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get gold examples', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/bootstrap/gold-examples?id=<uuid>
 * Deletes a gold example by ID
 */
export async function DELETE(
  request: Request
): Promise<NextResponse<{ success: boolean } | ErrorResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
    if (!exists) {
      return NextResponse.json({ error: 'Collection does not exist' }, { status: 404 });
    }

    const qdrant = getQdrantClient();

    // Delete the specific point by ID
    await qdrant.delete(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, {
      points: [id],
    });

    logger.info(`Deleted gold example: ${id}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to delete gold example', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request
): Promise<NextResponse<GoldExamplesResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as GoldExamplesRequest;

    if (!Array.isArray(body.examples)) {
      return NextResponse.json({ error: 'Examples array is required' }, { status: 400 });
    }

    const validExamples = body.examples
      .filter((e) => typeof e === 'string' && e.trim().length > 0)
      .map((e) => e.trim());

    if (validExamples.length === 0) {
      return NextResponse.json({ error: 'No valid examples provided' }, { status: 400 });
    }

    const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
    if (!exists) {
      logger.info('approved_posts collection does not exist, creating it now...');
      const { createApprovedPostsCollection } = await import('@/db/qdrant/collections');
      await createApprovedPostsCollection();
      logger.info('approved_posts collection created successfully');
    }

    const now = new Date().toISOString();
    const embeddingResults = await generateEmbeddingsBatch(validExamples);

    const documents = validExamples.map((content, index) => ({
      id: randomUUID(),
      text: content,
      embedding: embeddingResults[index].embedding,
      metadata: {
        post_id: 0,
        created_at: now,
        voice_score: null,
        content_type: 'gold_example',
        is_exceptional: true,
      },
      sparseVector: textToSparseVector(content),
    }));

    await addDocumentsBatch(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, documents);
    logger.info(`Added ${documents.length} gold examples to Qdrant`);

    let baselineSignatureGenerated = false;
    try {
      const baselineSignature = generateBaselineSignatureFromExamples(validExamples);
      saveBaselineSignatureToFile(baselineSignature);
      clearPersonaSignatureCache();
      baselineSignatureGenerated = true;
      logger.info(
        `Generated baseline stylometric signature from ${validExamples.length} gold examples`
      );
    } catch (sigError) {
      const sigMsg = sigError instanceof Error ? sigError.message : 'Unknown error';
      logger.warn('Failed to generate baseline signature (non-fatal)', { error: sigMsg });
    }

    return NextResponse.json({
      success: true,
      added: documents.length,
      skipped: 0,
      baselineSignatureGenerated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to add gold examples', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function generateBaselineSignatureFromExamples(examples: string[]): StyleSignature {
  if (examples.length === 0) {
    throw new Error('Cannot generate baseline signature from empty examples');
  }

  const signatures = examples.map((text) => generateSignature(text));

  if (signatures.length === 1) {
    return signatures[0];
  }

  const count = signatures.length;
  const avg = (accessor: (s: StyleSignature) => number): number =>
    signatures.reduce((sum, s) => sum + accessor(s), 0) / count;

  return {
    sentenceLength: {
      mean: avg((s) => s.sentenceLength.mean),
      stdDev: avg((s) => s.sentenceLength.stdDev),
    },
    punctuation: {
      periodRate: avg((s) => s.punctuation.periodRate),
      commaRate: avg((s) => s.punctuation.commaRate),
      exclamationRate: avg((s) => s.punctuation.exclamationRate),
      questionRate: avg((s) => s.punctuation.questionRate),
      dashRate: avg((s) => s.punctuation.dashRate),
      ellipsisRate: avg((s) => s.punctuation.ellipsisRate),
    },
    vocabulary: {
      typeTokenRatio: avg((s) => s.vocabulary.typeTokenRatio),
      hapaxRatio: avg((s) => s.vocabulary.hapaxRatio),
    },
    functionWords: {
      the: avg((s) => s.functionWords.the),
      and: avg((s) => s.functionWords.and),
      but: avg((s) => s.functionWords.but),
      of: avg((s) => s.functionWords.of),
      to: avg((s) => s.functionWords.to),
      a: avg((s) => s.functionWords.a),
      in: avg((s) => s.functionWords.in),
      that: avg((s) => s.functionWords.that),
      is: avg((s) => s.functionWords.is),
      it: avg((s) => s.functionWords.it),
    },
    syntactic: {
      avgClauseDepth: avg((s) => s.syntactic.avgClauseDepth),
      avgWordsPerClause: avg((s) => s.syntactic.avgWordsPerClause),
      subordinateClauseRatio: avg((s) => s.syntactic.subordinateClauseRatio),
    },
    metadata: {
      textLength: 0,
      sampleCount: count,
      generatedAt: new Date().toISOString(),
    },
  };
}
