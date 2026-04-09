/**
 * API route for humanizing content.
 * POST {content} -> {humanized, patterns_found, changes_made}
 *
 * HUM-004: Create humanizer API endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  humanizeContent,
  getAppliedChangesCount,
  type HumanizeResult,
} from '@/lib/humanizer/transform';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:humanize');

export interface HumanizeRequest {
  content: string;
}

export interface HumanizeResponse {
  success: boolean;
  result: {
    humanized: string;
    patterns_found: number;
    changes_made: number;
    changes: Array<{
      patternName: string;
      original: string;
      replacement: string;
      applied: boolean;
    }>;
  } | null;
  error: string | null;
}

export async function POST(request: NextRequest): Promise<NextResponse<HumanizeResponse>> {
  try {
    const body = (await request.json()) as HumanizeRequest;

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

    if (body.content.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          result: null,
          error: 'content cannot be empty',
        },
        { status: 400 }
      );
    }

    logger.debug('Humanize request', {
      contentLength: body.content.length,
    });

    const humanizeResult: HumanizeResult = humanizeContent(body.content);
    const changesMade = getAppliedChangesCount(humanizeResult);

    const result = {
      humanized: humanizeResult.humanized,
      patterns_found: humanizeResult.changes.length,
      changes_made: changesMade,
      changes: humanizeResult.changes,
    };

    logger.info('Humanize complete', {
      patternsFound: result.patterns_found,
      changesMade: result.changes_made,
    });

    return NextResponse.json({
      success: true,
      result,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Humanize failed', { error: message });

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
    endpoint: 'humanize',
    description:
      'POST { content: string } to humanize AI-generated content by applying pattern rewrites',
  });
}
