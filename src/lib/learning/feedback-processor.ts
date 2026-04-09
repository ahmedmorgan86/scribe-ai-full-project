import type { Feedback, FeedbackCategory } from '@/types';
import { listFeedback, countFeedback } from '@/db/models/feedback';
import { getPostById } from '@/db/models/posts';
import { listPatterns, createPattern, incrementEvidenceCount } from '@/db/models/patterns';
import { trackedCompletion } from '@/lib/anthropic/cost-tracking';
import {
  buildPatternExtractionSystemPrompt,
  buildPatternExtractionUserPrompt,
  parsePatternExtractionResponse,
  FeedbackItem,
  ExistingPattern,
  ExtractedPattern,
  PatternExtractionResponse,
  Contradiction,
  ClarificationRequest,
} from '@/lib/anthropic/prompts/pattern-extraction';
import { getVoiceGuidelinesFromQdrant, formatGuidelinesForPrompt } from '@/lib/voice/guidelines';

export interface ProcessFeedbackOptions {
  batchSize?: number;
  minFeedbackItems?: number;
  skipIfRecentlyProcessed?: boolean;
  lastProcessedAt?: string;
}

export interface FeedbackProcessingResult {
  feedbackProcessed: number;
  patternsExtracted: number;
  patternsReinforced: number;
  contradictions: Contradiction[];
  clarificationNeeded: ClarificationRequest[];
  costUsd: number;
  success: boolean;
  error?: string;
}

export interface FeedbackBatch {
  feedbackItems: FeedbackItem[];
  feedbackIds: number[];
}

const DEFAULT_BATCH_SIZE = 20;
const MIN_FEEDBACK_FOR_PROCESSING = 3;

export function feedbackToItem(feedback: Feedback, originalContent: string): FeedbackItem | null {
  if (feedback.action === 'approve') {
    return null;
  }

  const action = feedback.action;
  if (action !== 'reject' && action !== 'edit') {
    return null;
  }

  return {
    action,
    category: feedback.category,
    comment: feedback.comment,
    originalContent,
    editedContent: feedback.diffAfter ?? undefined,
  };
}

export function collectFeedbackBatch(options: {
  limit?: number;
  afterDate?: string;
}): FeedbackBatch {
  const { limit = DEFAULT_BATCH_SIZE, afterDate } = options;

  const feedbackList = listFeedback({
    limit,
    orderDir: 'desc',
  });

  const feedbackItems: FeedbackItem[] = [];
  const feedbackIds: number[] = [];

  for (const feedback of feedbackList) {
    if (feedback.action === 'approve') {
      continue;
    }

    if (afterDate && feedback.createdAt <= afterDate) {
      continue;
    }

    const post = getPostById(feedback.postId);
    if (!post) {
      continue;
    }

    const item = feedbackToItem(feedback, post.content);
    if (item) {
      feedbackItems.push(item);
      feedbackIds.push(feedback.id);
    }
  }

  return { feedbackItems, feedbackIds };
}

export function getExistingPatternsForContext(): ExistingPattern[] {
  const patterns = listPatterns({
    limit: 100,
    orderBy: 'evidence_count',
    orderDir: 'desc',
  });

  return patterns.map((p) => ({
    type: p.patternType,
    description: p.description,
    evidenceCount: p.evidenceCount,
  }));
}

export async function extractPatternsWithLlm(
  feedbackItems: FeedbackItem[],
  existingPatterns: ExistingPattern[],
  voiceGuidelines: string
): Promise<{ response: PatternExtractionResponse; costUsd: number }> {
  const systemPrompt = buildPatternExtractionSystemPrompt();
  const userPrompt = buildPatternExtractionUserPrompt({
    feedbackItems,
    existingPatterns,
    voiceGuidelines,
  });

  const result = await trackedCompletion(userPrompt, {
    model: 'sonnet',
    systemPrompt,
    maxTokens: 2048,
    temperature: 0.3,
  });

  const response = parsePatternExtractionResponse(result.content);

  return {
    response,
    costUsd: result.costUsd,
  };
}

