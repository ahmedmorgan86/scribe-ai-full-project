/**
 * Centralized Validation Thresholds Configuration
 *
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR VALIDATION THRESHOLDS           ║
 * ║                                                                               ║
 * ║  Python workers MUST fetch thresholds from /api/config/thresholds            ║
 * ║  DO NOT hardcode threshold values in Python code.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 *
 * Thresholds control:
 * - Voice similarity matching (embedding similarity)
 * - Slop detection scoring
 * - Stylometric validation
 * - Duplicate detection
 * - Source deduplication
 */

/**
 * Voice validation thresholds.
 */
export const VOICE_THRESHOLDS = {
  /** Minimum embedding similarity for voice match (0-1). Default: 0.7 */
  similarity: parseFloat(process.env.VOICE_SIMILARITY_THRESHOLD ?? '0.7'),

  /** Minimum overall confidence score to pass (0-100). Default: 70 */
  minConfidence: parseInt(process.env.VOICE_MIN_CONFIDENCE ?? '70', 10),

  /** Minimum score per dimension (voice, hook, topic, originality) (0-100). Default: 50 */
  minDimensionScore: parseInt(process.env.VOICE_MIN_DIMENSION_SCORE ?? '50', 10),

  /** Voice contrast deviation threshold (0-1). Default: 0.6 */
  contrastThreshold: parseFloat(process.env.VOICE_CONTRAST_THRESHOLD ?? '0.6'),
} as const;

/**
 * Slop detection thresholds.
 */
export const SLOP_THRESHOLDS = {
  /** Maximum slop score before rejection (0-100). Default: 30 */
  maxScore: parseInt(process.env.SLOP_MAX_SCORE ?? '30', 10),

  /** Slop score that triggers warning (0-100). Default: 20 */
  warningScore: parseInt(process.env.SLOP_WARNING_SCORE ?? '20', 10),

  /** Semantic similarity threshold against AI corpus (0-1). Default: 0.85 */
  semanticThreshold: parseFloat(process.env.SLOP_SEMANTIC_THRESHOLD ?? '0.85'),
} as const;

/**
 * Stylometric validation thresholds.
 */
export const STYLOMETRY_THRESHOLDS = {
  /** Minimum stylometric similarity score (0-1). Default: 0.7 */
  similarity: parseFloat(process.env.STYLOMETRY_SIMILARITY_THRESHOLD ?? '0.7'),

  /** Minimum dimensions required for valid comparison. Default: 3 */
  minDimensions: parseInt(process.env.STYLOMETRY_MIN_DIMENSIONS ?? '3', 10),

  /** Maximum drift from baseline before alert (0-1). Default: 0.15 */
  maxDrift: parseFloat(process.env.STYLOMETRY_MAX_DRIFT ?? '0.15'),

  /** Language for function word analysis. Options: 'en', 'de', 'es', 'auto'. Default: 'en' */
  language: (process.env.STYLOMETRY_LANGUAGE ?? 'en') as 'en' | 'de' | 'es' | 'auto',
} as const;

/**
 * Stylometric dimension weights for signature comparison.
 * Weights must sum to 1.0 for proper normalization.
 */
export const STYLOMETRY_DIMENSION_WEIGHTS = {
  /** Weight for sentence length dimension (0-1). Default: 0.25 */
  sentenceLength: parseFloat(process.env.STYLOMETRY_WEIGHT_SENTENCE_LENGTH ?? '0.25'),

  /** Weight for punctuation patterns dimension (0-1). Default: 0.15 */
  punctuation: parseFloat(process.env.STYLOMETRY_WEIGHT_PUNCTUATION ?? '0.15'),

  /** Weight for vocabulary richness dimension (0-1). Default: 0.20 */
  vocabulary: parseFloat(process.env.STYLOMETRY_WEIGHT_VOCABULARY ?? '0.20'),

  /** Weight for function words dimension (0-1). Default: 0.25 */
  functionWords: parseFloat(process.env.STYLOMETRY_WEIGHT_FUNCTION_WORDS ?? '0.25'),

  /** Weight for syntactic complexity dimension (0-1). Default: 0.15 */
  syntactic: parseFloat(process.env.STYLOMETRY_WEIGHT_SYNTACTIC ?? '0.15'),
} as const;

