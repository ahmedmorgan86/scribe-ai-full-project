import type { SlopDetector } from '@/types';
import { checkVoiceSimilarity } from '@/lib/voice/embeddings';
import { listPatterns } from '@/db/models/patterns';
import { checkVoiceCharacteristics } from '@/lib/voice/characteristics';

export interface VoiceContrastIssue {
  type: 'low_similarity' | 'pattern_violation' | 'characteristic_failure';
  description: string;
  severity: 'low' | 'medium' | 'high';
  details?: Record<string, unknown>;
}

export interface VoiceContrastCheckResult {
  isDeviation: boolean;
  issues: VoiceContrastIssue[];
  similarity: number;
  patternViolations: string[];
  detector: SlopDetector;
}

export interface VoiceContrastCheckOptions {
  similarityThreshold?: number;
  nResults?: number;
  minPatternEvidence?: number;
  skipSimilarityCheck?: boolean;
  skipPatternCheck?: boolean;
  skipCharacteristicsCheck?: boolean;
}

export const DEFAULT_VOICE_CONTRAST_THRESHOLD = 0.6;
export const DEFAULT_MIN_PATTERN_EVIDENCE = 3;

export async function checkVoiceContrast(
  content: string,
  options: VoiceContrastCheckOptions = {}
): Promise<VoiceContrastCheckResult> {
  const {
    similarityThreshold = DEFAULT_VOICE_CONTRAST_THRESHOLD,
    nResults = 5,
    minPatternEvidence = DEFAULT_MIN_PATTERN_EVIDENCE,
    skipSimilarityCheck = false,
    skipPatternCheck = false,
    skipCharacteristicsCheck = false,
  } = options;

  const issues: VoiceContrastIssue[] = [];
  const patternViolations: string[] = [];
  let similarity = 0;

  if (!skipSimilarityCheck) {
    const similarityResult = await checkVoiceSimilarity(content, {
      threshold: similarityThreshold,
      nResults,
      includeGuidelines: true,
    });

    similarity = similarityResult.averageSimilarity;

    if (similarityResult.matchCount > 0 && !similarityResult.passesThreshold) {
      const severityLevel = getSimilaritySeverity(similarity, similarityThreshold);
      issues.push({
        type: 'low_similarity',
        description: `Voice similarity ${formatPercent(similarity)} below threshold ${formatPercent(similarityThreshold)}`,
        severity: severityLevel,
        details: {
          similarity,
          threshold: similarityThreshold,
          matchCount: similarityResult.matchCount,
        },
      });
    }
  }

  if (!skipPatternCheck) {
    const voicePatterns = listPatterns({
      patternType: 'voice',
      minEvidenceCount: minPatternEvidence,
      orderBy: 'evidence_count',
      orderDir: 'desc',
      limit: 20,
    });

    const rejectionPatterns = listPatterns({
      patternType: 'rejection',
      minEvidenceCount: minPatternEvidence,
      orderBy: 'evidence_count',
      orderDir: 'desc',
      limit: 20,
    });

    for (const pattern of rejectionPatterns) {
      if (contentMatchesPattern(content, pattern.description)) {
        patternViolations.push(pattern.description);
        issues.push({
          type: 'pattern_violation',
          description: `Matches known rejection pattern: "${truncate(pattern.description, 60)}"`,
          severity: getPatternSeverity(pattern.evidenceCount),
          details: {
            patternId: pattern.id,
            evidenceCount: pattern.evidenceCount,
            patternType: pattern.patternType,
          },
        });
      }
    }

    const voicePatternsMatched = voicePatterns.filter((p) =>
      contentMatchesPattern(content, p.description)
    );

    if (voicePatterns.length > 0 && voicePatternsMatched.length === 0) {
      issues.push({
        type: 'pattern_violation',
        description: 'Content does not match any established voice patterns',
        severity: 'low',
        details: {
          availablePatterns: voicePatterns.length,
          matchedPatterns: 0,
        },
      });
    }
  }

  if (!skipCharacteristicsCheck) {
    const characteristicsResult = checkVoiceCharacteristics(content);

    if (!characteristicsResult.passed) {
      const highSeverityIssues = characteristicsResult.issues.filter((i) => i.severity === 'high');

      if (highSeverityIssues.length > 0) {
        for (const issue of highSeverityIssues) {
          issues.push({
            type: 'characteristic_failure',
            description: issue.description,
            severity: 'high',
            details: {
              category: issue.category,
              suggestion: issue.suggestion,
            },
          });
        }
      } else if (characteristicsResult.score < 60) {
        issues.push({
          type: 'characteristic_failure',
          description: `Voice characteristics score ${characteristicsResult.score}% below acceptable threshold`,
          severity: 'medium',
          details: {
            score: characteristicsResult.score,
            issueCount: characteristicsResult.issues.length,
          },
        });
      }
    }
  }

  const hasHighSeverity = issues.some((i) => i.severity === 'high');
  const hasMediumSeverity = issues.some((i) => i.severity === 'medium');
  const isDeviation = hasHighSeverity || (hasMediumSeverity && issues.length >= 2);

  return {
    isDeviation,
    issues,
    similarity,
    patternViolations,
    detector: 'voice-contrast',
  };
}

