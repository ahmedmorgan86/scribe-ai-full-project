/**
 * API route for stylometric validation.
 * Used by the Python LangGraph worker to validate content against persona signature.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validate, StylometricValidationResult } from '@/lib/voice/stylometric-validator';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:stylometric:validate');

export interface StylometricValidateRequest {
  content: string;
  threshold?: number;
}

export interface StylometricValidateResponse {
  success: boolean;
  result: StylometricValidationResult | null;
  error: string | null;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<StylometricValidateResponse>> {
  try {
    const body = (await request.json()) as StylometricValidateRequest;

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

    const threshold = typeof body.threshold === 'number' ? body.threshold : undefined;

    logger.debug('Stylometric validation request', {
      contentLength: body.content.length,
      threshold,
    });

    const result = await validate(body.content, { threshold });

    logger.info('Stylometric validation complete', {
      pass: result.pass,
      score: result.score,
      threshold: result.threshold,
    });

    return NextResponse.json({
      success: true,
      result,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Stylometric validation failed', { error: message });

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
    endpoint: 'stylometric-validate',
    description: 'POST { content: string, threshold?: number } to validate stylometric signature',
  });
}
