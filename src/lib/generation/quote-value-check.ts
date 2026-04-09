import type { Source } from '@/types';
import { trackedCompletion } from '@/lib/anthropic/cost-tracking';

export interface QuoteValueCheckResult {
  addsValue: boolean;
  valueType: QuoteValueType | null;
  score: number;
  issues: QuoteValueIssue[];
  suggestions: string[];
  costUsd: number;
}

export type QuoteValueType =
  | 'new_information'
  | 'unique_angle'
  | 'audience_translation'
  | 'expert_context';

export interface QuoteValueIssue {
  type: QuoteValueIssueType;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export type QuoteValueIssueType =
  | 'mere_agreement'
  | 'restates_original'
  | 'empty_reaction'
  | 'no_substance'
  | 'generic_commentary';

const VALUE_PATTERNS: Record<QuoteValueType, RegExp[]> = {
  new_information: [
    /\bdata\b.*\bshows?\b/i,
    /\bstud(y|ies)\b.*\b(found|shows?|suggests?)\b/i,
    /\bexample\b.*\b(is|was|are)\b/i,
    /\bactually\b.*\b(is|was|means?)\b/i,
    /\d+%/,
    /\$[\d,]+/,
    /\d+\s*(users?|people|companies|years?|months?|days?)/i,
  ],
  unique_angle: [
    /\bbut\b.*\b(what|consider|miss)/i,
    /\bmissing\b.*\b(piece|part|context)/i,
    /\bflip\s*side\b/i,
    /\bcontrar(y|ily)\b/i,
    /\bother\s*hand\b/i,
    /\bdifferent\s*(take|angle|perspective)\b/i,
    /\bunderrated\b/i,
    /\boverlooked\b/i,
  ],
  audience_translation: [
    /\bsimpl(y|er|ified)\b.*\b(put|terms?|words?)\b/i,
    /\bin\s*other\s*words\b/i,
    /\bfor\s*(devs?|developers?|engineers?|founders?|marketers?)\b/i,
    /\bthis\s*means?\b.*\bfor\b/i,
    /\bwhat\s*this\s*means?\b/i,
    /\bpractically\b/i,
    /\bapplied\s*to\b/i,
    /\btranslat(e|es|ion)\b/i,
  ],
  expert_context: [
    /\bin\s*my\s*experience\b/i,
    /\bwe\s*(built|shipped|used|tried)\b/i,
    /\bat\s*@?\w+\b.*\b(we|our)\b/i,
    /\byears?\s*(ago|of|in)\b.*\b(doing|building|working)\b/i,
    /\bI['']?ve\s*(seen|built|shipped|worked)\b/i,
    /\bback\s*when\b/i,
  ],
};

const NO_VALUE_PATTERNS: { pattern: RegExp; type: QuoteValueIssueType; description: string }[] = [
  {
    pattern: /^(this|so\s+true|exactly|100%|facts?|real|truth|yep|yes|nailed\s+it)/i,
    type: 'mere_agreement',
    description: 'Starts with mere agreement',
  },
  {
    pattern: /^(wow|whoa|damn|omg|lol|lmao)/i,
    type: 'empty_reaction',
    description: 'Empty reaction',
  },
  {
    pattern: /^(love\s+this|great\s+(take|point|thread))/i,
    type: 'mere_agreement',
    description: 'Generic praise without substance',
  },
  {
    pattern: /^(couldn['']?t\s+agree\s+more|spot\s+on)/i,
    type: 'mere_agreement',
    description: 'Agreement without adding value',
  },
  {
    pattern: /^(rt|retweet|qrt)\b/i,
    type: 'no_substance',
    description: 'Explicit retweet indicator',
  },
  {
    pattern: /^[.!?\u{1F525}\u{1F4AF}\u{1F44F}\u{1F64C}]+$/iu,
    type: 'empty_reaction',
    description: 'Only punctuation or emoji',
  },
];

function detectValueType(quoteContent: string): {
  type: QuoteValueType | null;
  confidence: number;
} {
  let bestMatch: { type: QuoteValueType; confidence: number } | null = null;

  for (const [valueType, patterns] of Object.entries(VALUE_PATTERNS) as [
    QuoteValueType,
    RegExp[],
  ][]) {
    let matchCount = 0;
    for (const pattern of patterns) {
      if (pattern.test(quoteContent)) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      const confidence = Math.min(100, 40 + matchCount * 20);
      if (bestMatch === null || confidence > bestMatch.confidence) {
        bestMatch = { type: valueType, confidence };
      }
    }
  }

  return bestMatch ?? { type: null, confidence: 0 };
}

function detectNoValuePatterns(quoteContent: string): QuoteValueIssue[] {
  const issues: QuoteValueIssue[] = [];
  const trimmedContent = quoteContent.trim();

  for (const { pattern, type, description } of NO_VALUE_PATTERNS) {
    if (pattern.test(trimmedContent)) {
      issues.push({
        type,
        description,
        severity: 'high',
      });
    }
  }

  if (trimmedContent.length < 30) {
    issues.push({
      type: 'no_substance',
      description: 'Quote is too short to add meaningful value',
      severity: 'medium',
    });
  }

  const wordCount = trimmedContent.split(/\s+/).length;
  if (wordCount < 5) {
    issues.push({
      type: 'no_substance',
      description: 'Quote has too few words to add context',
      severity: 'medium',
    });
  }

  return issues;
}

function checkForRestating(quoteContent: string, originalContent: string): QuoteValueIssue | null {
  const quoteWords = new Set(
    quoteContent
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
  const originalWords = new Set(
    originalContent
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );

  if (quoteWords.size === 0 || originalWords.size === 0) {
    return null;
  }

  let overlapCount = 0;
  for (const word of quoteWords) {
    if (originalWords.has(word)) {
      overlapCount++;
    }
  }

  const overlapRatio = overlapCount / quoteWords.size;
  if (overlapRatio > 0.6) {
    return {
      type: 'restates_original',
      description: `Quote restates ${Math.round(overlapRatio * 100)}% of original content`,
      severity: overlapRatio > 0.8 ? 'high' : 'medium',
    };
  }

  return null;
}

export function quickQuoteValueCheck(
  quoteContent: string,
  originalContent: string
): QuoteValueCheckResult {
  const issues: QuoteValueIssue[] = [];

  issues.push(...detectNoValuePatterns(quoteContent));

  const restatingIssue = checkForRestating(quoteContent, originalContent);
  if (restatingIssue) {
    issues.push(restatingIssue);
  }

  const { type: valueType, confidence } = detectValueType(quoteContent);

  const highSeverityIssues = issues.filter((i) => i.severity === 'high').length;
  const mediumSeverityIssues = issues.filter((i) => i.severity === 'medium').length;

  let score = valueType !== null ? confidence : 30;
  score -= highSeverityIssues * 30;
  score -= mediumSeverityIssues * 10;
  score = Math.max(0, Math.min(100, score));

  const addsValue = highSeverityIssues === 0 && score >= 50;

  const suggestions: string[] = [];
  if (!addsValue) {
    if (issues.some((i) => i.type === 'mere_agreement')) {
      suggestions.push('Add a specific observation or counter-point instead of just agreeing');
    }
    if (issues.some((i) => i.type === 'restates_original')) {
      suggestions.push('Provide new context or perspective instead of restating the original');
    }
    if (issues.some((i) => i.type === 'no_substance')) {
      suggestions.push('Expand with specific examples, data, or expert context');
    }
    if (valueType === null) {
      suggestions.push(
        'Try adding: new data/examples, a unique angle, audience translation, or expert experience'
      );
    }
  }

  return {
    addsValue,
    valueType,
    score,
    issues,
    suggestions,
    costUsd: 0,
  };
}

interface LlmQuoteValueResponse {
  addsValue: boolean;
  valueType: QuoteValueType | null;
  score: number;
  issues: Array<{ type: string; description: string; severity: string }>;
  suggestions: string[];
}

export async function checkQuoteValueWithLlm(
  quoteContent: string,
  originalContent: string,
  source?: Source
): Promise<QuoteValueCheckResult> {
  const systemPrompt = `You are evaluating whether a quote tweet adds unique value to the original content.

A quote tweet MUST add one of these value types:
1. new_information - Adds data, examples, or facts not in the original
2. unique_angle - Provides a different perspective, counter-point, or overlooked aspect
3. audience_translation - Simplifies or reframes for a specific audience
4. expert_context - Adds personal experience or domain expertise

A quote tweet FAILS if it:
- Merely agrees without adding substance ("So true!", "This!", "100%")
- Restates what the original already said
- Is an empty reaction (just emoji, "wow", "damn")
- Adds generic commentary without specific insight

Evaluate the quote tweet and return JSON:
{
  "addsValue": boolean,
  "valueType": "new_information" | "unique_angle" | "audience_translation" | "expert_context" | null,
  "score": 0-100,
  "issues": [{ "type": string, "description": string, "severity": "high" | "medium" | "low" }],
  "suggestions": ["string"] // only if addsValue is false
}`;

  const userPrompt = `ORIGINAL CONTENT:
${originalContent}

${source?.metadata.authorHandle ? `Original Author: @${source.metadata.authorHandle}` : ''}

QUOTE TWEET:
${quoteContent}

Evaluate whether this quote tweet adds unique value. Be strict - generic agreement or restating is NOT enough.`;

  const result = await trackedCompletion(userPrompt, {
    model: 'haiku',
    systemPrompt,
    maxTokens: 512,
    temperature: 0.2,
  });

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as LlmQuoteValueResponse;
      const issues: QuoteValueIssue[] = (parsed.issues ?? []).map((i) => ({
        type: i.type as QuoteValueIssueType,
        description: i.description,
        severity: i.severity as 'high' | 'medium' | 'low',
      }));

      return {
        addsValue: parsed.addsValue,
        valueType: parsed.valueType,
        score: Math.max(0, Math.min(100, parsed.score)),
        issues,
        suggestions: parsed.suggestions ?? [],
        costUsd: result.costUsd,
      };
    }
  } catch {
    // Fall through to quick check
  }

