import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { closeDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createPost } from '@/db/models/posts';
import { createFeedback } from '@/db/models/feedback';
import { createPattern, listPatterns } from '@/db/models/patterns';

import {
  feedbackToItem,
  collectFeedbackBatch,
  getExistingPatternsForContext,
  storeExtractedPatterns,
  getFeedbackStats,
  groupRejectionsByCategory,
  getRejectionPatternSummary,
  formatFeedbackProcessingResult,
  formatCategoryPatternResult,
  FeedbackProcessingResult,
  ExtractPatternsByCategoryResult,
} from './feedback-processor';

import type { Feedback } from '@/types';
import type { ExtractedPattern, ExistingPattern } from '@/lib/anthropic/prompts/pattern-extraction';

const TEST_DB_PATH = './data/test-feedback-processor.db';

beforeAll(() => {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
});

afterAll(() => {
  closeDb();
  resetDb();
  delete process.env.SQLITE_DB_PATH;
});

beforeEach(() => {
  resetDb();
  runMigrations();
});

afterEach(() => {
  closeDb();
});

describe('feedbackToItem', () => {
  it('returns null for approve actions', () => {
    const feedback: Feedback = {
      id: 1,
      postId: 1,
      action: 'approve',
      category: null,
      comment: null,
      diffBefore: null,
      diffAfter: null,
      createdAt: new Date().toISOString(),
    };

    const result = feedbackToItem(feedback, 'original content');
    expect(result).toBeNull();
  });

  it('converts reject feedback to FeedbackItem', () => {
    const feedback: Feedback = {
      id: 1,
      postId: 1,
      action: 'reject',
      category: 'tone',
      comment: 'Too formal',
      diffBefore: null,
      diffAfter: null,
      createdAt: new Date().toISOString(),
    };

    const result = feedbackToItem(feedback, 'original content');

    expect(result).not.toBeNull();
    expect(result?.action).toBe('reject');
    expect(result?.category).toBe('tone');
    expect(result?.comment).toBe('Too formal');
    expect(result?.originalContent).toBe('original content');
    expect(result?.editedContent).toBeUndefined();
  });

  it('converts edit feedback with diffs to FeedbackItem', () => {
    const feedback: Feedback = {
      id: 1,
      postId: 1,
      action: 'edit',
      category: 'hook',
      comment: 'Made it snappier',
      diffBefore: 'Before text',
      diffAfter: 'After text',
      createdAt: new Date().toISOString(),
    };

    const result = feedbackToItem(feedback, 'Before text');

    expect(result).not.toBeNull();
    expect(result?.action).toBe('edit');
    expect(result?.editedContent).toBe('After text');
  });

  it('handles null category and comment', () => {
    const feedback: Feedback = {
      id: 1,
      postId: 1,
      action: 'reject',
      category: null,
      comment: null,
      diffBefore: null,
      diffAfter: null,
      createdAt: new Date().toISOString(),
    };

    const result = feedbackToItem(feedback, 'content');

    expect(result).not.toBeNull();
    expect(result?.category).toBeNull();
    expect(result?.comment).toBeNull();
  });
});

describe('collectFeedbackBatch', () => {
  beforeEach(() => {
    const post1 = createPost({ content: 'Post 1 content', type: 'single' });
    const post2 = createPost({ content: 'Post 2 content', type: 'single' });
    const post3 = createPost({ content: 'Post 3 content', type: 'thread' });

    createFeedback({ postId: post1.id, action: 'approve' });
    createFeedback({ postId: post1.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post2.id, action: 'edit', category: 'hook' });
    createFeedback({ postId: post3.id, action: 'reject', category: 'generic' });
  });

  it('collects only reject and edit feedback', () => {
    const batch = collectFeedbackBatch({ limit: 10 });

    expect(batch.feedbackItems.length).toBe(3);
    expect(batch.feedbackIds.length).toBe(3);

    const actions = batch.feedbackItems.map((item) => item.action);
    expect(actions).not.toContain('approve');
  });

  it('respects limit parameter', () => {
    const batch = collectFeedbackBatch({ limit: 2 });

    expect(batch.feedbackItems.length).toBeLessThanOrEqual(2);
  });

  it('includes post content as originalContent', () => {
    const batch = collectFeedbackBatch({ limit: 10 });

    for (const item of batch.feedbackItems) {
      expect(item.originalContent).toBeDefined();
      expect(item.originalContent.length).toBeGreaterThan(0);
    }
  });

  it('returns empty batch when no actionable feedback', () => {
    resetDb();
    runMigrations();

    const post = createPost({ content: 'Test', type: 'single' });
    createFeedback({ postId: post.id, action: 'approve' });

    const batch = collectFeedbackBatch({ limit: 10 });

    expect(batch.feedbackItems.length).toBe(0);
    expect(batch.feedbackIds.length).toBe(0);
  });

  it('filters by afterDate', () => {
    resetDb();
    runMigrations();

    const post = createPost({ content: 'Test', type: 'single' });

    createFeedback({ postId: post.id, action: 'reject', category: 'tone' });

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const batch = collectFeedbackBatch({
      limit: 10,
      afterDate: futureDate.toISOString(),
    });

    expect(batch.feedbackItems.length).toBe(0);
  });
});