function findSimilarPattern(
  extracted: ExtractedPattern,
  existing: ExistingPattern[]
): ExistingPattern | null {
  const normalizedDesc = extracted.description.toLowerCase();

  for (const pattern of existing) {
    if (pattern.type !== extracted.type) {
      continue;
    }

    const existingNormalized = pattern.description.toLowerCase();

    const extractedWords = new Set(normalizedDesc.split(/\s+/).filter((w) => w.length > 3));
    const existingWords = new Set(existingNormalized.split(/\s+/).filter((w) => w.length > 3));

    const intersection = [...extractedWords].filter((w) => existingWords.has(w));
    const union = new Set([...extractedWords, ...existingWords]);

    const similarity = intersection.length / union.size;
    if (similarity >= 0.5) {
      return pattern;
    }
  }

  return null;
}

export function storeExtractedPatterns(
  extracted: ExtractedPattern[],
  existingPatterns: ExistingPattern[]
): { created: number; reinforced: number } {
  let created = 0;
  let reinforced = 0;

  const existingPatternsFromDb = listPatterns({ limit: 500 });

  for (const pattern of extracted) {
    if (pattern.isNew || pattern.relatedExistingId === undefined) {
      const similar = findSimilarPattern(pattern, existingPatterns);

      if (similar) {
        const dbPattern = existingPatternsFromDb.find(
          (p) => p.patternType === similar.type && p.description === similar.description
        );
        if (dbPattern) {
          incrementEvidenceCount(dbPattern.id);
          reinforced++;
        }
      } else {
        createPattern({
          patternType: pattern.type,
          description: pattern.description,
          evidenceCount: pattern.evidence.length,
        });
        created++;
      }
    } else {
      incrementEvidenceCount(pattern.relatedExistingId);
      reinforced++;
    }
  }

  return { created, reinforced };
}

export async function processFeedback(
  options: ProcessFeedbackOptions = {}
): Promise<FeedbackProcessingResult> {
  const { batchSize = DEFAULT_BATCH_SIZE, minFeedbackItems = MIN_FEEDBACK_FOR_PROCESSING } =
    options;

  try {
    const totalFeedback = countFeedback();
    if (totalFeedback < minFeedbackItems) {
      return {
        feedbackProcessed: 0,
        patternsExtracted: 0,
        patternsReinforced: 0,
        contradictions: [],
        clarificationNeeded: [],
        costUsd: 0,
        success: true,
        error: `Not enough feedback to process (have ${totalFeedback}, need ${minFeedbackItems})`,
      };
    }

    const batch = collectFeedbackBatch({
      limit: batchSize,
      afterDate: options.lastProcessedAt,
    });

    if (batch.feedbackItems.length < minFeedbackItems) {
      return {
        feedbackProcessed: 0,
        patternsExtracted: 0,
        patternsReinforced: 0,
        contradictions: [],
        clarificationNeeded: [],
        costUsd: 0,
        success: true,
        error: `Not enough actionable feedback in batch (have ${batch.feedbackItems.length}, need ${minFeedbackItems})`,
      };
    }

    const existingPatterns = getExistingPatternsForContext();

    const guidelines = await getVoiceGuidelinesFromQdrant();
    const voiceGuidelinesText = formatGuidelinesForPrompt(guidelines);

    const { response, costUsd } = await extractPatternsWithLlm(
      batch.feedbackItems,
      existingPatterns,
      voiceGuidelinesText
    );

    const { created, reinforced } = storeExtractedPatterns(response.patterns, existingPatterns);

    return {
      feedbackProcessed: batch.feedbackItems.length,
      patternsExtracted: created,
      patternsReinforced: reinforced,
      contradictions: response.contradictions,
      clarificationNeeded: response.clarificationNeeded,
      costUsd,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      feedbackProcessed: 0,
      patternsExtracted: 0,
      patternsReinforced: 0,
      contradictions: [],
      clarificationNeeded: [],
      costUsd: 0,
      success: false,
      error: message,
    };
  }
}

export function getFeedbackStats(): {
  total: number;
  byAction: Record<string, number>;
  byCategory: Record<string, number>;
} {
  const total = countFeedback();
  const approvals = countFeedback({ action: 'approve' });
  const rejections = countFeedback({ action: 'reject' });
  const edits = countFeedback({ action: 'edit' });

  const categories: FeedbackCategory[] = [
    'generic',
    'tone',
    'hook',
    'value',
    'topic',
    'timing',
    'other',
  ];
  const byCategory: Record<string, number> = {};

  const rejectedFeedback = listFeedback({ action: 'reject', limit: 1000 });
  for (const cat of categories) {
    byCategory[cat] = rejectedFeedback.filter((f) => f.category === cat).length;
  }

  return {
    total,
    byAction: {
      approve: approvals,
      reject: rejections,
      edit: edits,
    },
    byCategory,
  };
}

