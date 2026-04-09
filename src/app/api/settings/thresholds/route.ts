import { NextRequest, NextResponse } from 'next/server';
import { getThresholdsAsJson, validateThresholds, ThresholdsConfig } from '@/lib/config/thresholds';
import {
  getAllThresholdOverrides,
  setThresholdOverrides,
  deleteAllThresholdOverrides,
  isValidThresholdKey,
  getValidThresholdKeys,
  ThresholdKey,
} from '@/db/models/threshold-overrides';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:settings:thresholds');

interface ThresholdUpdate {
  key: string;
  value: number;
}

interface PatchThresholdsBody {
  thresholds: ThresholdUpdate[];
}

interface ThresholdsResponse {
  thresholds: ThresholdsConfig;
  overrides: Array<{ key: string; value: number; updatedAt: string }>;
  validationErrors?: string[];
}

interface ErrorResponse {
  error: string;
  details?: string[];
}

interface SuccessResponse {
  success: boolean;
  message: string;
  updated: Array<{ key: string; value: number }>;
  validationErrors?: string[];
}

/**
 * GET /api/settings/thresholds
 *
 * Returns current thresholds (with database overrides applied) and list of overrides.
 */
export function GET(): NextResponse<ThresholdsResponse | ErrorResponse> {
  try {
    const thresholds = getThresholdsAsJson();
    const validationErrors = validateThresholds();
    const overrides = getAllThresholdOverrides();

    return NextResponse.json({
      thresholds,
      overrides,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    });
  } catch (error) {
    logger.error('Failed to get thresholds', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to get thresholds: ${errorMessage}` },
      { status: 500 }
    );
  }
}

function validateThresholdValue(key: ThresholdKey, value: number): string | null {
  if (typeof value !== 'number' || isNaN(value)) {
    return `Value for ${key} must be a valid number`;
  }

  // Stylometry weights: 0-1 range
  if (key.startsWith('stylometryWeights.')) {
    if (value < 0 || value > 1) {
      return `${key} must be between 0 and 1, got ${value}`;
    }
    return null;
  }

  // Validate ranges based on threshold type
  if (key.includes('similarity') || key.includes('Threshold') || key.includes('Drift')) {
    // 0-1 range thresholds
    if (value < 0 || value > 1) {
      return `${key} must be between 0 and 1, got ${value}`;
    }
  } else if (key.includes('Score') || key.includes('Confidence')) {
    // 0-100 range thresholds
    if (value < 0 || value > 100) {
      return `${key} must be between 0 and 100, got ${value}`;
    }
  } else if (key === 'stylometry.minDimensions') {
    if (value < 1 || !Number.isInteger(value)) {
      return `${key} must be a positive integer, got ${value}`;
    }
  } else if (key === 'learning.stuckBaseThreshold') {
    if (value < 1 || !Number.isInteger(value)) {
      return `${key} must be a positive integer, got ${value}`;
    }
  }

  return null;
}

/**
 * PATCH /api/settings/thresholds
 *
 * Updates threshold overrides in the database.
 * Accepts an array of { key, value } pairs to update.
 *
 * Request body:
 * {
 *   thresholds: [
 *     { key: "voice.similarity", value: 0.75 },
 *     { key: "slop.maxScore", value: 25 }
 *   ]
 * }
 *
 * Note: Environment variables still take precedence over database values.
 * To fully use database values, unset the corresponding environment variables.
 */
export async function PATCH(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as PatchThresholdsBody;

    if (body.thresholds === undefined || !Array.isArray(body.thresholds)) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: ['thresholds must be an array of { key, value } objects'],
        },
        { status: 400 }
      );
    }

    if (body.thresholds.length === 0) {
      return NextResponse.json(
        {
          error: 'No thresholds provided',
          details: ['thresholds array cannot be empty'],
        },
        { status: 400 }
      );
    }

    const validKeys = getValidThresholdKeys();
    const errors: string[] = [];
    const validUpdates: Array<{ key: ThresholdKey; value: number }> = [];

    for (const update of body.thresholds) {
      if (update.key === undefined || update.value === undefined) {
        errors.push('Each threshold must have key and value properties');
        continue;
      }

      if (!isValidThresholdKey(update.key)) {
        errors.push(`Invalid threshold key: ${update.key}. Valid keys: ${validKeys.join(', ')}`);
        continue;
      }

      const valueError = validateThresholdValue(update.key, update.value);
      if (valueError !== null) {
        errors.push(valueError);
        continue;
      }

      validUpdates.push({ key: update.key, value: update.value });
    }

    if (errors.length > 0 && validUpdates.length === 0) {
      return NextResponse.json(
        { error: 'All threshold updates failed validation', details: errors },
        { status: 400 }
      );
    }

    if (validUpdates.length > 0) {
      setThresholdOverrides(validUpdates);
      logger.info('Thresholds updated', { count: validUpdates.length, errors: errors.length });
    }

    const response: SuccessResponse = {
      success: true,
      message:
        errors.length > 0
          ? `Updated ${validUpdates.length} thresholds with ${errors.length} validation errors`
          : `Updated ${validUpdates.length} thresholds successfully`,
      updated: validUpdates,
      validationErrors: errors.length > 0 ? errors : undefined,
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Failed to update thresholds', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to update thresholds: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/settings/thresholds
 *
 * Removes all threshold overrides from the database,
 * reverting to environment variable or default values.
 */
export function DELETE(): NextResponse<{ success: boolean; deleted: number } | ErrorResponse> {
  try {
    const deleted = deleteAllThresholdOverrides();
    logger.info('All threshold overrides deleted', { deleted });

    return NextResponse.json({
      success: true,
      deleted,
    });
  } catch (error) {
    logger.error('Failed to delete threshold overrides', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to delete threshold overrides: ${errorMessage}` },
      { status: 500 }
    );
  }
}
