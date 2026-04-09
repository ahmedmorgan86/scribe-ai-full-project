import {
  createGenerationError,
  getPatternErrorRate as getPatternErrorRateFromDb,
  listGenerationErrors,
  countGenerationErrors,
  deleteOldGenerationErrors,
} from '@/db/models/generation-errors';

export type GenerationErrorType =
  | 'voice_mismatch'
  | 'slop_detected'
  | 'pattern_conflict'
  | 'generation_failed'
  | 'api_error'
  | 'timeout'
  | 'validation_failed';

export interface ErrorContext {
  sourceId?: number;
  postId?: number;
  patternsUsed?: number[];
  additionalInfo?: Record<string, unknown>;
}

/**
 * Logs a generation error to the database for persistent tracking.
 */
export function logGenerationError(
  type: GenerationErrorType,
  details: string,
  context?: ErrorContext
): string {
  const patternsUsed = context?.patternsUsed?.map(String);
  const errorDetails = JSON.stringify({
    message: details,
    sourceId: context?.sourceId,
    postId: context?.postId,
    ...context?.additionalInfo,
  });

  const error = createGenerationError({
    errorType: type,
    errorDetails,
    patternsUsed,
  });

  return error.id;
}

/**
 * Gets the error rate for a specific pattern.
 * Returns the number of errors where this pattern was used.
 */
export function getPatternErrorRate(patternId: number): number {
  return getPatternErrorRateFromDb(patternId);
}

/**
 * Gets recent errors of a specific type.
 */
export function getRecentErrors(
  type?: GenerationErrorType,
  limit: number = 50
): Array<{
  id: string;
  errorType: string;
  errorDetails: string | null;
  patternsUsed: number[];
  createdAt: string;
}> {
  const errors = listGenerationErrors({ errorType: type, limit });
  return errors.map((e) => ({
    id: e.id,
    errorType: e.errorType,
    errorDetails: e.errorDetails,
    patternsUsed: e.patternsUsed ? (JSON.parse(e.patternsUsed) as string[]).map(Number) : [],
    createdAt: e.createdAt,
  }));
}

/**
 * Gets error statistics for monitoring.
 */
export function getErrorStats(since?: Date): Record<string, number> {
  const sinceStr = since?.toISOString();
  const errors = listGenerationErrors({ since: sinceStr, limit: 1000 });

  const stats: Record<string, number> = {};
  for (const error of errors) {
    stats[error.errorType] = (stats[error.errorType] || 0) + 1;
  }

  return stats;
}

/**
 * Gets total error count, optionally filtered.
 */
export function getTotalErrorCount(type?: GenerationErrorType, since?: Date): number {
  return countGenerationErrors({
    errorType: type,
    since: since?.toISOString(),
  });
}

/**
 * Cleans up old error records.
 */
export function cleanupOldErrors(olderThanDays: number = 30): number {
  return deleteOldGenerationErrors(olderThanDays);
}