describe('getExistingPatternsForContext', () => {
  it('returns empty array when no patterns exist', () => {
    const patterns = getExistingPatternsForContext();
    expect(patterns).toEqual([]);
  });

  it('returns patterns with correct structure', () => {
    createPattern({
      patternType: 'voice',
      description: 'Use short sentences',
      evidenceCount: 5,
    });
    createPattern({
      patternType: 'hook',
      description: 'Start with a question',
      evidenceCount: 3,
    });

    const patterns = getExistingPatternsForContext();

    expect(patterns.length).toBe(2);
    expect(patterns[0]).toHaveProperty('type');
    expect(patterns[0]).toHaveProperty('description');
    expect(patterns[0]).toHaveProperty('evidenceCount');
  });

  it('orders patterns by evidence count descending', () => {
    createPattern({
      patternType: 'voice',
      description: 'Low evidence',
      evidenceCount: 1,
    });
    createPattern({
      patternType: 'hook',
      description: 'High evidence',
      evidenceCount: 10,
    });

    const patterns = getExistingPatternsForContext();

    expect(patterns[0].evidenceCount).toBe(10);
    expect(patterns[1].evidenceCount).toBe(1);
  });
});

describe('storeExtractedPatterns', () => {
  it('creates new patterns when none exist', () => {
    const extracted: ExtractedPattern[] = [
      {
        type: 'voice',
        description: 'Brand new pattern',
        confidence: 80,
        evidence: ['Example 1', 'Example 2'],
        isNew: true,
      },
    ];

    const result = storeExtractedPatterns(extracted, []);

    expect(result.created).toBe(1);
    expect(result.reinforced).toBe(0);

    const patterns = listPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].description).toBe('Brand new pattern');
  });

  it('reinforces existing patterns when similar', () => {
    createPattern({
      patternType: 'voice',
      description: 'Use short concise sentences',
      evidenceCount: 5,
    });

    const existingPatterns: ExistingPattern[] = [
      {
        type: 'voice',
        description: 'Use short concise sentences',
        evidenceCount: 5,
      },
    ];

    const extracted: ExtractedPattern[] = [
      {
        type: 'voice',
        description: 'Use short sentences that are concise',
        confidence: 75,
        evidence: ['Example'],
        isNew: true,
      },
    ];

    const result = storeExtractedPatterns(extracted, existingPatterns);

    expect(result.reinforced).toBe(1);
    expect(result.created).toBe(0);

    const patterns = listPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].evidenceCount).toBe(6);
  });

  it('handles patterns with relatedExistingId', () => {
    const existingPattern = createPattern({
      patternType: 'hook',
      description: 'Start with problem',
      evidenceCount: 3,
    });

    const extracted: ExtractedPattern[] = [
      {
        type: 'hook',
        description: 'Start with the problem',
        confidence: 90,
        evidence: ['Example'],
        isNew: false,
        relatedExistingId: existingPattern.id,
      },
    ];

    const result = storeExtractedPatterns(extracted, []);

    expect(result.reinforced).toBe(1);
    expect(result.created).toBe(0);

    const patterns = listPatterns();
    expect(patterns[0].evidenceCount).toBe(4);
  });

  it('creates pattern when types differ even if similar text', () => {
    createPattern({
      patternType: 'voice',
      description: 'Be direct and concise',
      evidenceCount: 5,
    });

    const existingPatterns: ExistingPattern[] = [
      {
        type: 'voice',
        description: 'Be direct and concise',
        evidenceCount: 5,
      },
    ];

    const extracted: ExtractedPattern[] = [
      {
        type: 'hook',
        description: 'Be direct and concise in the opening',
        confidence: 80,
        evidence: ['Example 1', 'Example 2'],
        isNew: true,
      },
    ];

    const result = storeExtractedPatterns(extracted, existingPatterns);

    expect(result.created).toBe(1);

    const patterns = listPatterns();
    expect(patterns.length).toBe(2);
  });
});

