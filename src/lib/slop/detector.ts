import type { SlopDetector, SlopResult } from '@/types';
import { checkForBannedPhrases, type PhraseCheckResult } from '@/lib/slop/phrase-blacklist';
import {
  checkStructuralPatterns,
  hasHighSeverityIssue,
  type StructuralCheckResult,
} from '@/lib/slop/structural';
import { checkSemanticSimilarity, type SemanticCheckResult } from '@/lib/slop/semantic';
import {
  checkVoiceContrast,
  hasHighSeverityDeviation,
  type VoiceContrastCheckResult,
} from '@/lib/slop/voice-contrast';
import {
  checkHumanizerPatterns,
  hasHighHumanizerScore,
  type HumanizerCheckResult,
} from '@/lib/slop/humanizer-patterns';

export interface SlopDetectionOptions {
  skipPhrase?: boolean;
  skipStructural?: boolean;
  skipSemantic?: boolean;
  skipVoiceContrast?: boolean;
  skipHumanizer?: boolean;
  semanticThreshold?: number;
  voiceContrastThreshold?: number;
  humanizerThreshold?: number;
}

export interface DetailedSlopResult extends SlopResult {
  phraseResult?: PhraseCheckResult;
  structuralResult?: StructuralCheckResult;
  semanticResult?: SemanticCheckResult;
  voiceContrastResult?: VoiceContrastCheckResult;
  humanizerResult?: HumanizerCheckResult;
  issues: SlopIssue[];
  suggestions: string[];
}

