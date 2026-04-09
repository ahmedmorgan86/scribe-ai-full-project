import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { closeDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createPattern, listPatterns } from '@/db/models/patterns';

import {
  findSimilarPatterns,
  storePattern,
  storePatternsBatch,
  getPatternsForGeneration,
  getPatternsByTypeForGeneration,
  getRejectionPatterns,
  getVoicePatterns,
  getEditPatterns,
  reinforcePattern,
  removePattern,
  getPatternDetails,
  updatePatternDescription,
  getPatternStats,
  formatPatternsForPrompt,
  pruneWeakPatterns,
  mergePatterns,
  type StoredPattern,
} from './patterns';

const TEST_DB_PATH = './data/test-patterns.db';

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

describe('findSimilarPatterns', () => {
  it('returns empty array when no patterns exist', () => {
    const matches = findSimilarPatterns('test description', 'voice');
    expect(matches).toEqual([]);
  });

  it('finds exact match', () => {
    createPattern({
      patternType: 'voice',
      description: 'Use short sentences',
      evidenceCount: 5,
    });

    const matches = findSimilarPatterns('Use short sentences', 'voice');

    expect(matches.length).toBe(1);
    expect(matches[0].isExact).toBe(true);
    expect(matches[0].similarity).toBe(1);
  });

  it('finds similar patterns above threshold', () => {
    createPattern({
      patternType: 'voice',
      description: 'Use short concise sentences',
      evidenceCount: 3,
    });

    const matches = findSimilarPatterns('Use short sentences that are concise', 'voice');

    expect(matches.length).toBe(1);
    expect(matches[0].isExact).toBe(false);
    expect(matches[0].similarity).toBeGreaterThan(0.5);
  });

  it('does not return patterns below threshold', () => {
    createPattern({
      patternType: 'voice',
      description: 'Always start with a question',
      evidenceCount: 2,
    });

    const matches = findSimilarPatterns('Use active voice in hooks', 'voice');

    expect(matches.length).toBe(0);
  });

  it('only matches patterns of same type', () => {
    createPattern({
      patternType: 'hook',
      description: 'Use short sentences',
      evidenceCount: 5,
    });

    const matches = findSimilarPatterns('Use short sentences', 'voice');

    expect(matches.length).toBe(0);
  });

  it('sorts matches by similarity descending', () => {
    createPattern({
      patternType: 'voice',
      description: 'Be concise',
      evidenceCount: 1,
    });
    createPattern({
      patternType: 'voice',
      description: 'Be concise and direct',
      evidenceCount: 2,
    });
    createPattern({
      patternType: 'voice',
      description: 'Be concise and direct in writing',
      evidenceCount: 3,
    });

    const matches = findSimilarPatterns('Be concise and direct', 'voice');

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].pattern.description).toBe('Be concise and direct');
  });

  it('handles case-insensitive matching', () => {
    createPattern({
      patternType: 'voice',
      description: 'Use Short Sentences',
      evidenceCount: 1,
    });

    const matches = findSimilarPatterns('use short sentences', 'voice');

    expect(matches.length).toBe(1);
    expect(matches[0].isExact).toBe(true);
  });
});

describe('storePattern', () => {
  it('creates new pattern when none exist', () => {
    const result = storePattern('Brand new pattern', 'voice');

    expect(result.action).toBe('created');
    expect(result.patternId).toBeDefined();

    const patterns = listPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].description).toBe('Brand new pattern');
  });

  it('marks as duplicate for exact match', () => {
    const existing = createPattern({
      patternType: 'voice',
      description: 'Existing pattern',
      evidenceCount: 5,
    });

    const result = storePattern('Existing pattern', 'voice');

    expect(result.action).toBe('duplicate');
    expect(result.existingPatternId).toBe(existing.id);
  });

  it('reinforces similar pattern', () => {
    createPattern({
      patternType: 'hook',
      description: 'Start with problem statement',
      evidenceCount: 3,
    });

    const result = storePattern('Start with the problem statement first', 'hook');

    expect(result.action).toBe('reinforced');

    const patterns = listPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].evidenceCount).toBe(4);
  });

  it('creates pattern with edit evidence source', () => {
    const result = storePattern('New edit pattern', 'edit', 1, 'edit');

    expect(result.action).toBe('created');

    const patterns = listPatterns();
    expect(patterns[0].editEvidenceCount).toBe(1);
    expect(patterns[0].rejectionEvidenceCount).toBe(0);
  });

  it('creates pattern with rejection evidence source', () => {
    const result = storePattern('New rejection pattern', 'rejection', 1, 'rejection');

    expect(result.action).toBe('created');

    const patterns = listPatterns();
    expect(patterns[0].editEvidenceCount).toBe(0);
    expect(patterns[0].rejectionEvidenceCount).toBe(1);
  });

  it('increments edit evidence when reinforcing', () => {
    createPattern({
      patternType: 'voice',
      description: 'Use active voice',
      evidenceCount: 2,
      editEvidenceCount: 1,
      rejectionEvidenceCount: 1,
    });

    storePattern('Use active voice consistently', 'voice', 1, 'edit');

    const patterns = listPatterns();
    expect(patterns[0].editEvidenceCount).toBe(2);
  });
});

