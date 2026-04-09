import { updatePattern, getPatternById } from '@/db/models/patterns';
import { Pattern } from '@/types';
import { getEngagementMultiplier } from './engagement-patterns';

/**
 * Calculate decay score for a pattern based on recency and access frequency.
 * Formula: accessCount / (1 + daysSince/30)
 *
 * - High access count + recent access = high score
 * - Low access count + old access = low score
 * - Patterns accessed recently maintain higher scores
 * - Score decays by ~50% every 30 days without access
 *
 * @param lastAccessed - ISO timestamp of last access (or null for never accessed)
 * @param accessCount - Number of times pattern was accessed
 * @returns Decay score (higher = more relevant)
 */
export function calculateDecayScore(lastAccessed: string | null, accessCount: number): number {
  // Zero or negative access count = no relevance
  if (accessCount <= 0) {
    return 0;
  }

  // Never accessed but has positive count = return raw count
  if (!lastAccessed) {
    return accessCount;
  }

  const lastAccessedDate = new Date(lastAccessed);

  // Invalid date = treat as never accessed
  if (isNaN(lastAccessedDate.getTime())) {
    return accessCount;
  }

  const now = new Date();
  const daysSince = Math.max(
    0,
    (now.getTime() - lastAccessedDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Formula: accessCount / (1 + daysSince/30)
  return accessCount / (1 + daysSince / 30);
}

/**
 * Update a pattern's access tracking and recalculate decay score.
 * Called when a pattern is retrieved for content generation.
 *
 * @param patternId - ID of the pattern to update
 * @returns Updated pattern or null if not found
 */
export function updatePatternAccess(patternId: number): Pattern | null {
  const pattern = getPatternById(patternId);
  if (!pattern) {
    return null;
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const newAccessCount = pattern.accessCount + 1;
  const newDecayScore = calculateDecayScore(now, newAccessCount);

  return updatePattern(patternId, {
    lastAccessedAt: now,
    accessCount: newAccessCount,
    decayScore: newDecayScore,
  });
}

/**
 * Calculate effective decay score for a pattern, incorporating engagement data.
 * The base time-based decay is multiplied by an engagement factor:
 * - High engagement posts boost the multiplier (up to 1.5x)
 * - Low engagement posts reduce the multiplier (down to 0.5x)
 * - No engagement data uses a neutral multiplier (1.0x)
 *
 * @param pattern - Pattern to calculate effective decay for
 * @returns Effective decay score clamped between 0.01 and 1.0
 */
export function calculateEffectiveDecay(pattern: Pattern): number {
  const baseDecay = calculateTimeDecay(pattern);
  const engagementMultiplier = getEngagementMultiplier(pattern.id);
  return Math.max(0.01, Math.min(1.0, baseDecay * engagementMultiplier));
}

/**
 * Calculate time-based decay normalized to 0-1 range.
 * Uses the pattern's stored decay score or calculates from access data.
 *
 * @param pattern - Pattern to calculate time decay for
 * @returns Time-based decay score normalized to 0-1 range
 */
export function calculateTimeDecay(pattern: Pattern): number {
  // If pattern has a stored decay score, normalize it
  if (pattern.decayScore > 0) {
    // Normalize based on typical access count ranges
    // Score of 10 = 1.0, score of 0 = 0.0
    return Math.min(1.0, pattern.decayScore / 10);
  }

  // Calculate from access data
  const rawScore = calculateDecayScore(pattern.lastAccessedAt, pattern.accessCount);
  return Math.min(1.0, rawScore / 10);
}
