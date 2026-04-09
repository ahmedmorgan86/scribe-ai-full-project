/**
 * API route for voice validation.
 * Used by the Python LangGraph worker to validate content against voice corpus.
 */

import { NextRequest, NextResponse } from 'next/server';
import { embeddingSimilarityFilter, EmbeddingFilterResult } from '@/lib/voice/fast-filter';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:voice:check');

export interface VoiceCheckRequest {
  content: string;
  threshold?: number;
}

export interface VoiceCheckResponse {
  success: boolean;
  result: {
    pass: boolean;
    similarity: number;
    threshold: number;
    matchCount: number;
    feedback: string;
    corpusAvailable: boolean;
    topMatches: Array<{
      content: string;
      similarity: number;
      source: string;
    }>;
  } | null;
  error: string | null;
}

export async function POST(request: NextRequest): Promise<NextResponse<VoiceCheckResponse>> {
  try {
    const body = (await request.json()) as VoiceCheckRequest;

    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json(
        {
          success: false,
          result: null,
          error: 'content is required and must be a string',
        },
        { status: 400 }
      );
    }

    const threshold = typeof body.threshold === 'number' ? body.threshold : 0.7;

    logger.debug('Voice check request', {
      contentLength: body.content.length,
      threshold,
    });

    const filterResult: EmbeddingFilterResult = await embeddingSimilarityFilter(body.content, {
      threshold,
      nResults: 5,
      includeGuidelines: true,
      requireCorpus: false,
    });

    const result = {
      pass: filterResult.passed,
      similarity: filterResult.similarity,
      threshold: filterResult.threshold,
      matchCount: filterResult.matchCount,
      feedback: filterResult.reason,
      corpusAvailable: filterResult.corpusAvailable,
      topMatches: filterResult.topMatches.map((m) => ({
        content: m.content,
        similarity: m.similarity,
        source: m.source,
      })),
    };

    logger.info('Voice check complete', {
      pass: result.pass,
      similarity: result.similarity,
      threshold: result.threshold,
      corpusAvailable: result.corpusAvailable,
    });

    return NextResponse.json({
      success: true,
      result,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Voice check failed', { error: message });

    return NextResponse.json(
      {
        success: false,
        result: null,
        error: message,
      },
      { status: 500 }
    );
  }
}

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'healthy',
    endpoint: 'voice-check',
    description: 'POST { content: string, threshold?: number } to validate against voice corpus',
  });
}