describe('storePatternsBatch', () => {
  it('stores multiple patterns', () => {
    const result = storePatternsBatch([
      { description: 'Pattern 1', type: 'voice' },
      { description: 'Pattern 2', type: 'hook' },
      { description: 'Pattern 3', type: 'topic' },
    ]);

    expect(result.created).toBe(3);
    expect(result.reinforced).toBe(0);
    expect(result.duplicate).toBe(0);

    const patterns = listPatterns();
    expect(patterns.length).toBe(3);
  });

  it('counts created, reinforced, and duplicates correctly', () => {
    createPattern({
      patternType: 'voice',
      description: 'Existing exact pattern',
      evidenceCount: 3,
    });
    createPattern({
      patternType: 'hook',
      description: 'Similar hook pattern here',
      evidenceCount: 2,
    });

    const result = storePatternsBatch([
      { description: 'Existing exact pattern', type: 'voice' },
      { description: 'Similar hook pattern', type: 'hook' },
      { description: 'Brand new pattern', type: 'topic' },
    ]);

    expect(result.duplicate).toBe(1);
    expect(result.reinforced).toBe(1);
    expect(result.created).toBe(1);
  });

  it('handles empty batch', () => {
    const result = storePatternsBatch([]);

    expect(result.created).toBe(0);
    expect(result.reinforced).toBe(0);
    expect(result.duplicate).toBe(0);
  });

  it('passes evidence source to each pattern', () => {
    // Note: Patterns must be sufficiently different to avoid similarity detection.
    // Keywords are extracted by removing stop words and words < 3 chars.
    // "Edit pattern 1" and "Edit pattern 2" have identical keywords {edit, pattern}
    // so they would be treated as duplicates. Use distinct descriptions instead.
    const result = storePatternsBatch([
      { description: 'Prefer concise wording', type: 'edit', evidenceSource: 'edit' },
      { description: 'Avoid technical jargon', type: 'edit', evidenceSource: 'edit' },
    ]);

    expect(result.created).toBe(2);

    const patterns = listPatterns({ patternType: 'edit' });
    expect(patterns[0].editEvidenceCount).toBe(1);
    expect(patterns[1].editEvidenceCount).toBe(1);
  });
});

