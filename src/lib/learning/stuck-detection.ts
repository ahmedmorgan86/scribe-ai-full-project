import type { Feedback, FeedbackCategory, Pattern, PatternType } from '@/types';
import { listFeedback } from '@/db/models/feedback';
import { getPostById } from '@/db/models/posts';
import { listPatterns } from '@/db/models/patterns';

export interface StuckPattern {
  patternType: PatternType | FeedbackCategory;
  description: string;
  rejectionCount: number;
  recentRejections: StuckRejection[];
  firstRejectedAt: string;
  lastRejectedAt: string;
}

export interface StuckRejection {
  feedbackId: number;
  postId: number;
  category: FeedbackCategory | null;
  comment: string | null;
  contentSnippet: string;
  createdAt: string;
}

export interface StuckDetectionResult {
  isStuck: boolean;
  stuckPatterns: StuckPattern[];
  totalConsecutiveRejections: number;
  adaptiveThreshold: number;
  clarificationNeeded: StuckClarification[];
  summary: string;
}

export interface StuckClarification {
  pattern: StuckPattern;
  question: string;
  context: string;
  suggestedActions: string[];
}

export interface StuckDetectionOptions {
  baseThreshold?: number;
  lookbackCount?: number;
  adaptiveMultiplier?: number;
  minRejections?: number;
}

const DEFAULT_BASE_THRESHOLD = 5;
const DEFAULT_LOOKBACK_COUNT = 50;
const DEFAULT_ADAPTIVE_MULTIPLIER = 0.1;
const MIN_REJECTIONS_FOR_STUCK = 3;

export function calculateAdaptiveThreshold(
  totalPatterns: number,
  baseThreshold: number = DEFAULT_BASE_THRESHOLD,
  adaptiveMultiplier: number = DEFAULT_ADAPTIVE_MULTIPLIER
): number {
  return Math.max(
    MIN_REJECTIONS_FOR_STUCK,
    Math.floor(baseThreshold + totalPatterns * adaptiveMultiplier)
  );
}

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'is',
    'it',
    'that',
    'this',
    'of',
    'with',
    'as',
    'be',
    'by',
    'from',
    'are',
    'was',
    'were',
    'been',
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
    'can',
  ]);

  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
  );
}

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = extractKeywords(text1);
  const words2 = extractKeywords(text2);

  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  const intersection = [...words1].filter((w) => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return intersection.length / union.size;
}

function groupRejectionsByPattern(
  rejections: Feedback[],
  patterns: Pattern[]
): Map<string, StuckRejection[]> {
  const grouped = new Map<string, StuckRejection[]>();

  for (const category of [
    'generic',
    'tone',
    'hook',
    'value',
    'topic',
    'timing',
    'other',
  ] as FeedbackCategory[]) {
    grouped.set(`category:${category}`, []);
  }

  for (const pattern of patterns) {
    grouped.set(`pattern:${pattern.id}`, []);
  }

  for (const feedback of rejections) {
    const post = getPostById(feedback.postId);
    if (!post) continue;

    const rejection: StuckRejection = {
      feedbackId: feedback.id,
      postId: feedback.postId,
      category: feedback.category,
      comment: feedback.comment,
      contentSnippet: post.content.slice(0, 100) + (post.content.length > 100 ? '...' : ''),
      createdAt: feedback.createdAt,
    };

    if (feedback.category) {
      const key = `category:${feedback.category}`;
      const group = grouped.get(key);
      if (group) {
        group.push(rejection);
      }
    }

    const commentLower = feedback.comment?.toLowerCase() ?? '';
    const contentLower = post.content.toLowerCase();

    for (const pattern of patterns) {
      const similarity = Math.max(
        calculateSimilarity(commentLower, pattern.description),
        calculateSimilarity(contentLower, pattern.description)
      );

      if (similarity >= 0.3) {
        const key = `pattern:${pattern.id}`;
        const group = grouped.get(key);
        if (group) {
          group.push(rejection);
        }
      }
    }
  }

  return grouped;
}