export type StylometryDimensionWeights = typeof STYLOMETRY_DIMENSION_WEIGHTS;

/**
 * Duplicate detection thresholds.
 */
export const DUPLICATE_THRESHOLDS = {
  /** Similarity threshold for post duplicate detection (0-1). Default: 0.8 */
  postSimilarity: parseFloat(process.env.DUPLICATE_POST_THRESHOLD ?? '0.8'),

  /** Similarity threshold for source deduplication (0-1). Default: 0.85 */
  sourceSimilarity: parseFloat(process.env.DUPLICATE_SOURCE_THRESHOLD ?? '0.85'),
} as const;

/**
 * Learning system thresholds.
 */
export const LEARNING_THRESHOLDS = {
  /** Base threshold for stuck detection (consecutive rejections). Default: 5 */
  stuckBaseThreshold: parseInt(process.env.STUCK_BASE_THRESHOLD ?? '5', 10),

  /** Pattern similarity threshold for grouping. Default: 0.5 */
  patternSimilarity: parseFloat(process.env.PATTERN_SIMILARITY_THRESHOLD ?? '0.5'),
} as const;

/**
 * All thresholds combined for easy export.
 */
export const THRESHOLDS = {
  voice: VOICE_THRESHOLDS,
  slop: SLOP_THRESHOLDS,
  stylometry: STYLOMETRY_THRESHOLDS,
  stylometryWeights: STYLOMETRY_DIMENSION_WEIGHTS,
  duplicate: DUPLICATE_THRESHOLDS,
  learning: LEARNING_THRESHOLDS,
} as const;

export type ThresholdsConfig = typeof THRESHOLDS;

/**
 * Get all thresholds as a JSON-serializable object.
 * Used by /api/config/thresholds endpoint for Python workers.
 */
export function getThresholdsAsJson(): ThresholdsConfig {
  return {
    voice: { ...VOICE_THRESHOLDS },
    slop: { ...SLOP_THRESHOLDS },
    stylometry: { ...STYLOMETRY_THRESHOLDS },
    stylometryWeights: { ...STYLOMETRY_DIMENSION_WEIGHTS },
    duplicate: { ...DUPLICATE_THRESHOLDS },
    learning: { ...LEARNING_THRESHOLDS },
  };
}

/**
 * Validate that all thresholds are within acceptable ranges.
 * Returns errors for any invalid values.
 */