  const quickResult = quickQuoteValueCheck(quoteContent, originalContent);
  quickResult.costUsd = result.costUsd;
  return quickResult;
}

export async function validateQuoteValue(
  quoteContent: string,
  originalContent: string,
  options: { useLlm?: boolean; source?: Source } = {}
): Promise<QuoteValueCheckResult> {
  const { useLlm = false, source } = options;

  const quickResult = quickQuoteValueCheck(quoteContent, originalContent);

  if (!useLlm) {
    return quickResult;
  }

  if (quickResult.issues.some((i) => i.severity === 'high')) {
    return quickResult;
  }

  if (quickResult.addsValue && quickResult.score >= 70) {
    return quickResult;
  }

  return checkQuoteValueWithLlm(quoteContent, originalContent, source);
}

export function formatQuoteValueResult(result: QuoteValueCheckResult): string {
  const lines: string[] = [];

  lines.push(`=== QUOTE VALUE CHECK ${result.addsValue ? 'PASSED' : 'FAILED'} ===`);
  lines.push('');
  lines.push(`Adds Value: ${result.addsValue}`);
  lines.push(`Value Type: ${result.valueType ?? 'None detected'}`);
  lines.push(`Score: ${result.score}/100`);

  if (result.costUsd > 0) {
    lines.push(`Cost: $${result.costUsd.toFixed(4)}`);
  }

  if (result.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of result.issues) {
      lines.push(`  [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}`);
    }
  }

  if (result.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const suggestion of result.suggestions) {
      lines.push(`  - ${suggestion}`);
    }
  }

  return lines.join('\n');
}

export function getQuoteValueBadge(result: QuoteValueCheckResult): {
  label: string;
  color: 'green' | 'yellow' | 'red';
} {
  if (result.addsValue && result.score >= 70) {
    return { label: 'High Value', color: 'green' };
  }
  if (result.addsValue && result.score >= 50) {
    return { label: 'Moderate Value', color: 'yellow' };
  }
  return { label: 'Low Value', color: 'red' };
}