export function detectStuckPatterns(options: StuckDetectionOptions = {}): StuckDetectionResult {
  const {
    baseThreshold = DEFAULT_BASE_THRESHOLD,
    lookbackCount = DEFAULT_LOOKBACK_COUNT,
    adaptiveMultiplier = DEFAULT_ADAPTIVE_MULTIPLIER,
    minRejections = MIN_REJECTIONS_FOR_STUCK,
  } = options;

  const recentFeedback = listFeedback({
    limit: lookbackCount,
    orderDir: 'desc',
  });

  const rejections = recentFeedback.filter((f) => f.action === 'reject');

  let consecutiveRejections = 0;
  for (const feedback of recentFeedback) {
    if (feedback.action === 'reject') {
      consecutiveRejections++;
    } else if (feedback.action === 'approve') {
      break;
    }
  }

  const patterns = listPatterns({ limit: 100 });
  const adaptiveThreshold = calculateAdaptiveThreshold(
    patterns.length,
    baseThreshold,
    adaptiveMultiplier
  );

  const grouped = groupRejectionsByPattern(rejections, patterns);

  const stuckPatterns: StuckPattern[] = [];

  for (const [key, rejectionList] of grouped) {
    if (rejectionList.length < minRejections) continue;
    if (rejectionList.length < adaptiveThreshold) continue;

    const sorted = rejectionList.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    let patternType: PatternType | FeedbackCategory;
    let description: string;

    if (key.startsWith('category:')) {
      patternType = key.replace('category:', '') as FeedbackCategory;
      description = `Repeated rejections for ${patternType} issues`;
    } else {
      const patternId = parseInt(key.replace('pattern:', ''), 10);
      const pattern = patterns.find((p) => p.id === patternId);
      if (!pattern) continue;
      patternType = pattern.patternType;
      description = pattern.description;
    }

    stuckPatterns.push({
      patternType,
      description,
      rejectionCount: rejectionList.length,
      recentRejections: sorted.slice(-5),
      firstRejectedAt: sorted[0].createdAt,
      lastRejectedAt: sorted[sorted.length - 1].createdAt,
    });
  }

  stuckPatterns.sort((a, b) => b.rejectionCount - a.rejectionCount);

  const isStuck = stuckPatterns.length > 0 || consecutiveRejections >= adaptiveThreshold;

  const clarificationNeeded = stuckPatterns.map((pattern) => generateStuckClarification(pattern));

  const summary = generateStuckSummary(
    isStuck,
    stuckPatterns,
    consecutiveRejections,
    adaptiveThreshold
  );

  return {
    isStuck,
    stuckPatterns,
    totalConsecutiveRejections: consecutiveRejections,
    adaptiveThreshold,
    clarificationNeeded,
    summary,
  };
}

function generateStuckClarification(pattern: StuckPattern): StuckClarification {
  const recentComments = pattern.recentRejections
    .filter((r) => r.comment)
    .map((r) => r.comment)
    .slice(-3);

  const context =
    recentComments.length > 0
      ? `Recent feedback: ${recentComments.join('; ')}`
      : `No specific comments provided for these ${pattern.rejectionCount} rejections.`;

  const question = `The agent has been rejected ${pattern.rejectionCount} times for "${pattern.description}". What should it do differently?`;

  const suggestedActions = generateSuggestedActions(pattern);

  return {
    pattern,
    question,
    context,
    suggestedActions,
  };
}

function generateSuggestedActions(pattern: StuckPattern): string[] {
  const actions: string[] = [];

  switch (pattern.patternType) {
    case 'generic':
      actions.push('Provide more specific guidance on what makes content feel authentic');
      actions.push('Share examples of approved posts that demonstrate the desired style');
      actions.push('Consider if the voice guidelines need clarification');
      break;
    case 'tone':
      actions.push('Clarify the exact tone you want (casual, professional, authoritative, etc.)');
      actions.push('Provide examples of the right tone from approved posts');
      actions.push('Specify words or phrases to avoid/use for tone');
      break;
    case 'hook':
      actions.push('Share examples of hooks that worked well');
      actions.push('Specify what makes a good opening for your content');
      actions.push('Clarify if you prefer questions, statements, or provocative takes');
      break;
    case 'value':
      actions.push('Clarify what unique value means for your audience');
      actions.push('Specify the depth of insight expected');
      actions.push('Provide examples of high-value posts');
      break;
    case 'topic':
      actions.push('Clarify which topics are on-brand vs off-brand');
      actions.push('Specify topic priority or preferences');
      actions.push('Define boundaries for topic exploration');
      break;
    case 'timing':
      actions.push('Clarify timing preferences for different content types');
      actions.push('Specify if evergreen or trending content is preferred');
      break;
    case 'voice':
      actions.push('Review and update voice guidelines with more specific examples');
      actions.push('Add more approved posts to the training corpus');
      actions.push('Clarify voice characteristics that are being missed');
      break;
    case 'rejection':
      actions.push('Review the rejection patterns and provide explicit rules');
      actions.push('Add counterexamples showing what TO do instead');
      break;
    default:
      actions.push('Provide more detailed feedback on what went wrong');
      actions.push('Share examples of what you wanted instead');
      actions.push('Consider adding explicit rules for this pattern');
  }

  return actions;
}

