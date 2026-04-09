import type { SlopDetector } from '@/types';

export interface StructuralIssue {
  pattern: StructuralPattern;
  description: string;
  severity: 'low' | 'medium' | 'high';
  matches: string[];
  count: number;
}

export interface StructuralCheckResult {
  hasIssues: boolean;
  issues: StructuralIssue[];
  detector: SlopDetector;
}

export type StructuralPattern =
  | 'excessive_emoji'
  | 'listicle_format'
  | 'hashtag'
  | 'all_caps_abuse'
  | 'excessive_punctuation'
  | 'clickbait_opening'
  | 'filler_phrases'
  | 'formulaic_structure';

interface PatternConfig {
  pattern: RegExp;
  threshold: number;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

const PATTERN_CONFIGS: Record<StructuralPattern, PatternConfig> = {
  excessive_emoji: {
    pattern: /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
    threshold: 3,
    severity: 'medium',
    description: 'Excessive emoji usage',
  },
  listicle_format: {
    pattern: /^[1-9][0-9]?[.)]\s/gm,
    threshold: 1,
    severity: 'high',
    description: 'Listicle format detected',
  },
  hashtag: {
    pattern: /#[a-zA-Z][a-zA-Z0-9_]*/g,
    threshold: 1,
    severity: 'high',
    description: 'Hashtag usage (never acceptable)',
  },
  all_caps_abuse: {
    pattern: /\b[A-Z]{4,}\b/g,
    threshold: 2,
    severity: 'low',
    description: 'Excessive ALL CAPS usage',
  },
  excessive_punctuation: {
    pattern: /[!?]{3,}/g,
    threshold: 1,
    severity: 'medium',
    description: 'Excessive punctuation',
  },
  clickbait_opening: {
    pattern: /^(So,|Look,|Okay so|Here's the deal|Wait,|OMG|I can't believe)/i,
    threshold: 1,
    severity: 'medium',
    description: 'Clickbait-style opening',
  },
  filler_phrases: {
    pattern:
      /\b(basically|essentially|literally|honestly|actually|obviously|clearly|simply put|in essence)\b/gi,
    threshold: 2,
    severity: 'low',
    description: 'Filler words/phrases',
  },
  formulaic_structure: {
    pattern:
      /^(\w+\.|[\u{1F300}-\u{1F9FF}])\s.*\n(\w+\.|[\u{1F300}-\u{1F9FF}])\s.*\n(\w+\.|[\u{1F300}-\u{1F9FF}])\s/gmu,
    threshold: 1,
    severity: 'medium',
    description: 'Formulaic parallel structure',
  },
};

const FILLER_WORDS = [
  'basically',
  'essentially',
  'literally',
  'honestly',
  'actually',
  'obviously',
  'clearly',
  'simply put',
  'in essence',
  'at its core',
  'fundamentally',
  'realistically',
  'frankly',
  'truthfully',
];

function findMatches(content: string, pattern: RegExp): string[] {
  const clonedPattern = new RegExp(pattern.source, pattern.flags);
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = clonedPattern.exec(content)) !== null) {
    matches.push(match[0]);
    if (!clonedPattern.global) break;
  }

  return matches;
}

function checkPattern(
  content: string,
  patternType: StructuralPattern,
  config: PatternConfig
): StructuralIssue | null {
  const matches = findMatches(content, config.pattern);

  if (matches.length >= config.threshold) {
    return {
      pattern: patternType,
      description: config.description,
      severity: config.severity,
      matches,
      count: matches.length,
    };
  }

  return null;
}

export function checkStructuralPatterns(content: string): StructuralCheckResult {
  const issues: StructuralIssue[] = [];

  for (const [patternType, config] of Object.entries(PATTERN_CONFIGS)) {
    const issue = checkPattern(content, patternType as StructuralPattern, config);
    if (issue) {
      issues.push(issue);
    }
  }

  return {
    hasIssues: issues.length > 0,
    issues,
    detector: 'structural',
  };
}

export function checkForExcessiveEmoji(
  content: string,
  threshold: number = 3
): StructuralIssue | null {
  const config = { ...PATTERN_CONFIGS.excessive_emoji, threshold };
  return checkPattern(content, 'excessive_emoji', config);
}

export function checkForListicleFormat(content: string): StructuralIssue | null {
  return checkPattern(content, 'listicle_format', PATTERN_CONFIGS.listicle_format);
}

export function checkForHashtags(content: string): StructuralIssue | null {
  return checkPattern(content, 'hashtag', PATTERN_CONFIGS.hashtag);
}

export function checkForAllCapsAbuse(
  content: string,
  threshold: number = 2
): StructuralIssue | null {
  const config = { ...PATTERN_CONFIGS.all_caps_abuse, threshold };
  return checkPattern(content, 'all_caps_abuse', config);
}

export function checkForExcessivePunctuation(content: string): StructuralIssue | null {
  return checkPattern(content, 'excessive_punctuation', PATTERN_CONFIGS.excessive_punctuation);
}

export function checkForClickbaitOpening(content: string): StructuralIssue | null {
  return checkPattern(content, 'clickbait_opening', PATTERN_CONFIGS.clickbait_opening);
}

export function checkForFillerPhrases(
  content: string,
  threshold: number = 2
): StructuralIssue | null {
  const matches: string[] = [];

  for (const filler of FILLER_WORDS) {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi');
    const found = findMatches(content, regex);
    matches.push(...found);
  }

  if (matches.length >= threshold) {
    return {
      pattern: 'filler_phrases',
      description: PATTERN_CONFIGS.filler_phrases.description,
      severity: PATTERN_CONFIGS.filler_phrases.severity,
      matches,
      count: matches.length,
    };
  }

  return null;
}

export function checkForFormulaicStructure(content: string): StructuralIssue | null {
  return checkPattern(content, 'formulaic_structure', PATTERN_CONFIGS.formulaic_structure);
}

export function hasHighSeverityIssue(result: StructuralCheckResult): boolean {
  return result.issues.some((issue) => issue.severity === 'high');
}

export function getIssueSeverityScore(result: StructuralCheckResult): number {
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

export function formatStructuralCheckResult(result: StructuralCheckResult): string {
  if (!result.hasIssues) {
    return 'No structural issues detected.';
  }

  const lines = ['Structural issues detected:'];
  for (const issue of result.issues) {
    lines.push(`  [${issue.severity.toUpperCase()}] ${issue.description}`);
    lines.push(`    Pattern: ${issue.pattern}`);
    lines.push(`    Count: ${issue.count} (threshold exceeded)`);
    if (issue.matches.length <= 5) {
      lines.push(`    Matches: ${issue.matches.map((m) => `"${m}"`).join(', ')}`);
    } else {
      const preview = issue.matches
        .slice(0, 5)
        .map((m) => `"${m}"`)
        .join(', ');
      lines.push(`    Matches: ${preview}... (+${issue.matches.length - 5} more)`);
    }
  }

  return lines.join('\n');
}

export function getFillerWordsList(): readonly string[] {
  return FILLER_WORDS;
}