describe('getFeedbackStats', () => {
  beforeEach(() => {
    const post1 = createPost({ content: 'Post 1', type: 'single' });
    const post2 = createPost({ content: 'Post 2', type: 'single' });

    createFeedback({ postId: post1.id, action: 'approve' });
    createFeedback({ postId: post1.id, action: 'approve' });
    createFeedback({ postId: post1.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post2.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post2.id, action: 'reject', category: 'hook' });
    createFeedback({ postId: post2.id, action: 'edit' });
  });

  it('returns correct total count', () => {
    const stats = getFeedbackStats();
    expect(stats.total).toBe(6);
  });

  it('returns correct counts by action', () => {
    const stats = getFeedbackStats();

    expect(stats.byAction.approve).toBe(2);
    expect(stats.byAction.reject).toBe(3);
    expect(stats.byAction.edit).toBe(1);
  });

  it('returns correct counts by category', () => {
    const stats = getFeedbackStats();

    expect(stats.byCategory.tone).toBe(2);
    expect(stats.byCategory.hook).toBe(1);
    expect(stats.byCategory.generic).toBe(0);
  });

  it('returns all zero counts when no feedback', () => {
    resetDb();
    runMigrations();

    const stats = getFeedbackStats();

    expect(stats.total).toBe(0);
    expect(stats.byAction.approve).toBe(0);
    expect(stats.byAction.reject).toBe(0);
    expect(stats.byAction.edit).toBe(0);
  });
});

describe('groupRejectionsByCategory', () => {
  beforeEach(() => {
    const post1 = createPost({ content: 'Post 1', type: 'single' });
    const post2 = createPost({ content: 'Post 2', type: 'single' });
    const post3 = createPost({ content: 'Post 3', type: 'thread' });

    createFeedback({ postId: post1.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post1.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post2.id, action: 'reject', category: 'hook' });
    createFeedback({ postId: post3.id, action: 'reject', category: 'generic' });
    createFeedback({ postId: post3.id, action: 'approve' });
  });

  it('groups rejections by category', () => {
    const grouped = groupRejectionsByCategory({});

    const toneGroup = grouped.find((g) => g.category === 'tone');
    const hookGroup = grouped.find((g) => g.category === 'hook');
    const genericGroup = grouped.find((g) => g.category === 'generic');

    expect(toneGroup?.count).toBe(2);
    expect(hookGroup?.count).toBe(1);
    expect(genericGroup?.count).toBe(1);
  });

  it('excludes approve actions', () => {
    const grouped = groupRejectionsByCategory({});

    const totalItems = grouped.reduce((sum, g) => sum + g.count, 0);
    expect(totalItems).toBe(4);
  });

  it('sorts by count descending', () => {
    const grouped = groupRejectionsByCategory({});

    expect(grouped[0].category).toBe('tone');
    expect(grouped[0].count).toBe(2);
  });

  it('includes feedbackItems and feedbackIds', () => {
    const grouped = groupRejectionsByCategory({});

    for (const group of grouped) {
      expect(group.feedbackItems.length).toBe(group.count);
      expect(group.feedbackIds.length).toBe(group.count);
    }
  });

  it('handles null category as other', () => {
    resetDb();
    runMigrations();

    const post = createPost({ content: 'Test', type: 'single' });
    createFeedback({ postId: post.id, action: 'reject' });

    const grouped = groupRejectionsByCategory({});

    const otherGroup = grouped.find((g) => g.category === 'other');
    expect(otherGroup?.count).toBe(1);
  });

  it('respects limit parameter', () => {
    const grouped = groupRejectionsByCategory({ limit: 2 });

    const totalItems = grouped.reduce((sum, g) => sum + g.count, 0);
    expect(totalItems).toBeLessThanOrEqual(2);
  });

  it('returns empty array when no rejections', () => {
    resetDb();
    runMigrations();

    const post = createPost({ content: 'Test', type: 'single' });
    createFeedback({ postId: post.id, action: 'approve' });

    const grouped = groupRejectionsByCategory({});

    expect(grouped.length).toBe(0);
  });
});