function generateStuckSummary(
  isStuck: boolean,
  stuckPatterns: StuckPattern[],
  consecutiveRejections: number,
  threshold: number
): string {
  if (!isStuck) {
    return 'Agent is operating normally. No stuck patterns detected.';
  }

  const parts: string[] = [];
  parts.push('⚠️ STUCK DETECTED');

  if (consecutiveRejections >= threshold) {
    parts.push(`${consecutiveRejections} consecutive rejections (threshold: ${threshold})`);
  }

  if (stuckPatterns.length > 0) {
    parts.push(`${stuckPatterns.length} problematic pattern(s):`);
    for (const p of stuckPatterns.slice(0, 3)) {
      parts.push(`  • ${p.description} (${p.rejectionCount} rejections)`);
    }
    if (stuckPatterns.length > 3) {
      parts.push(`  ... and ${stuckPatterns.length - 3} more`);
    }
  }

  parts.push('User clarification needed to proceed effectively.');

  return parts.join('\n');
}

export function checkIfStuck(options: StuckDetectionOptions = {}): boolean {
  const result = detectStuckPatterns(options);
  return result.isStuck;
}

export function getStuckStatus(options: StuckDetectionOptions = {}): {
  isStuck: boolean;
  summary: string;
  needsClarification: boolean;
  topPattern: StuckPattern | null;
} {
  const result = detectStuckPatterns(options);

  return {
    isStuck: result.isStuck,
    summary: result.summary,
    needsClarification: result.clarificationNeeded.length > 0,
    topPattern: result.stuckPatterns[0] ?? null,
  };
}

export function formatStuckDetectionResult(result: StuckDetectionResult): string {
  const lines: string[] = [];

  lines.push('=== Stuck Detection Result ===');
  lines.push(`Status: ${result.isStuck ? 'STUCK' : 'OK'}`);
  lines.push(`Consecutive rejections: ${result.totalConsecutiveRejections}`);
  lines.push(`Adaptive threshold: ${result.adaptiveThreshold}`);

  if (result.stuckPatterns.length === 0) {
    lines.push('\nNo stuck patterns detected.');
    return lines.join('\n');
  }

  lines.push(`\n--- Stuck Patterns (${result.stuckPatterns.length}) ---`);

  for (const pattern of result.stuckPatterns) {
    lines.push(`\n[${pattern.patternType.toUpperCase()}] ${pattern.description}`);
    lines.push(`  Rejections: ${pattern.rejectionCount}`);
    lines.push(`  First: ${pattern.firstRejectedAt}`);
    lines.push(`  Last: ${pattern.lastRejectedAt}`);

    if (pattern.recentRejections.length > 0) {
      lines.push('  Recent examples:');
      for (const r of pattern.recentRejections.slice(-3)) {
        lines.push(`    • "${r.contentSnippet}"`);
        if (r.comment) {
          lines.push(`      Comment: ${r.comment}`);
        }
      }
    }
  }

  if (result.clarificationNeeded.length > 0) {
    lines.push('\n--- Clarification Needed ---');

    for (const c of result.clarificationNeeded) {
      lines.push(`\nQ: ${c.question}`);
      lines.push(`Context: ${c.context}`);
      lines.push('Suggested actions:');
      for (const action of c.suggestedActions) {
        lines.push(`  • ${action}`);
      }
    }
  }

  return lines.join('\n');
}

export function resetStuckState(): void {
  // Placeholder for future implementation.
  // Could clear consecutive rejection counters or mark patterns as addressed.
}
