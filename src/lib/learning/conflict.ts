import type { Pattern, PatternType, PatternStatus } from '@/types';
import { listPatterns, updatePattern, getPatternById } from '@/db/models/patterns';
import { generateEmbedding } from '@/lib/embeddings/service';
import { createLogger } from '@/lib/logger';

const logger = createLogger('learning:conflict');

// Re-export PatternStatus for backwards compatibility
export type { PatternStatus };

/**
 * Result of resolving a conflict between two patterns.
 */
export interface ConflictResolution {
  winner: Pattern;
  loser: Pattern;
  reason: string;
  resolvedAt: string;
}

/**
 * Resolution log entry for debugging/auditing.
 */
export interface ResolutionLogEntry {
  winnerId: number;
  loserId: number;
  winnerDescription: string;
  loserDescription: string;
  reason: string;
  resolvedAt: string;
}

// In-memory resolution log for debugging (will be persisted in future task)
const resolutionLog: ResolutionLogEntry[] = [];

/**
 * Conflict detection for patterns with opposite sentiment/meaning.
 * Uses embeddings similarity + keyword analysis to find contradictory patterns.
 */

export interface ConflictMatch {
  pattern: Pattern;
  conflictScore: number;
  conflictType: 'semantic' | 'keyword' | 'both';
  reason: string;
}

export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: ConflictMatch[];
  checkedCount: number;
}

// Opposite sentiment indicators
const POSITIVE_INDICATORS = new Set([
  'use',
  'prefer',
  'include',
  'add',
  'more',
  'always',
  'good',
  'better',
  'best',
  'do',
  'should',
  'recommend',
  'embrace',
  'encourage',
  'favor',
  'yes',
  'positive',
]);

const NEGATIVE_INDICATORS = new Set([
  'avoid',
  'dont',
  "don't",
  'never',
  'less',
  'remove',
  'bad',
  'worse',
  'worst',
  'no',
  'not',
  'stop',
  'prevent',
  'discourage',
  'reject',
  'negative',
  'without',
]);

// Stop words to ignore in keyword analysis
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'of',
  'to',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'about',
  'like',
  'through',
  'after',
  'over',
  'between',
  'out',
  'against',
  'during',
  'without',
  'before',
  'under',
  'around',
  'among',
  'and',
  'but',
  'or',
  'nor',
  'so',
  'yet',
  'both',
  'either',
  'neither',
  'only',
  'own',
  'same',
  'than',
  'too',
  'very',
  'just',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
]);

// Similarity threshold for considering two patterns related (high = similar topic)
const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;

// Conflict score threshold - patterns with opposite sentiment AND high topic similarity
const CONFLICT_SCORE_THRESHOLD = 0.6;

/**
 * Extract sentiment from pattern description.
 * Returns: 1 for positive, -1 for negative, 0 for neutral
 */
function extractSentiment(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    if (POSITIVE_INDICATORS.has(word)) positiveCount++;
    if (NEGATIVE_INDICATORS.has(word)) negativeCount++;
  }

  if (positiveCount > negativeCount) return 1;
  if (negativeCount > positiveCount) return -1;
  return 0;
}

/**
 * Extract meaningful keywords from text.
 */
function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/**
 * Calculate keyword overlap between two texts (Jaccard similarity).
 */
function calculateKeywordOverlap(text1: string, text2: string): number {
  const keywords1 = extractKeywords(text1);
  const keywords2 = extractKeywords(text2);

  if (keywords1.size === 0 && keywords2.size === 0) return 0;
  if (keywords1.size === 0 || keywords2.size === 0) return 0;

  const intersection = [...keywords1].filter((k) => keywords2.has(k));
  const union = new Set([...keywords1, ...keywords2]);

  return intersection.length / union.size;
}

/**
 * Calculate cosine similarity between two embedding vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Check if two patterns have opposite sentiment.
 */
function hasOppositeSentiment(pattern1: string, pattern2: string): boolean {
  const sentiment1 = extractSentiment(pattern1);
  const sentiment2 = extractSentiment(pattern2);

  // Opposite sentiments: one positive, one negative
  return sentiment1 !== 0 && sentiment2 !== 0 && sentiment1 !== sentiment2;
}

/**
 * Calculate conflict score between two patterns.
 * High score = patterns discuss similar topic but with opposite sentiment.
 */
function calculateConflictScore(
  keywordOverlap: number,
  semanticSimilarity: number,
  hasOpposite: boolean
): number {
  if (!hasOpposite) return 0;

  // Both high keyword overlap and semantic similarity indicate same topic
  const topicRelatedness = Math.max(keywordOverlap, semanticSimilarity);

  // Conflict = same topic + opposite sentiment
  return topicRelatedness * (hasOpposite ? 1 : 0);
}

/**
 * Generate a human-readable reason for the conflict.
 */