export function formatFeedbackProcessingResult(result: FeedbackProcessingResult): string {
  const lines: string[] = [];

  lines.push('=== Feedback Processing Result ===');
  lines.push(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);

  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  lines.push(`Feedback processed: ${result.feedbackProcessed}`);
  lines.push(`Patterns extracted (new): ${result.patternsExtracted}`);
  lines.push(`Patterns reinforced: ${result.patternsReinforced}`);
  lines.push(`Cost: $${result.costUsd.toFixed(4)}`);

  if (result.contradictions.length > 0) {
    lines.push('\n--- Contradictions Found ---');
    for (const c of result.contradictions) {
      lines.push(`• "${c.patternA}" vs "${c.patternB}"`);
      lines.push(`  Reason: ${c.explanation}`);
    }
  }

  if (result.clarificationNeeded.length > 0) {
    lines.push('\n--- Clarification Needed ---');
    for (const c of result.clarificationNeeded) {
      lines.push(`• ${c.question}`);
      lines.push(`  Context: ${c.context}`);
      lines.push(`  Options: ${c.options.join(' | ')}`);
    }
  }

  return lines.join('\n');
}

export interface RejectionsByCategory {
  category: FeedbackCategory;
  count: number;
  feedbackItems: FeedbackItem[];
  feedbackIds: number[];
}

export interface CategoryPatternResult {
  category: FeedbackCategory;
  patterns: ExtractedPattern[];
  feedbackCount: number;
}

export interface ExtractPatternsByCategoryResult {
  byCategory: CategoryPatternResult[];
  totalPatternsExtracted: number;
  totalPatternsReinforced: number;
  totalCostUsd: number;
  contradictions: Contradiction[];
  clarificationNeeded: ClarificationRequest[];
  success: boolean;
  error?: string;
}

const ALL_CATEGORIES: FeedbackCategory[] = [
  'generic',
  'tone',
  'hook',
  'value',
  'topic',
  'timing',
  'other',
];

const MIN_ITEMS_PER_CATEGORY = 2;

export function groupRejectionsByCategory(options: {
  limit?: number;
  afterDate?: string;
}): RejectionsByCategory[] {
  const { limit = 200, afterDate } = options;

  const rejections = listFeedback({
    action: 'reject',
    limit,
    orderDir: 'desc',
  });

  const grouped = new Map<FeedbackCategory, { items: FeedbackItem[]; ids: number[] }>();

  for (const cat of ALL_CATEGORIES) {
    grouped.set(cat, { items: [], ids: [] });
  }

  for (const feedback of rejections) {
    if (afterDate && feedback.createdAt <= afterDate) {
      continue;
    }

    const category = feedback.category ?? 'other';
    const post = getPostById(feedback.postId);
    if (!post) {
      continue;
    }

    const item = feedbackToItem(feedback, post.content);
    if (item) {
      const group = grouped.get(category);
      if (group) {
        group.items.push(item);
        group.ids.push(feedback.id);
      }
    }
  }

  const results: RejectionsByCategory[] = [];
  for (const cat of ALL_CATEGORIES) {
    const group = grouped.get(cat);
    if (group && group.items.length > 0) {
      results.push({
        category: cat,
        count: group.items.length,
        feedbackItems: group.items,
        feedbackIds: group.ids,
      });
    }
  }

  return results.sort((a, b) => b.count - a.count);
}