describe('getRejectionPatternSummary', () => {
  beforeEach(() => {
    const post = createPost({ content: 'Test', type: 'single' });
    createFeedback({ postId: post.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post.id, action: 'reject', category: 'tone' });
    createFeedback({ postId: post.id, action: 'reject', category: 'hook' });

    createPattern({
      patternType: 'rejection',
      description: 'Avoid formal tone in posts',
      evidenceCount: 5,
    });
  });

  it('returns total rejection count', () => {
    const summary = getRejectionPatternSummary();
    expect(summary.totalRejections).toBe(3);
  });

  it('returns most common category', () => {
    const summary = getRejectionPatternSummary();
    expect(summary.mostCommonCategory).toBe('tone');
  });

  it('includes category breakdown with counts', () => {
    const summary = getRejectionPatternSummary();

    const toneCategory = summary.byCategory.find((c) => c.category === 'tone');
    expect(toneCategory?.count).toBe(2);
  });

  it('returns null mostCommonCategory when no rejections', () => {
    resetDb();
    runMigrations();

    const summary = getRejectionPatternSummary();
    expect(summary.mostCommonCategory).toBeNull();
  });
});

describe('formatFeedbackProcessingResult', () => {
  it('formats successful result', () => {
    const result: FeedbackProcessingResult = {
      feedbackProcessed: 10,
      patternsExtracted: 3,
      patternsReinforced: 2,
      contradictions: [],
      clarificationNeeded: [],
      costUsd: 0.0123,
      success: true,
    };

    const formatted = formatFeedbackProcessingResult(result);

    expect(formatted).toContain('SUCCESS');
    expect(formatted).toContain('Feedback processed: 10');
    expect(formatted).toContain('Patterns extracted (new): 3');
    expect(formatted).toContain('Patterns reinforced: 2');
    expect(formatted).toContain('Cost: $0.0123');
  });

  it('formats failed result with error', () => {
    const result: FeedbackProcessingResult = {
      feedbackProcessed: 0,
      patternsExtracted: 0,
      patternsReinforced: 0,
      contradictions: [],
      clarificationNeeded: [],
      costUsd: 0,
      success: false,
      error: 'API call failed',
    };

    const formatted = formatFeedbackProcessingResult(result);

    expect(formatted).toContain('FAILED');
    expect(formatted).toContain('Error: API call failed');
  });

  it('formats result with contradictions', () => {
    const result: FeedbackProcessingResult = {
      feedbackProcessed: 5,
      patternsExtracted: 2,
      patternsReinforced: 1,
      contradictions: [
        {
          patternA: 'Use short sentences',
          patternB: 'Use detailed explanations',
          explanation: 'These seem contradictory',
        },
      ],
      clarificationNeeded: [],
      costUsd: 0.05,
      success: true,
    };

    const formatted = formatFeedbackProcessingResult(result);

    expect(formatted).toContain('Contradictions Found');
    expect(formatted).toContain('Use short sentences');
    expect(formatted).toContain('Use detailed explanations');
    expect(formatted).toContain('These seem contradictory');
  });

  it('formats result with clarification needed', () => {
    const result: FeedbackProcessingResult = {
      feedbackProcessed: 5,
      patternsExtracted: 1,
      patternsReinforced: 0,
      contradictions: [],
      clarificationNeeded: [
        {
          question: 'Should posts be formal or casual?',
          context: 'Mixed feedback on tone',
          options: ['Formal', 'Casual', 'Depends on topic'],
        },
      ],
      costUsd: 0.03,
      success: true,
    };

    const formatted = formatFeedbackProcessingResult(result);

    expect(formatted).toContain('Clarification Needed');
    expect(formatted).toContain('Should posts be formal or casual?');
    expect(formatted).toContain('Mixed feedback on tone');
    expect(formatted).toContain('Formal | Casual | Depends on topic');
  });
});