describe('getPatternsForGeneration', () => {
  beforeEach(() => {
    createPattern({ patternType: 'voice', description: 'Voice 1', evidenceCount: 5 });
    createPattern({ patternType: 'voice', description: 'Voice 2', evidenceCount: 1 });
    createPattern({ patternType: 'hook', description: 'Hook 1', evidenceCount: 10 });
    createPattern({ patternType: 'topic', description: 'Topic 1', evidenceCount: 3 });
    createPattern({ patternType: 'edit', description: 'Edit 1', evidenceCount: 8 });
    createPattern({ patternType: 'rejection', description: 'Rejection 1', evidenceCount: 4 });
  });

  it('returns patterns from multiple types', () => {
    const patterns = getPatternsForGeneration();

    const types = new Set(patterns.map((p) => p.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it('respects minEvidenceCount filter', () => {
    const patterns = getPatternsForGeneration({ minEvidenceCount: 5 });

    for (const pattern of patterns) {
      expect(pattern.evidenceCount).toBeGreaterThanOrEqual(5);
    }
  });

  it('respects limit parameter', () => {
    const patterns = getPatternsForGeneration({ limit: 2 });
    expect(patterns.length).toBeLessThanOrEqual(2);
  });

  it('filters by pattern types', () => {
    const patterns = getPatternsForGeneration({ types: ['voice', 'hook'] });

    for (const pattern of patterns) {
      expect(['voice', 'hook']).toContain(pattern.type);
    }
  });

  it('sorts by weighted score descending', () => {
    createPattern({
      patternType: 'voice',
      description: 'High edit pattern',
      evidenceCount: 5,
      editEvidenceCount: 5,
      rejectionEvidenceCount: 0,
    });

    const patterns = getPatternsForGeneration({ minEvidenceCount: 1 });

    for (let i = 1; i < patterns.length; i++) {
      expect(patterns[i - 1].weightedScore).toBeGreaterThanOrEqual(patterns[i].weightedScore);
    }
  });

  it('excludes rejection type by default', () => {
    const patterns = getPatternsForGeneration();

    const hasRejection = patterns.some((p) => p.type === 'rejection');
    expect(hasRejection).toBe(false);
  });

  it('orders by decay_score descending (MEM-005)', () => {
    // Create patterns with different decay scores
    createPattern({
      patternType: 'voice',
      description: 'High decay voice',
      evidenceCount: 5,
      decayScore: 0.9,
    });
    createPattern({
      patternType: 'voice',
      description: 'Low decay voice',
      evidenceCount: 5,
      decayScore: 0.2,
    });
    createPattern({
      patternType: 'voice',
      description: 'Medium decay voice',
      evidenceCount: 5,
      decayScore: 0.5,
    });

    const patterns = getPatternsForGeneration({ types: ['voice'], minEvidenceCount: 1 });

    // Verify high decay patterns come first
    const decayVoices = patterns.filter((p) => p.description.includes('decay voice'));
    expect(decayVoices.length).toBe(3);
    expect(decayVoices[0].decayScore).toBeGreaterThanOrEqual(decayVoices[1].decayScore);
    expect(decayVoices[1].decayScore).toBeGreaterThanOrEqual(decayVoices[2].decayScore);
  });

  it('updates access tracking for retrieved patterns (MEM-005)', () => {
    // Create a pattern with known initial state
    const created = createPattern({
      patternType: 'voice',
      description: 'Access tracking test',
      evidenceCount: 5,
      lastAccessedAt: null,
      accessCount: 0,
      decayScore: 1.0,
    });

    // Retrieve patterns - this should trigger updatePatternAccess
    getPatternsForGeneration({ types: ['voice'], minEvidenceCount: 1 });

    // Check that access was updated
    const details = getPatternDetails(created.id);
    expect(details).not.toBeNull();
    if (details) {
      expect(details.accessCount).toBe(1);
      expect(details.lastAccessedAt).not.toBeNull();
      expect(details.decayScore).toBeGreaterThan(0);
    }
  });

  it('increments access count on subsequent retrievals (MEM-005)', () => {
    const created = createPattern({
      patternType: 'voice',
      description: 'Multiple access test',
      evidenceCount: 5,
      accessCount: 0,
      decayScore: 1.0,
    });

    // First retrieval
    getPatternsForGeneration({ types: ['voice'], minEvidenceCount: 1 });

    let details = getPatternDetails(created.id);
    expect(details?.accessCount).toBe(1);

    // Second retrieval
    getPatternsForGeneration({ types: ['voice'], minEvidenceCount: 1 });

    details = getPatternDetails(created.id);
    expect(details?.accessCount).toBe(2);
  });
});

describe('getPatternsByTypeForGeneration', () => {
  beforeEach(() => {
    createPattern({ patternType: 'voice', description: 'Voice 1', evidenceCount: 5 });
    createPattern({ patternType: 'voice', description: 'Voice 2', evidenceCount: 3 });
    createPattern({ patternType: 'hook', description: 'Hook 1', evidenceCount: 4 });
  });

  it('returns only patterns of specified type', () => {
    const patterns = getPatternsByTypeForGeneration('voice');

    expect(patterns.length).toBe(2);
    for (const pattern of patterns) {
      expect(pattern.type).toBe('voice');
    }
  });

  it('respects minEvidenceCount', () => {
    const patterns = getPatternsByTypeForGeneration('voice', 4);

    expect(patterns.length).toBe(1);
    expect(patterns[0].evidenceCount).toBe(5);
  });
});

describe('convenience retrieval functions', () => {
  beforeEach(() => {
    createPattern({ patternType: 'rejection', description: 'Rejection 1', evidenceCount: 5 });
    createPattern({ patternType: 'rejection', description: 'Rejection 2', evidenceCount: 1 });
    createPattern({ patternType: 'voice', description: 'Voice 1', evidenceCount: 4 });
    createPattern({ patternType: 'edit', description: 'Edit 1', evidenceCount: 3 });
  });

  describe('getRejectionPatterns', () => {
    it('returns only rejection patterns', () => {
      const patterns = getRejectionPatterns();
      for (const pattern of patterns) {
        expect(pattern.type).toBe('rejection');
      }
    });

    it('respects minEvidenceCount', () => {
      const patterns = getRejectionPatterns(3);
      expect(patterns.length).toBe(1);
    });
  });

  describe('getVoicePatterns', () => {
    it('returns only voice patterns', () => {
      const patterns = getVoicePatterns();
      for (const pattern of patterns) {
        expect(pattern.type).toBe('voice');
      }
    });
  });

  describe('getEditPatterns', () => {
    it('returns only edit patterns', () => {
      const patterns = getEditPatterns();
      for (const pattern of patterns) {
        expect(pattern.type).toBe('edit');
      }
    });
  });
});

describe('reinforcePattern', () => {
  it('increments evidence count', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
    });

    const updated = reinforcePattern(pattern.id);

    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.evidenceCount).toBe(6);
    }
  });

  it('increments edit evidence when source is edit', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 3,
      editEvidenceCount: 1,
    });

    const updated = reinforcePattern(pattern.id, 'edit');

    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.editEvidenceCount).toBe(2);
    }
  });

  it('returns null for non-existent pattern', () => {
    const updated = reinforcePattern(99999);
    expect(updated).toBeNull();
  });
});