function generateConflictReason(
  newPattern: string,
  existingPattern: Pattern,
  conflictType: 'semantic' | 'keyword' | 'both'
): string {
  const newSentiment = extractSentiment(newPattern) > 0 ? 'positive' : 'negative';
  const existingSentiment =
    extractSentiment(existingPattern.description) > 0 ? 'positive' : 'negative';

  switch (conflictType) {
    case 'semantic':
      return `Semantic conflict: "${newPattern.slice(0, 50)}..." (${newSentiment}) conflicts with "${existingPattern.description.slice(0, 50)}..." (${existingSentiment})`;
    case 'keyword':
      return `Keyword conflict: Both patterns discuss similar concepts but with opposite intent`;
    case 'both':
      return `Strong conflict: Both semantic meaning and keywords indicate contradictory guidance`;
    default:
      return 'Pattern conflict detected';
  }
}

/**
 * Detect conflicts between a new pattern and existing patterns.
 * Uses both keyword analysis (fast) and embeddings similarity (accurate).
 *
 * @param newPatternDescription - The description of the new pattern to check
 * @param patternType - Type of pattern to check against (same type only)
 * @param options - Detection options
 * @returns Conflict detection result with matches
 */
export async function detectConflicts(
  newPatternDescription: string,
  patternType: PatternType,
  options: {
    useEmbeddings?: boolean;
    keywordThreshold?: number;
    semanticThreshold?: number;
    conflictThreshold?: number;
    limit?: number;
  } = {}
): Promise<ConflictDetectionResult> {
  const {
    useEmbeddings = true,
    keywordThreshold = 0.3,
    semanticThreshold = SEMANTIC_SIMILARITY_THRESHOLD,
    conflictThreshold = CONFLICT_SCORE_THRESHOLD,
    limit = 100,
  } = options;

  logger.debug('Detecting conflicts for pattern', {
    description: newPatternDescription.slice(0, 100),
    type: patternType,
  });

  // Get existing patterns of the same type
  const existingPatterns = listPatterns({ patternType, limit });

  if (existingPatterns.length === 0) {
    return { hasConflicts: false, conflicts: [], checkedCount: 0 };
  }

  const conflicts: ConflictMatch[] = [];
  let newEmbedding: number[] | null = null;

  // Generate embedding for new pattern if using semantic analysis
  if (useEmbeddings) {
    try {
      const result = await generateEmbedding(newPatternDescription);
      newEmbedding = result.embedding;
    } catch (err) {
      logger.warn('Failed to generate embedding, falling back to keyword-only', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Check each existing pattern for conflicts
  for (const existingPattern of existingPatterns) {
    // Skip if sentiments aren't opposite (quick filter)
    const hasOpposite = hasOppositeSentiment(newPatternDescription, existingPattern.description);
    if (!hasOpposite) continue;

    // Calculate keyword overlap
    const keywordOverlap = calculateKeywordOverlap(
      newPatternDescription,
      existingPattern.description
    );

    let semanticSimilarity = 0;
    let conflictType: 'semantic' | 'keyword' | 'both' = 'keyword';

    // Calculate semantic similarity if embeddings available
    if (newEmbedding && useEmbeddings) {
      try {
        const existingResult = await generateEmbedding(existingPattern.description);
        semanticSimilarity = cosineSimilarity(newEmbedding, existingResult.embedding);
      } catch {
        // Continue with keyword-only if embedding fails
      }
    }

    // Determine conflict type
    const hasKeywordConflict = keywordOverlap >= keywordThreshold;
    const hasSemanticConflict = semanticSimilarity >= semanticThreshold;

    if (hasKeywordConflict && hasSemanticConflict) {
      conflictType = 'both';
    } else if (hasSemanticConflict) {
      conflictType = 'semantic';
    } else if (hasKeywordConflict) {
      conflictType = 'keyword';
    } else {
      continue; // No significant overlap
    }

    // Calculate overall conflict score
    const conflictScore = calculateConflictScore(keywordOverlap, semanticSimilarity, hasOpposite);

    if (conflictScore >= conflictThreshold || hasKeywordConflict || hasSemanticConflict) {
      conflicts.push({
        pattern: existingPattern,
        conflictScore: Math.max(conflictScore, keywordOverlap, semanticSimilarity),
        conflictType,
        reason: generateConflictReason(newPatternDescription, existingPattern, conflictType),
      });
    }
  }

  // Sort by conflict score (highest first)
  conflicts.sort((a, b) => b.conflictScore - a.conflictScore);

  logger.debug('Conflict detection complete', {
    checkedCount: existingPatterns.length,
    conflictsFound: conflicts.length,
  });

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    checkedCount: existingPatterns.length,
  };
}

/**
 * Quick conflict check using keyword analysis only (no API calls).
 * Use this for fast pre-filtering before full conflict detection.
 */
export function detectConflictsSync(
  newPatternDescription: string,
  patternType: PatternType,
  options: {
    keywordThreshold?: number;
    limit?: number;
  } = {}
): ConflictDetectionResult {
  const { keywordThreshold = 0.3, limit = 100 } = options;

  const existingPatterns = listPatterns({ patternType, limit });

  if (existingPatterns.length === 0) {
    return { hasConflicts: false, conflicts: [], checkedCount: 0 };
  }

  const conflicts: ConflictMatch[] = [];

  for (const existingPattern of existingPatterns) {
    const hasOpposite = hasOppositeSentiment(newPatternDescription, existingPattern.description);
    if (!hasOpposite) continue;

    const keywordOverlap = calculateKeywordOverlap(
      newPatternDescription,
      existingPattern.description
    );

    if (keywordOverlap >= keywordThreshold) {
      conflicts.push({
        pattern: existingPattern,
        conflictScore: keywordOverlap,
        conflictType: 'keyword',
        reason: generateConflictReason(newPatternDescription, existingPattern, 'keyword'),
      });
    }
  }

  conflicts.sort((a, b) => b.conflictScore - a.conflictScore);

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    checkedCount: existingPatterns.length,
  };
}

/**
 * Resolve a conflict between two patterns.
 * The more recent pattern wins, and the older pattern is marked as superseded.
 *
 * Resolution strategy: Recent pattern wins because user preferences evolve.
 * A pattern created later represents more recent guidance.
 *
 * @param pattern1 - First conflicting pattern
 * @param pattern2 - Second conflicting pattern
 * @returns Resolution result with winner and loser
 */
export function resolveConflict(pattern1: Pattern, pattern2: Pattern): ConflictResolution {
  // Determine winner by creation date (most recent wins)
  const date1 = new Date(pattern1.createdAt).getTime();
  const date2 = new Date(pattern2.createdAt).getTime();

  const winner = date1 >= date2 ? pattern1 : pattern2;
  const loser = date1 >= date2 ? pattern2 : pattern1;

  const reason = `Recent pattern wins: "${winner.description.slice(0, 50)}..." (${winner.createdAt}) supersedes "${loser.description.slice(0, 50)}..." (${loser.createdAt})`;

  // Log resolution for debugging
  const logEntry: ResolutionLogEntry = {
    winnerId: winner.id,
    loserId: loser.id,
    winnerDescription: winner.description,
    loserDescription: loser.description,
    reason,
    resolvedAt: new Date().toISOString(),
  };

  resolutionLog.push(logEntry);

  logger.info('Conflict resolved', {
    winnerId: winner.id,
    loserId: loser.id,
    reason,
  });

  return {
    winner,
    loser,
    reason,
    resolvedAt: logEntry.resolvedAt,
  };
}

/**
 * Resolve conflict and persist the status change to the database.
 * Marks the losing pattern as superseded using the status field.
 *
 * @param pattern1 - First conflicting pattern
 * @param pattern2 - Second conflicting pattern
 * @returns Resolution result with updated patterns
 */
export function resolveConflictAndPersist(
  pattern1: Pattern,
  pattern2: Pattern
): ConflictResolution | null {
  const resolution = resolveConflict(pattern1, pattern2);

  // Mark loser as superseded using the status field (MEM-008)
  const updatedLoser = updatePattern(resolution.loser.id, {
    status: 'superseded',
  });

  if (!updatedLoser) {
    logger.error('Failed to update loser pattern', { loserId: resolution.loser.id });
    return null;
  }

  // Refresh winner pattern to get latest state
  const updatedWinner = getPatternById(resolution.winner.id);
  if (!updatedWinner) {
    logger.error('Failed to get winner pattern', { winnerId: resolution.winner.id });
    return null;
  }

  return {
    ...resolution,
    winner: updatedWinner,
    loser: updatedLoser,
  };
}

/**
 * Resolve all detected conflicts in a batch.
 * Useful when multiple conflicts are found for a new pattern.
 *
 * @param newPattern - The newly added pattern
 * @param conflicts - List of conflicting patterns to resolve against
 * @returns Array of resolution results
 */
export function resolveAllConflicts(
  newPattern: Pattern,
  conflicts: ConflictMatch[]
): ConflictResolution[] {
  return conflicts.map((conflict) => resolveConflict(newPattern, conflict.pattern));
}

/**
 * Get the resolution log for debugging purposes.
 */
export function getResolutionLog(): ReadonlyArray<ResolutionLogEntry> {
  return [...resolutionLog];
}

/**
 * Clear the resolution log (for testing).
 */
export function clearResolutionLog(): void {
  resolutionLog.length = 0;
}

// Export utilities for testing
export const _internal = {
  extractSentiment,
  extractKeywords,
  calculateKeywordOverlap,
  cosineSimilarity,
  hasOppositeSentiment,
  calculateConflictScore,
};