function contentMatchesPattern(content: string, patternDescription: string): boolean {
  const normalizedContent = content.toLowerCase();
  const normalizedPattern = patternDescription.toLowerCase();

  const keywords = extractKeywords(normalizedPattern);
  if (keywords.length === 0) {
    return false;
  }

  const matchedKeywords = keywords.filter((keyword) => normalizedContent.includes(keyword));

  return matchedKeywords.length >= Math.ceil(keywords.length * 0.5);
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'the',
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
    'need',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'through',
    'during',
    'before',
    'after',
    'above',
    'below',
    'between',
    'under',
    'and',
    'but',
    'or',
    'nor',
    'so',
    'yet',
    'both',
    'either',
    'neither',
    'not',
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
    'they',
    'them',
    'their',
    'what',
    'which',
    'who',
    'whom',
    'when',
    'where',
    'why',
    'how',
    'all',
    'each',
    'every',
    'any',
    'such',
    'no',
    'more',
    'most',
    'other',
    'some',
    'about',
    'like',
    'use',
    'using',
    'uses',
    'used',
    'avoid',
    'avoiding',
    'avoids',
    'avoided',
    'dont',
    "don't",
    'never',
    'always',
    'often',
    'usually',
  ]);

  const words = text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !stopWords.has(word));

  return [...new Set(words)];
}

function getSimilaritySeverity(similarity: number, threshold: number): 'low' | 'medium' | 'high' {
  const gap = threshold - similarity;
  if (gap >= 0.3) return 'high';
  if (gap >= 0.15) return 'medium';
  return 'low';
}

function getPatternSeverity(evidenceCount: number): 'low' | 'medium' | 'high' {
  if (evidenceCount >= 10) return 'high';
  if (evidenceCount >= 5) return 'medium';
  return 'low';
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export function hasHighSeverityDeviation(result: VoiceContrastCheckResult): boolean {
  return result.issues.some((issue) => issue.severity === 'high');
}

export function getDeviationScore(result: VoiceContrastCheckResult): number {
  let score = 0;
  for (const issue of result.issues) {
    switch (issue.severity) {
      case 'high':
        score += 35;
        break;
      case 'medium':
        score += 20;
        break;
      case 'low':
        score += 10;
        break;
    }
  }
  return Math.min(100, score);
}

export function formatVoiceContrastResult(result: VoiceContrastCheckResult): string {
  if (!result.isDeviation) {
    return `No voice contrast issues detected. Similarity: ${formatPercent(result.similarity)}`;
  }

  const lines = [
    `Voice contrast deviation detected (${result.issues.length} issue${result.issues.length > 1 ? 's' : ''}):`,
    `  Similarity: ${formatPercent(result.similarity)}`,
    '',
    'Issues:',
  ];

  for (const issue of result.issues) {
    const severityIcon = issue.severity === 'high' ? '⚠' : issue.severity === 'medium' ? '!' : '·';
    lines.push(`  ${severityIcon} [${issue.severity.toUpperCase()}] ${issue.description}`);
  }

  if (result.patternViolations.length > 0) {
    lines.push('');
    lines.push('Pattern violations:');
    for (const violation of result.patternViolations.slice(0, 5)) {
      lines.push(`  - ${truncate(violation, 70)}`);
    }
    if (result.patternViolations.length > 5) {
      lines.push(`  ... and ${result.patternViolations.length - 5} more`);
    }
  }

  return lines.join('\n');
}

export async function quickVoiceContrastCheck(
  content: string,
  threshold: number = DEFAULT_VOICE_CONTRAST_THRESHOLD
): Promise<{ passed: boolean; reason: string }> {
  const result = await checkVoiceContrast(content, {
    similarityThreshold: threshold,
    nResults: 3,
    minPatternEvidence: 5,
  });

  if (!result.isDeviation) {
    return {
      passed: true,
      reason: 'Content aligns with established voice patterns',
    };
  }

  const highSeverity = result.issues.filter((i) => i.severity === 'high');
  if (highSeverity.length > 0) {
    return {
      passed: false,
      reason: `High severity deviation: ${highSeverity[0].description}`,
    };
  }

  return {
    passed: false,
    reason: `Voice deviation: ${result.issues.length} issue(s) detected`,
  };
}