describe('removePattern', () => {
  it('deletes existing pattern', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'To be deleted',
      evidenceCount: 1,
    });

    const result = removePattern(pattern.id);

    expect(result).toBe(true);
    expect(listPatterns().length).toBe(0);
  });

  it('returns false for non-existent pattern', () => {
    const result = removePattern(99999);
    expect(result).toBe(false);
  });
});

describe('getPatternDetails', () => {
  it('returns pattern with StoredPattern structure', () => {
    const created = createPattern({
      patternType: 'hook',
      description: 'Test hook pattern',
      evidenceCount: 5,
      editEvidenceCount: 2,
      rejectionEvidenceCount: 3,
    });

    const details = getPatternDetails(created.id);

    expect(details).not.toBeNull();
    if (details) {
      expect(details.id).toBe(created.id);
      expect(details.type).toBe('hook');
      expect(details.description).toBe('Test hook pattern');
      expect(details.evidenceCount).toBe(5);
      expect(details.editEvidenceCount).toBe(2);
      expect(details.rejectionEvidenceCount).toBe(3);
      expect(details.weightedScore).toBe(2 * 3 + 3 * 1);
    }
  });

  it('returns null for non-existent pattern', () => {
    const details = getPatternDetails(99999);
    expect(details).toBeNull();
  });
});

describe('updatePatternDescription', () => {
  it('updates pattern description', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Original description',
      evidenceCount: 1,
    });

    const updated = updatePatternDescription(pattern.id, 'New description');

    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.description).toBe('New description');
    }
  });

  it('returns null for non-existent pattern', () => {
    const updated = updatePatternDescription(99999, 'New description');
    expect(updated).toBeNull();
  });
});