export interface SlopIssue {
  detector: SlopDetector;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export async function detectSlop(
  content: string,
  options: SlopDetectionOptions = {}
): Promise<DetailedSlopResult> {
  const {
    skipPhrase = false,
    skipStructural = false,
    skipSemantic = false,
    skipVoiceContrast = false,
    skipHumanizer = false,
  } = options;

  const detectedBy: SlopDetector[] = [];
  const issues: SlopIssue[] = [];
  const suggestions: string[] = [];
  let flagForReview = false;

  let phraseResult: PhraseCheckResult | undefined;
  let structuralResult: StructuralCheckResult | undefined;
  let semanticResult: SemanticCheckResult | undefined;
  let voiceContrastResult: VoiceContrastCheckResult | undefined;
  let humanizerResult: HumanizerCheckResult | undefined;

  if (!skipPhrase) {
    phraseResult = checkForBannedPhrases(content);
    if (phraseResult.hasBannedPhrases) {
      detectedBy.push('phrase');
      for (const match of phraseResult.matches) {
        issues.push({
          detector: 'phrase',
          description: `Banned phrase detected: "${match.phrase}"`,
          severity: 'high',
        });
      }
      suggestions.push('Remove or rephrase banned AI-typical phrases');
    }
  }

  if (!skipStructural) {
    structuralResult = checkStructuralPatterns(content);
    if (structuralResult.hasIssues) {
      detectedBy.push('structural');
      for (const issue of structuralResult.issues) {
        issues.push({
          detector: 'structural',
          description: issue.description,
          severity: issue.severity,
        });
      }
      if (hasHighSeverityIssue(structuralResult)) {
        suggestions.push('Address high-severity structural issues (hashtags, listicle format)');
      } else {
        suggestions.push('Consider reducing emoji count or filler words');
      }
    }
  }

  if (!skipSemantic) {
    semanticResult = await checkSemanticSimilarity(content, {
      threshold: options.semanticThreshold,
    });
    if (semanticResult.isSlop) {
      detectedBy.push('semantic');
      flagForReview = true;
      issues.push({
        detector: 'semantic',
        description: `High similarity to known AI content (${(semanticResult.maxSimilarity * 100).toFixed(1)}%)`,
        severity: 'high',
      });
      suggestions.push(
        'Rewrite with more original phrasing - content too similar to known AI slop'
      );
    }
  }

  if (!skipVoiceContrast) {
    voiceContrastResult = await checkVoiceContrast(content, {
      similarityThreshold: options.voiceContrastThreshold,
    });
    if (voiceContrastResult.isDeviation) {
      detectedBy.push('voice-contrast');
      if (hasHighSeverityDeviation(voiceContrastResult)) {
        flagForReview = true;
      }
      for (const issue of voiceContrastResult.issues) {
        issues.push({
          detector: 'voice-contrast',
          description: issue.description,
          severity: issue.severity,
        });
      }
      suggestions.push('Adjust content to better match established voice patterns');
    }
  }

  if (!skipHumanizer) {
    humanizerResult = checkHumanizerPatterns(content);
    const threshold = options.humanizerThreshold ?? 50;
    if (humanizerResult.hasIssues && hasHighHumanizerScore(humanizerResult, threshold)) {
      detectedBy.push('humanizer');
      for (const pattern of humanizerResult.patterns) {
        issues.push({
          detector: 'humanizer',
          description: `${pattern.description}: ${pattern.matches
            .slice(0, 2)
            .map((m) => `"${m}"`)
            .join(', ')}`,
          severity: pattern.severity,
        });
      }
      suggestions.push('Rewrite to reduce AI-sounding patterns (see humanizer suggestions)');
    }
  }

  return {
    isSlop: detectedBy.length > 0,
    detectedBy,
    flagForReview,
    phraseResult,
    structuralResult,
    semanticResult,
    voiceContrastResult,
    humanizerResult,
    issues,
    suggestions,
  };
}

export function toSlopResult(detailed: DetailedSlopResult): SlopResult {
  return {
    isSlop: detailed.isSlop,
    detectedBy: detailed.detectedBy,
    flagForReview: detailed.flagForReview,
  };
}

export function shouldTriggerRewrite(result: DetailedSlopResult): boolean {
  if (!result.isSlop) return false;

  const hasPhrase = result.detectedBy.includes('phrase');
  const hasStructural = result.detectedBy.includes('structural');

  if (hasPhrase || hasStructural) {
    const hasSemantic = result.detectedBy.includes('semantic');
    const hasVoiceContrast = result.detectedBy.includes('voice-contrast');
    return !hasSemantic && !hasVoiceContrast;
  }

  return false;
}

export function getSlopSeverityScore(result: DetailedSlopResult): number {
  let score = 0;
  for (const issue of result.issues) {
    switch (issue.severity) {
      case 'high':
        score += 30;
        break;
      case 'medium':
        score += 15;
        break;
      case 'low':
        score += 5;
        break;
    }
  }
  return Math.min(100, score);
}

export function formatSlopDetectionResult(result: DetailedSlopResult): string {
  if (!result.isSlop) {
    return 'No slop detected. Content passes all checks.';
  }

  const lines = [
    `Slop detected by ${result.detectedBy.length} detector(s): ${result.detectedBy.join(', ')}`,
    `Flag for human review: ${result.flagForReview ? 'YES' : 'No'}`,
    '',
    `Issues (${result.issues.length}):`,
  ];

  for (const issue of result.issues) {
    const icon = issue.severity === 'high' ? '⚠' : issue.severity === 'medium' ? '!' : '·';
    lines.push(
      `  ${icon} [${issue.severity.toUpperCase()}] (${issue.detector}) ${issue.description}`
    );
  }

  if (result.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const suggestion of result.suggestions) {
      lines.push(`  → ${suggestion}`);
    }
  }

  return lines.join('\n');
}

export async function quickSlopCheck(
  content: string
): Promise<{ passed: boolean; reason: string }> {
  const result = await detectSlop(content, {
    skipSemantic: true,
    skipVoiceContrast: true,
  });

  if (!result.isSlop) {
    return { passed: true, reason: 'No slop detected in quick check' };
  }

  const highSeverityIssue = result.issues.find((i) => i.severity === 'high');
  if (highSeverityIssue) {
    return { passed: false, reason: highSeverityIssue.description };
  }

  return { passed: false, reason: `Slop detected: ${result.issues.length} issue(s)` };
}

export type HumanReviewReason = 'semantic_similarity' | 'voice_deviation' | 'both';