export async function extractPatternsByCategory(options: {
  minItemsPerCategory?: number;
  afterDate?: string;
}): Promise<ExtractPatternsByCategoryResult> {
  const { minItemsPerCategory = MIN_ITEMS_PER_CATEGORY, afterDate } = options;

  try {
    const grouped = groupRejectionsByCategory({ afterDate });
    const existingPatterns = getExistingPatternsForContext();

    const guidelines = await getVoiceGuidelinesFromQdrant();
    const voiceGuidelinesText = formatGuidelinesForPrompt(guidelines);

    const results: CategoryPatternResult[] = [];
    let totalPatternsExtracted = 0;
    let totalPatternsReinforced = 0;
    let totalCostUsd = 0;
    const allContradictions: Contradiction[] = [];
    const allClarifications: ClarificationRequest[] = [];

    for (const group of grouped) {
      if (group.count < minItemsPerCategory) {
        continue;
      }

      const { response, costUsd } = await extractPatternsWithLlm(
        group.feedbackItems,
        existingPatterns,
        voiceGuidelinesText
      );

      const { created, reinforced } = storeExtractedPatterns(response.patterns, existingPatterns);

      results.push({
        category: group.category,
        patterns: response.patterns,
        feedbackCount: group.count,
      });

      totalPatternsExtracted += created;
      totalPatternsReinforced += reinforced;
      totalCostUsd += costUsd;
      allContradictions.push(...response.contradictions);
      allClarifications.push(...response.clarificationNeeded);

      for (const pattern of response.patterns) {
        if (pattern.isNew && pattern.relatedExistingId === undefined) {
          existingPatterns.push({
            type: pattern.type,
            description: pattern.description,
            evidenceCount: pattern.evidence.length,
          });
        }
      }
    }

    return {
      byCategory: results,
      totalPatternsExtracted,
      totalPatternsReinforced,
      totalCostUsd,
      contradictions: allContradictions,
      clarificationNeeded: allClarifications,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      byCategory: [],
      totalPatternsExtracted: 0,
      totalPatternsReinforced: 0,
      totalCostUsd: 0,
      contradictions: [],
      clarificationNeeded: [],
      success: false,
      error: message,
    };
  }
}

export function getRejectionPatternSummary(): {
  byCategory: { category: FeedbackCategory; count: number; topPatterns: string[] }[];
  totalRejections: number;
  mostCommonCategory: FeedbackCategory | null;
} {
  const grouped = groupRejectionsByCategory({});
  const totalRejections = grouped.reduce((sum, g) => sum + g.count, 0);

  const patterns = listPatterns({
    patternType: 'rejection',
    limit: 100,
    orderBy: 'evidence_count',
    orderDir: 'desc',
  });

  const byCategory = grouped.map((g) => {
    const categoryPatterns = patterns
      .filter((p) => p.description.toLowerCase().includes(g.category.toLowerCase()))
      .slice(0, 3)
      .map((p) => p.description);

    return {
      category: g.category,
      count: g.count,
      topPatterns: categoryPatterns,
    };
  });

  return {
    byCategory,
    totalRejections,
    mostCommonCategory: grouped.length > 0 ? grouped[0].category : null,
  };
}

export function formatCategoryPatternResult(result: ExtractPatternsByCategoryResult): string {
  const lines: string[] = [];

  lines.push('=== Pattern Extraction by Category ===');
  lines.push(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);

  if (result.error) {
    lines.push(`Error: ${result.error}`);
    return lines.join('\n');
  }

  lines.push(`Total patterns extracted: ${result.totalPatternsExtracted}`);
  lines.push(`Total patterns reinforced: ${result.totalPatternsReinforced}`);
  lines.push(`Total cost: $${result.totalCostUsd.toFixed(4)}`);

  if (result.byCategory.length === 0) {
    lines.push('\nNo categories had enough feedback for pattern extraction.');
    return lines.join('\n');
  }

  lines.push('\n--- Patterns by Category ---');

  for (const cat of result.byCategory) {
    lines.push(`\n[${cat.category.toUpperCase()}] (${cat.feedbackCount} rejections)`);

    if (cat.patterns.length === 0) {
      lines.push('  No patterns extracted (insufficient evidence)');
    } else {
      for (const p of cat.patterns) {
        lines.push(`  • [${p.type}] ${p.description}`);
        lines.push(`    Confidence: ${p.confidence}%, Evidence: ${p.evidence.length} items`);
      }
    }
  }

  if (result.contradictions.length > 0) {
    lines.push('\n--- Contradictions Found ---');
    for (const c of result.contradictions) {
      lines.push(`• "${c.patternA}" vs "${c.patternB}"`);
      lines.push(`  Reason: ${c.explanation}`);
    }
  }

  if (result.clarificationNeeded.length > 0) {
    lines.push('\n--- Clarification Needed ---');
    for (const c of result.clarificationNeeded) {
      lines.push(`• ${c.question}`);
      lines.push(`  Context: ${c.context}`);
      lines.push(`  Options: ${c.options.join(' | ')}`);
    }
  }

  return lines.join('\n');
}