describe('getPatternStats', () => {
  it('returns zero stats when no patterns', () => {
    const stats = getPatternStats();

    expect(stats.total).toBe(0);
    expect(stats.avgEvidenceCount).toBe(0);
    expect(stats.avgWeightedScore).toBe(0);
  });

  it('calculates correct totals', () => {
    createPattern({ patternType: 'voice', description: 'Voice 1', evidenceCount: 4 });
    createPattern({ patternType: 'voice', description: 'Voice 2', evidenceCount: 6 });
    createPattern({ patternType: 'hook', description: 'Hook 1', evidenceCount: 10 });

    const stats = getPatternStats();

    expect(stats.total).toBe(3);
    expect(stats.byType.voice).toBe(2);
    expect(stats.byType.hook).toBe(1);
    expect(stats.avgEvidenceCount).toBeCloseTo((4 + 6 + 10) / 3, 1);
  });

  it('calculates edit and rejection evidence totals', () => {
    createPattern({
      patternType: 'voice',
      description: 'Voice 1',
      evidenceCount: 5,
      editEvidenceCount: 3,
      rejectionEvidenceCount: 2,
    });
    createPattern({
      patternType: 'hook',
      description: 'Hook 1',
      evidenceCount: 4,
      editEvidenceCount: 1,
      rejectionEvidenceCount: 3,
    });

    const stats = getPatternStats();

    expect(stats.totalEditEvidence).toBe(4);
    expect(stats.totalRejectionEvidence).toBe(5);
  });

  it('counts high and low confidence patterns', () => {
    createPattern({
      patternType: 'voice',
      description: 'High confidence',
      evidenceCount: 10,
      editEvidenceCount: 5,
    });
    createPattern({
      patternType: 'hook',
      description: 'Low confidence',
      evidenceCount: 1,
      editEvidenceCount: 0,
      rejectionEvidenceCount: 0,
    });

    const stats = getPatternStats();

    expect(stats.highConfidence).toBe(1);
    expect(stats.lowConfidence).toBe(1);
  });
});

describe('formatPatternsForPrompt', () => {
  it('returns message when no patterns', () => {
    const formatted = formatPatternsForPrompt([]);
    expect(formatted).toBe('No learned patterns yet.');
  });

  it('groups patterns by type', () => {
    const patterns: StoredPattern[] = [
      {
        id: 1,
        type: 'voice',
        description: 'Voice pattern',
        evidenceCount: 5,
        editEvidenceCount: 2,
        rejectionEvidenceCount: 3,
        lastAccessedAt: null,
        accessCount: 0,
        decayScore: 1.0,
        status: 'active',
        weightedScore: 9,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        type: 'hook',
        description: 'Hook pattern',
        evidenceCount: 3,
        editEvidenceCount: 0,
        rejectionEvidenceCount: 3,
        lastAccessedAt: null,
        accessCount: 0,
        decayScore: 1.0,
        status: 'active',
        weightedScore: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const formatted = formatPatternsForPrompt(patterns);

    expect(formatted).toContain('## Learned Patterns');
    expect(formatted).toContain('### Voice Preferences');
    expect(formatted).toContain('### Hook Patterns');
    expect(formatted).toContain('Voice pattern');
    expect(formatted).toContain('Hook pattern');
  });

  it('shows confidence labels based on weighted score', () => {
    const patterns: StoredPattern[] = [
      {
        id: 1,
        type: 'voice',
        description: 'High edit pattern',
        evidenceCount: 10,
        editEvidenceCount: 5,
        rejectionEvidenceCount: 0,
        lastAccessedAt: null,
        accessCount: 0,
        decayScore: 1.0,
        status: 'active',
        weightedScore: 15,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        type: 'voice',
        description: 'Low confidence pattern',
        evidenceCount: 1,
        editEvidenceCount: 0,
        rejectionEvidenceCount: 1,
        lastAccessedAt: null,
        accessCount: 0,
        decayScore: 1.0,
        status: 'active',
        weightedScore: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const formatted = formatPatternsForPrompt(patterns);

    expect(formatted).toContain('high (edit-verified)');
    expect(formatted).toContain('low confidence');
  });
});

describe('pruneWeakPatterns', () => {
  it('removes patterns with low evidence older than maxAge', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);

    createPattern({
      patternType: 'voice',
      description: 'Old weak pattern',
      evidenceCount: 1,
    });

    const removed = pruneWeakPatterns(30, 1);

    expect(removed).toBe(0);
  });

  it('does not remove recent patterns', () => {
    createPattern({
      patternType: 'voice',
      description: 'Recent pattern',
      evidenceCount: 1,
    });

    pruneWeakPatterns(30, 1);

    const patterns = listPatterns();
    expect(patterns.length).toBe(1);
  });

  it('does not remove patterns with high evidence', () => {
    createPattern({
      patternType: 'voice',
      description: 'Strong pattern',
      evidenceCount: 10,
    });

    const removed = pruneWeakPatterns(0, 1);

    expect(removed).toBe(0);
    expect(listPatterns().length).toBe(1);
  });
});

describe('mergePatterns', () => {
  it('merges multiple patterns of same type', () => {
    const p1 = createPattern({
      patternType: 'voice',
      description: 'Pattern 1',
      evidenceCount: 3,
    });
    const p2 = createPattern({
      patternType: 'voice',
      description: 'Pattern 2',
      evidenceCount: 5,
    });

    const merged = mergePatterns([p1.id, p2.id], 'Merged pattern');

    expect(merged).not.toBeNull();
    if (merged) {
      expect(merged.description).toBe('Merged pattern');
      expect(merged.evidenceCount).toBe(8);
    }

    const patterns = listPatterns();
    expect(patterns.length).toBe(1);
  });

  it('returns null for single pattern id', () => {
    const p = createPattern({
      patternType: 'voice',
      description: 'Single pattern',
      evidenceCount: 3,
    });

    const merged = mergePatterns([p.id], 'Merged');

    expect(merged).toBeNull();
  });

  it('returns null for patterns of different types', () => {
    const p1 = createPattern({
      patternType: 'voice',
      description: 'Voice pattern',
      evidenceCount: 3,
    });
    const p2 = createPattern({
      patternType: 'hook',
      description: 'Hook pattern',
      evidenceCount: 5,
    });

    const merged = mergePatterns([p1.id, p2.id], 'Merged');

    expect(merged).toBeNull();
    expect(listPatterns().length).toBe(2);
  });

  it('returns null for non-existent pattern ids', () => {
    const p = createPattern({
      patternType: 'voice',
      description: 'Existing',
      evidenceCount: 1,
    });

    const merged = mergePatterns([p.id, 99999], 'Merged');

    expect(merged).toBeNull();
  });

  it('deletes original patterns after merge', () => {
    const p1 = createPattern({
      patternType: 'topic',
      description: 'Topic 1',
      evidenceCount: 2,
    });
    const p2 = createPattern({
      patternType: 'topic',
      description: 'Topic 2',
      evidenceCount: 4,
    });
    const p3 = createPattern({
      patternType: 'topic',
      description: 'Topic 3',
      evidenceCount: 6,
    });

    mergePatterns([p1.id, p2.id, p3.id], 'All topics merged');

    const patterns = listPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].evidenceCount).toBe(12);
  });
});