export interface HumanReviewInfo {
  needsReview: boolean;
  reason: HumanReviewReason | null;
  detectors: SlopDetector[];
  summary: string;
  semanticSimilarity: number | null;
  voiceDeviationSeverity: 'low' | 'medium' | 'high' | null;
  issues: SlopIssue[];
}

export function needsHumanReview(result: DetailedSlopResult): boolean {
  if (!result.flagForReview) return false;

  const hasSemantic = result.detectedBy.includes('semantic');
  const hasVoiceContrast = result.detectedBy.includes('voice-contrast');

  return hasSemantic || hasVoiceContrast;
}

export function getHumanReviewInfo(result: DetailedSlopResult): HumanReviewInfo {
  const hasSemantic = result.detectedBy.includes('semantic');
  const hasVoiceContrast = result.detectedBy.includes('voice-contrast');
  const needsReview = result.flagForReview && (hasSemantic || hasVoiceContrast);

  if (!needsReview) {
    return {
      needsReview: false,
      reason: null,
      detectors: [],
      summary: 'No human review needed',
      semanticSimilarity: null,
      voiceDeviationSeverity: null,
      issues: [],
    };
  }

  let reason: HumanReviewReason;
  if (hasSemantic && hasVoiceContrast) {
    reason = 'both';
  } else if (hasSemantic) {
    reason = 'semantic_similarity';
  } else {
    reason = 'voice_deviation';
  }

  const detectors: SlopDetector[] = [];
  if (hasSemantic) detectors.push('semantic');
  if (hasVoiceContrast) detectors.push('voice-contrast');

  const relevantIssues = result.issues.filter(
    (issue) => issue.detector === 'semantic' || issue.detector === 'voice-contrast'
  );

  const semanticSimilarity = result.semanticResult?.maxSimilarity ?? null;

  let voiceDeviationSeverity: 'low' | 'medium' | 'high' | null = null;
  if (result.voiceContrastResult?.isDeviation === true) {
    const voiceIssues = result.voiceContrastResult.issues;
    if (voiceIssues.some((i) => i.severity === 'high')) {
      voiceDeviationSeverity = 'high';
    } else if (voiceIssues.some((i) => i.severity === 'medium')) {
      voiceDeviationSeverity = 'medium';
    } else {
      voiceDeviationSeverity = 'low';
    }
  }

  const summaryParts: string[] = [];
  if (hasSemantic && semanticSimilarity !== null) {
    summaryParts.push(`${(semanticSimilarity * 100).toFixed(0)}% similar to known AI content`);
  }
  if (hasVoiceContrast && voiceDeviationSeverity) {
    summaryParts.push(`${voiceDeviationSeverity} voice deviation`);
  }

  return {
    needsReview: true,
    reason,
    detectors,
    summary: summaryParts.join('; ') || 'Requires human review',
    semanticSimilarity,
    voiceDeviationSeverity,
    issues: relevantIssues,
  };
}

export function formatHumanReviewInfo(info: HumanReviewInfo): string {
  if (!info.needsReview) {
    return 'No human review needed.';
  }

  const lines = [
    '=== HUMAN REVIEW REQUIRED ===',
    '',
    `Reason: ${info.reason === 'both' ? 'Semantic similarity AND voice deviation' : info.reason === 'semantic_similarity' ? 'High semantic similarity to AI content' : 'Voice deviation from learned patterns'}`,
    `Summary: ${info.summary}`,
    '',
  ];

  if (info.semanticSimilarity !== null) {
    lines.push(`Semantic similarity: ${(info.semanticSimilarity * 100).toFixed(1)}%`);
  }

  if (info.voiceDeviationSeverity) {
    lines.push(`Voice deviation severity: ${info.voiceDeviationSeverity.toUpperCase()}`);
  }

  if (info.issues.length > 0) {
    lines.push('', 'Issues requiring review:');
    for (const issue of info.issues) {
      lines.push(`  - [${issue.severity.toUpperCase()}] ${issue.description}`);
    }
  }

  return lines.join('\n');
}
