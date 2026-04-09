import { NextResponse } from 'next/server';
import { getThresholdsAsJson, validateThresholds } from '@/lib/config/thresholds';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:config:thresholds');

/**
 * GET /api/config/thresholds
 *
 * Returns all validation thresholds as JSON.
 * Used by Python workers to fetch thresholds from the single source of truth.
 *
 * Response:
 * {
 *   voice: { similarity, minConfidence, minDimensionScore, contrastThreshold },
 *   slop: { maxScore, warningScore, semanticThreshold },
 *   stylometry: { similarity, minDimensions, maxDrift },
 *   duplicate: { postSimilarity, sourceSimilarity },
 *   learning: { stuckBaseThreshold, patternSimilarity }
 * }
 */
export function GET(): NextResponse {
  try {
    const thresholds = getThresholdsAsJson();
    const validationErrors = validateThresholds();

    if (validationErrors.length > 0) {
      logger.warn('Threshold validation warnings', { errors: validationErrors });
    }

    return NextResponse.json({
      thresholds,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    });
  } catch (error) {
    logger.error('Failed to get thresholds', { error });
    return NextResponse.json({ error: 'Failed to get thresholds' }, { status: 500 });
  }
}
