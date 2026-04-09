/**
 * API route for slop detection.
 * Used by the Python LangGraph worker to detect AI-generated slop patterns.
 */

import { NextRequest, NextResponse } from 'next/server';
import { detectSlop, getSlopSeverityScore, DetailedSlopResult } from '@/lib/slop/detector';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:slop:detect');

export interface SlopDetectRequest {
  content: string;
  skipSemantic?: boolean;
  skipVoiceContrast?: boolean;
  threshold?: number;
}

export interface SlopDetectResponse {
  success: boolean;
  result: {
    pass: boolean;
    score: number;
    threshold: number;
    issues: Array<{
      detector: string;
      description: string;
      severity: 'low' | 'medium' | 'high';
    }>;
    detectedBy: string[];
    flagForReview: boolean;
    feedback: string;
    suggestions: string[];
  } | null;
  error: string | null;
}

const DEFAULT_SLOP_THRESHOLD = 30;

export async function POST(request: NextRequest): Promise<NextResponse<SlopDetectResponse>> {
  try {
    const body = (await request.json()) as SlopDetectRequest;

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

    const threshold = typeof body.threshold === 'number' ? body.threshold : DEFAULT_SLOP_THRESHOLD;

    logger.debug('Slop detection request', {
      contentLength: body.content.length,
      threshold,
      skipSemantic: body.skipSemantic,
      skipVoiceContrast: body.skipVoiceContrast,
    });

    const detectionResult: DetailedSlopResult = await detectSlop(body.content, {
      skipSemantic: body.skipSemantic ?? false,
      skipVoiceContrast: body.skipVoiceContrast ?? false,
    });

    const score = getSlopSeverityScore(detectionResult);
    const pass = score < threshold;

    let feedback: string;
    if (pass) {
      feedback = 'Clean content - no significant slop detected';
    } else {
      const issueDescriptions = detectionResult.issues
        .map((i) => i.description)
        .slice(0, 3)
        .join('; ');
      feedback = `Slop score ${score}/100: ${issueDescriptions}`;
    }

    const result = {
      pass,
      score,
      threshold,
      issues: detectionResult.issues.map((i) => ({
        detector: i.detector,
        description: i.description,
        severity: i.severity,
      })),
      detectedBy: detectionResult.detectedBy,
      flagForReview: detectionResult.flagForReview,
      feedback,
      suggestions: detectionResult.suggestions,
    };

    logger.info('Slop detection complete', {
      pass: result.pass,
      score: result.score,
      threshold: result.threshold,
      detectorCount: result.detectedBy.length,
    });

    return NextResponse.json({
      success: true,
      result,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Slop detection failed', { error: message });

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
    endpoint: 'slop-detect',
    description:
      'POST { content: string, threshold?: number, skipSemantic?: boolean, skipVoiceContrast?: boolean } to detect AI slop patterns',
  });
}