export function validateThresholds(): string[] {
  const errors: string[] = [];

  // Voice thresholds
  if (VOICE_THRESHOLDS.similarity < 0 || VOICE_THRESHOLDS.similarity > 1) {
    errors.push(`VOICE_SIMILARITY_THRESHOLD must be 0-1, got ${VOICE_THRESHOLDS.similarity}`);
  }
  if (VOICE_THRESHOLDS.minConfidence < 0 || VOICE_THRESHOLDS.minConfidence > 100) {
    errors.push(`VOICE_MIN_CONFIDENCE must be 0-100, got ${VOICE_THRESHOLDS.minConfidence}`);
  }
  if (VOICE_THRESHOLDS.minDimensionScore < 0 || VOICE_THRESHOLDS.minDimensionScore > 100) {
    errors.push(
      `VOICE_MIN_DIMENSION_SCORE must be 0-100, got ${VOICE_THRESHOLDS.minDimensionScore}`
    );
  }
  if (VOICE_THRESHOLDS.contrastThreshold < 0 || VOICE_THRESHOLDS.contrastThreshold > 1) {
    errors.push(`VOICE_CONTRAST_THRESHOLD must be 0-1, got ${VOICE_THRESHOLDS.contrastThreshold}`);
  }

  // Slop thresholds
  if (SLOP_THRESHOLDS.maxScore < 0 || SLOP_THRESHOLDS.maxScore > 100) {
    errors.push(`SLOP_MAX_SCORE must be 0-100, got ${SLOP_THRESHOLDS.maxScore}`);
  }
  if (SLOP_THRESHOLDS.warningScore < 0 || SLOP_THRESHOLDS.warningScore > 100) {
    errors.push(`SLOP_WARNING_SCORE must be 0-100, got ${SLOP_THRESHOLDS.warningScore}`);
  }
  if (SLOP_THRESHOLDS.semanticThreshold < 0 || SLOP_THRESHOLDS.semanticThreshold > 1) {
    errors.push(`SLOP_SEMANTIC_THRESHOLD must be 0-1, got ${SLOP_THRESHOLDS.semanticThreshold}`);
  }

  // Stylometry thresholds
  if (STYLOMETRY_THRESHOLDS.similarity < 0 || STYLOMETRY_THRESHOLDS.similarity > 1) {
    errors.push(
      `STYLOMETRY_SIMILARITY_THRESHOLD must be 0-1, got ${STYLOMETRY_THRESHOLDS.similarity}`
    );
  }
  if (STYLOMETRY_THRESHOLDS.minDimensions < 1) {
    errors.push(
      `STYLOMETRY_MIN_DIMENSIONS must be >= 1, got ${STYLOMETRY_THRESHOLDS.minDimensions}`
    );
  }
  if (STYLOMETRY_THRESHOLDS.maxDrift < 0 || STYLOMETRY_THRESHOLDS.maxDrift > 1) {
    errors.push(`STYLOMETRY_MAX_DRIFT must be 0-1, got ${STYLOMETRY_THRESHOLDS.maxDrift}`);
  }
  const validLanguages = ['en', 'de', 'es', 'auto'];
  if (!validLanguages.includes(STYLOMETRY_THRESHOLDS.language)) {
    errors.push(
      `STYLOMETRY_LANGUAGE must be one of ${validLanguages.join(', ')}, got ${STYLOMETRY_THRESHOLDS.language}`
    );
  }

  // Stylometry dimension weights validation
  const weightSum =
    STYLOMETRY_DIMENSION_WEIGHTS.sentenceLength +
    STYLOMETRY_DIMENSION_WEIGHTS.punctuation +
    STYLOMETRY_DIMENSION_WEIGHTS.vocabulary +
    STYLOMETRY_DIMENSION_WEIGHTS.functionWords +
    STYLOMETRY_DIMENSION_WEIGHTS.syntactic;
  if (Math.abs(weightSum - 1.0) > 0.001) {
    errors.push(`Stylometry dimension weights must sum to 1.0, got ${weightSum.toFixed(3)}`);
  }
  for (const [key, value] of Object.entries(STYLOMETRY_DIMENSION_WEIGHTS)) {
    if (value < 0 || value > 1) {
      errors.push(`STYLOMETRY_WEIGHT_${key.toUpperCase()} must be 0-1, got ${value}`);
    }
  }

  // Duplicate thresholds
  if (DUPLICATE_THRESHOLDS.postSimilarity < 0 || DUPLICATE_THRESHOLDS.postSimilarity > 1) {
    errors.push(`DUPLICATE_POST_THRESHOLD must be 0-1, got ${DUPLICATE_THRESHOLDS.postSimilarity}`);
  }
  if (DUPLICATE_THRESHOLDS.sourceSimilarity < 0 || DUPLICATE_THRESHOLDS.sourceSimilarity > 1) {
    errors.push(
      `DUPLICATE_SOURCE_THRESHOLD must be 0-1, got ${DUPLICATE_THRESHOLDS.sourceSimilarity}`
    );
  }

  // Learning thresholds
  if (LEARNING_THRESHOLDS.stuckBaseThreshold < 1) {
    errors.push(`STUCK_BASE_THRESHOLD must be >= 1, got ${LEARNING_THRESHOLDS.stuckBaseThreshold}`);
  }
  if (LEARNING_THRESHOLDS.patternSimilarity < 0 || LEARNING_THRESHOLDS.patternSimilarity > 1) {
    errors.push(
      `PATTERN_SIMILARITY_THRESHOLD must be 0-1, got ${LEARNING_THRESHOLDS.patternSimilarity}`
    );
  }

  return errors;
}