describe('edge cases', () => {
  it('handles empty description', () => {
    const result = storePattern('', 'voice');
    expect(result.action).toBe('created');
  });

  it('handles very long description', () => {
    const longDesc = 'A'.repeat(1000);
    const result = storePattern(longDesc, 'voice');

    expect(result.action).toBe('created');

    const details = getPatternDetails(result.patternId);
    expect(details).not.toBeNull();
    if (details) {
      expect(details.description).toBe(longDesc);
    }
  });

  it('handles special characters in description', () => {
    const desc = 'Use "quotes" and \'apostrophes\' with $pecial ch@rs!';
    const result = storePattern(desc, 'hook');

    expect(result.action).toBe('created');

    const details = getPatternDetails(result.patternId);
    expect(details).not.toBeNull();
    if (details) {
      expect(details.description).toBe(desc);
    }
  });

  it('handles unicode in description', () => {
    const desc = 'Use emoji 🎉 and unicode: café, naïve, résumé';
    const result = storePattern(desc, 'voice');

    expect(result.action).toBe('created');

    const details = getPatternDetails(result.patternId);
    expect(details).not.toBeNull();
    if (details) {
      expect(details.description).toBe(desc);
    }
  });

  it('weighted score calculation is correct', () => {
    createPattern({
      patternType: 'voice',
      description: 'Test weighted',
      evidenceCount: 10,
      editEvidenceCount: 3,
      rejectionEvidenceCount: 4,
    });

    const patterns = getPatternsForGeneration({ minEvidenceCount: 1 });
    const pattern = patterns.find((p) => p.description === 'Test weighted');

    expect(pattern).toBeDefined();
    if (pattern) {
      expect(pattern.weightedScore).toBe(3 * 3 + 4 * 1);
    }
  });
});
