/**
 * Stylometric validation gate for content generation.
 * Validates draft content against the persona's established stylometric signature.
 */

import { createLogger } from '@/lib/logger';
import {
  generateSignature,
  compareSignaturesDetailed,
  loadPersonaSignature,
  StyleSignature,
  SignatureComparisonResult,
} from './signature';

const logger = createLogger('voice:stylometric-validator');

const DEFAULT_THRESHOLD = 0.7;
// Minimum acceptable score for any single dimension
// Prevents passing with extreme deviations in one area (e.g., 100% exclamation marks)
const MIN_DIMENSION_THRESHOLD = 0.3;

export interface StylometricValidationResult {
  pass: boolean;
  score: number;
  threshold: number;
  dimensionScores: {
    sentenceLength: number;
    punctuation: number;
    vocabulary: number;
    functionWords: number;
    syntactic: number;
  };
  feedback: string;
  detailedFeedback: string[];
}

export interface ValidatorOptions {
  threshold?: number;
  personaSignature?: StyleSignature;
}

/**
 * Check if any dimension score is below the minimum acceptable threshold.
 * Returns the names of dimensions that are critically low.
 */
function getCriticallyLowDimensions(
  dimensionScores: SignatureComparisonResult['dimensionScores']
): string[] {
  const criticallyLow: string[] = [];
  if (dimensionScores.sentenceLength < MIN_DIMENSION_THRESHOLD) {
    criticallyLow.push('sentenceLength');
  }
  if (dimensionScores.punctuation < MIN_DIMENSION_THRESHOLD) {
    criticallyLow.push('punctuation');
  }
  if (dimensionScores.vocabulary < MIN_DIMENSION_THRESHOLD) {
    criticallyLow.push('vocabulary');
  }
  if (dimensionScores.functionWords < MIN_DIMENSION_THRESHOLD) {
    criticallyLow.push('functionWords');
  }
  if (dimensionScores.syntactic < MIN_DIMENSION_THRESHOLD) {
    criticallyLow.push('syntactic');
  }
  return criticallyLow;
}

function generateActionableFeedback(
  draft: StyleSignature,
  persona: StyleSignature,
  comparison: SignatureComparisonResult
): string {
  const issues: string[] = [];

  if (comparison.dimensionScores.sentenceLength < 0.7) {
    const draftMean = draft.sentenceLength.mean;
    const personaMean = persona.sentenceLength.mean;
    if (draftMean > personaMean + 5) {
      issues.push(
        `Sentences too long (avg ${draftMean.toFixed(0)} vs target ${personaMean.toFixed(0)})`
      );
    } else if (draftMean < personaMean - 5) {
      issues.push(
        `Sentences too short (avg ${draftMean.toFixed(0)} vs target ${personaMean.toFixed(0)})`
      );
    }
  }

  if (comparison.dimensionScores.punctuation < 0.7) {
    if (draft.punctuation.exclamationRate > persona.punctuation.exclamationRate * 2) {
      issues.push('Too many exclamation marks');
    }
    if (draft.punctuation.questionRate > persona.punctuation.questionRate * 2) {
      issues.push('Too many question marks');
    }
    if (draft.punctuation.ellipsisRate > persona.punctuation.ellipsisRate * 2) {
      issues.push('Overusing ellipses');
    }
    if (draft.punctuation.commaRate < persona.punctuation.commaRate * 0.5) {
      issues.push('Consider adding more commas for rhythm');
    }
  }

  if (comparison.dimensionScores.vocabulary < 0.7) {
    if (draft.vocabulary.typeTokenRatio < persona.vocabulary.typeTokenRatio - 0.1) {
      issues.push('Vocabulary too repetitive');
    } else if (draft.vocabulary.typeTokenRatio > persona.vocabulary.typeTokenRatio + 0.15) {
      issues.push('Vocabulary complexity too high');
    }
  }

  if (comparison.dimensionScores.functionWords < 0.7) {
    issues.push('Function word pattern differs from established voice');
  }

  if (comparison.dimensionScores.syntactic < 0.7) {
    if (draft.syntactic.avgClauseDepth > persona.syntactic.avgClauseDepth + 0.5) {
      issues.push('Sentence structure too complex');
    } else if (draft.syntactic.avgClauseDepth < persona.syntactic.avgClauseDepth - 0.3) {
      issues.push('Sentence structure too simple');
    }
  }

  if (issues.length === 0) {
    if (comparison.feedback.length === 0) {
      return 'Minor style variations detected';
    }
    return comparison.feedback[0];
  }

  return issues.join('; ');
}

export async function validate(
  draft: string,
  options: ValidatorOptions = {}
): Promise<StylometricValidationResult> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  let personaSignature: StyleSignature | null | undefined = options.personaSignature;
  if (!personaSignature) {
    personaSignature = await loadPersonaSignature();
  }

  if (!personaSignature) {
    logger.warn('No persona signature available, passing validation by default');
    return {
      pass: true,
      score: 1,
      threshold,
      dimensionScores: {
        sentenceLength: 1,
        punctuation: 1,
        vocabulary: 1,
        functionWords: 1,
        syntactic: 1,
      },
      feedback: 'No persona signature available for comparison',
      detailedFeedback: [],
    };
  }

  const draftSignature = generateSignature(draft);
  const comparison = compareSignaturesDetailed(draftSignature, personaSignature);

  // Check for critically low dimensions (fails validation even if overall score passes)
  const criticallyLow = getCriticallyLowDimensions(comparison.dimensionScores);
  const pass = comparison.overallSimilarity >= threshold && criticallyLow.length === 0;

  const feedback = pass
    ? 'Stylometric validation passed'
    : criticallyLow.length > 0
      ? `Critical deviation in: ${criticallyLow.join(', ')}`
      : generateActionableFeedback(draftSignature, personaSignature, comparison);

  logger.debug('Stylometric validation result', {
    pass,
    score: comparison.overallSimilarity,
    threshold,
    dimensions: comparison.dimensionScores,
    criticallyLow,
  });

  return {
    pass,
    score: comparison.overallSimilarity,
    threshold,
    dimensionScores: comparison.dimensionScores,
    feedback,
    detailedFeedback: comparison.feedback,
  };
}

export async function validateWithSignature(
  draft: string,
  personaSignature: StyleSignature,
  threshold: number = DEFAULT_THRESHOLD
): Promise<StylometricValidationResult> {
  return validate(draft, { threshold, personaSignature });
}

export function validateSync(
  draft: string,
  personaSignature: StyleSignature,
  threshold: number = DEFAULT_THRESHOLD
): StylometricValidationResult {
  const draftSignature = generateSignature(draft);
  const comparison = compareSignaturesDetailed(draftSignature, personaSignature);

  // Check for critically low dimensions (fails validation even if overall score passes)
  const criticallyLow = getCriticallyLowDimensions(comparison.dimensionScores);
  const pass = comparison.overallSimilarity >= threshold && criticallyLow.length === 0;

  const feedback = pass
    ? 'Stylometric validation passed'
    : criticallyLow.length > 0
      ? `Critical deviation in: ${criticallyLow.join(', ')}`
      : generateActionableFeedback(draftSignature, personaSignature, comparison);

  return {
    pass,
    score: comparison.overallSimilarity,
    threshold,
    dimensionScores: comparison.dimensionScores,
    feedback,
    detailedFeedback: comparison.feedback,
  };
}

export { DEFAULT_THRESHOLD };