describe('formatCategoryPatternResult', () => {
  it('formats successful result with patterns', () => {
    const result: ExtractPatternsByCategoryResult = {
      byCategory: [
        {
          category: 'tone',
          patterns: [
            {
              type: 'voice',
              description: 'Avoid formal language',
              confidence: 85,
              evidence: ['Example 1', 'Example 2'],
              isNew: true,
            },
          ],
          feedbackCount: 5,
        },
      ],
      totalPatternsExtracted: 1,
      totalPatternsReinforced: 0,
      totalCostUsd: 0.05,
      contradictions: [],
      clarificationNeeded: [],
      success: true,
    };

    const formatted = formatCategoryPatternResult(result);

    expect(formatted).toContain('SUCCESS');
    expect(formatted).toContain('Total patterns extracted: 1');
    expect(formatted).toContain('Total cost: $0.0500');
    expect(formatted).toContain('[TONE]');
    expect(formatted).toContain('5 rejections');
    expect(formatted).toContain('Avoid formal language');
    expect(formatted).toContain('Confidence: 85%');
  });

  it('formats failed result', () => {
    const result: ExtractPatternsByCategoryResult = {
      byCategory: [],
      totalPatternsExtracted: 0,
      totalPatternsReinforced: 0,
      totalCostUsd: 0,
      contradictions: [],
      clarificationNeeded: [],
      success: false,
      error: 'Database error',
    };

    const formatted = formatCategoryPatternResult(result);

    expect(formatted).toContain('FAILED');
    expect(formatted).toContain('Error: Database error');
  });

  it('formats result with no categories', () => {
    const result: ExtractPatternsByCategoryResult = {
      byCategory: [],
      totalPatternsExtracted: 0,
      totalPatternsReinforced: 0,
      totalCostUsd: 0,
      contradictions: [],
      clarificationNeeded: [],
      success: true,
    };

    const formatted = formatCategoryPatternResult(result);

    expect(formatted).toContain('No categories had enough feedback');
  });

  it('formats category with no patterns', () => {
    const result: ExtractPatternsByCategoryResult = {
      byCategory: [
        {
          category: 'hook',
          patterns: [],
          feedbackCount: 2,
        },
      ],
      totalPatternsExtracted: 0,
      totalPatternsReinforced: 0,
      totalCostUsd: 0.01,
      contradictions: [],
      clarificationNeeded: [],
      success: true,
    };

    const formatted = formatCategoryPatternResult(result);

    expect(formatted).toContain('[HOOK]');
    expect(formatted).toContain('No patterns extracted (insufficient evidence)');
  });

  it('formats result with contradictions and clarifications', () => {
    const result: ExtractPatternsByCategoryResult = {
      byCategory: [
        {
          category: 'tone',
          patterns: [],
          feedbackCount: 3,
        },
      ],
      totalPatternsExtracted: 0,
      totalPatternsReinforced: 0,
      totalCostUsd: 0.02,
      contradictions: [
        {
          patternA: 'Pattern A',
          patternB: 'Pattern B',
          explanation: 'They conflict',
        },
      ],
      clarificationNeeded: [
        {
          question: 'Which approach?',
          context: 'Unclear preference',
          options: ['Option 1', 'Option 2'],
        },
      ],
      success: true,
    };

    const formatted = formatCategoryPatternResult(result);

    expect(formatted).toContain('Contradictions Found');
    expect(formatted).toContain('Pattern A');
    expect(formatted).toContain('Clarification Needed');
    expect(formatted).toContain('Which approach?');
  });
});

describe('edge cases', () => {
  it('handles post without content gracefully', () => {
    const post = createPost({ content: '', type: 'single' });
    createFeedback({ postId: post.id, action: 'reject', category: 'generic' });

    const batch = collectFeedbackBatch({ limit: 10 });

    expect(batch.feedbackItems.length).toBe(1);
    expect(batch.feedbackItems[0].originalContent).toBe('');
  });

  it('handles feedback for deleted post', () => {
    const post = createPost({ content: 'Test', type: 'single' });
    const postId = post.id;

    createFeedback({ postId, action: 'reject', category: 'tone' });

    resetDb();
    runMigrations();

    const batch = collectFeedbackBatch({ limit: 10 });
    expect(batch.feedbackItems.length).toBe(0);
  });

  it('handles very long pattern descriptions', () => {
    const longDescription = 'A'.repeat(1000);

    const extracted: ExtractedPattern[] = [
      {
        type: 'voice',
        description: longDescription,
        confidence: 75,
        evidence: ['Example'],
        isNew: true,
      },
    ];

    const result = storeExtractedPatterns(extracted, []);
    expect(result.created).toBe(1);

    const patterns = listPatterns();
    expect(patterns[0].description).toBe(longDescription);
  });

  it('handles multiple patterns with same description but different types', () => {
    const extracted: ExtractedPattern[] = [
      {
        type: 'voice',
        description: 'Same description',
        confidence: 80,
        evidence: ['Ex1'],
        isNew: true,
      },
      {
        type: 'hook',
        description: 'Same description',
        confidence: 80,
        evidence: ['Ex2'],
        isNew: true,
      },
    ];

    const result = storeExtractedPatterns(extracted, []);

    expect(result.created).toBe(2);

    const patterns = listPatterns();
    expect(patterns.length).toBe(2);
  });
});
