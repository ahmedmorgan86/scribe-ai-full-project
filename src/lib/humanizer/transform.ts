/**
 * Humanize Transform - Apply pattern rewrites to content
 *
 * HUM-002: Create humanize transform function
 * Applies all humanizer pattern rewrites and returns the humanized content
 * along with a list of changes made.
 */

import {
  detectAllPatternsWithRewrites,
  type PatternDetectionResult,
} from '@/lib/slop/humanizer-patterns';

/**
 * Result of a single pattern match with applied rewrite
 */
export interface PatternMatch {
  patternName: string;
  original: string;
  replacement: string;
  applied: boolean;
}

/**
 * Result of humanizing content
 */
export interface HumanizeResult {
  humanized: string;
  changes: PatternMatch[];
}

/**
 * Apply a single rewrite to content
 * Returns the modified content and whether the replacement was applied
 */
function applyRewrite(
  content: string,
  original: string,
  suggestion: string
): { content: string; applied: boolean } {
  // Skip non-actionable suggestions (instructions rather than replacements)
  if (suggestion.startsWith('[') && suggestion.endsWith(']')) {
    return { content, applied: false };
  }

  // Check if the original exists in content (case-insensitive search)
  const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedOriginal, 'gi');

  if (!regex.test(content)) {
    return { content, applied: false };
  }

  // Apply the replacement
  const newContent = content.replace(regex, suggestion);
  return { content: newContent, applied: newContent !== content };
}

/**
 * Humanize content by applying all detected pattern rewrites
 *
 * @param text - The content to humanize
 * @returns Object with humanized text and list of changes made
 */
export function humanizeContent(text: string): HumanizeResult {
  const detections: PatternDetectionResult[] = detectAllPatternsWithRewrites(text);
  const changes: PatternMatch[] = [];
  let humanized = text;

  // Track which originals we've already processed to avoid double-processing
  const processed = new Set<string>();

  for (const detection of detections) {
    const key = `${detection.patternName}:${detection.original}`;
    if (processed.has(key)) {
      continue;
    }
    processed.add(key);

    const { content: newContent, applied } = applyRewrite(
      humanized,
      detection.original,
      detection.suggestion
    );

    changes.push({
      patternName: detection.patternName,
      original: detection.original,
      replacement: detection.suggestion,
      applied,
    });

    if (applied) {
      humanized = newContent;
    }
  }

  return {
    humanized,
    changes,
  };
}

/**
 * Get count of applied changes
 */
export function getAppliedChangesCount(result: HumanizeResult): number {
  return result.changes.filter((c) => c.applied).length;
}

/**
 * Get count of suggested but not applied changes
 */
export function getSuggestedChangesCount(result: HumanizeResult): number {
  return result.changes.filter((c) => !c.applied).length;
}

/**
 * Format humanize result for display
 */
export function formatHumanizeResult(result: HumanizeResult): string {
  const appliedCount = getAppliedChangesCount(result);
  const suggestedCount = getSuggestedChangesCount(result);

  if (result.changes.length === 0) {
    return 'No AI patterns detected. Content unchanged.';
  }

  const lines = [
    `Humanized content: ${appliedCount} change(s) applied, ${suggestedCount} suggestion(s) for manual review.`,
  ];

  const applied = result.changes.filter((c) => c.applied);
  if (applied.length > 0) {
    lines.push('', 'Applied changes:');
    for (const change of applied) {
      lines.push(`  [${change.patternName}] "${change.original}" → "${change.replacement}"`);
    }
  }

  const suggested = result.changes.filter((c) => !c.applied);
  if (suggested.length > 0) {
    lines.push('', 'Manual review needed:');
    for (const change of suggested) {
      lines.push(`  [${change.patternName}] "${change.original}" → ${change.replacement}`);
    }
  }

  return lines.join('\n');
}
