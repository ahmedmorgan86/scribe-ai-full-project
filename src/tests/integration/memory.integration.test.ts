/**
 * Memory System Integration Test Suite
 *
 * Tests the pattern memory system:
 * - Pattern creation and storage
 * - Pattern access and decay updates
 * - Conflict detection between patterns
 * - Conflict resolution (recent pattern wins)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createPattern, getPatternById, listPatterns } from '@/db/models/patterns';
import { calculateDecayScore, updatePatternAccess } from '@/lib/learning/decay';
import {
  detectConflictsSync,
  resolveConflict,
  resolveConflictAndPersist,
  clearResolutionLog,
  getResolutionLog,
} from '@/lib/learning/conflict';
import {
  storePattern,
  getPatternsForGeneration,
  findSimilarPatterns,
} from '@/lib/learning/patterns';
// Pattern type imported for type safety in return values

// Mock external dependencies
vi.mock('@/lib/embeddings/service', () => ({
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: new Array(1536).fill(0) }),
  generateEmbeddingsBatch: vi
    .fn()
    .mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => ({ embedding: new Array(1536).fill(0) })))
    ),
}));

// ============================================================================
// Test Setup
// ============================================================================

describe('Memory System Integration Tests', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
    clearResolutionLog();
  });

  // ==========================================================================
  // Pattern Creation Tests
  // ==========================================================================

  describe('Pattern Creation', () => {
    it('creates pattern with default decay fields', () => {
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Use direct language',
        evidenceCount: 1,
      });

      expect(pattern).toBeDefined();
      expect(pattern.id).toBeGreaterThan(0);
      expect(pattern.patternType).toBe('voice');
      expect(pattern.description).toBe('Use direct language');
      expect(pattern.accessCount).toBe(0);
      expect(pattern.decayScore).toBe(1.0);
      expect(pattern.status).toBe('active');
      expect(pattern.lastAccessedAt).toBeNull();
    });

    it('creates pattern with custom decay fields', () => {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const pattern = createPattern({
        patternType: 'edit',
        description: 'Prefer shorter sentences',
        evidenceCount: 3,
        accessCount: 5,
        decayScore: 2.5,
        lastAccessedAt: now,
      });

      expect(pattern.accessCount).toBe(5);
      expect(pattern.decayScore).toBe(2.5);
      expect(pattern.lastAccessedAt).toBe(now);
    });

    it('stores patterns via storePattern() with similarity check', () => {
      const result1 = storePattern('Avoid technical jargon', 'voice');
      expect(result1.action).toBe('created');

      // Exact duplicate returns duplicate action
      const result2 = storePattern('Avoid technical jargon', 'voice');
      expect(result2.action).toBe('duplicate');
      expect(result2.existingPatternId).toBe(result1.patternId);

      // Similar pattern is reinforced
      const result3 = storePattern('Avoid using technical jargon terms', 'voice');
      expect(result3.action).toBe('reinforced');
    });

    it('creates patterns with different types independently', () => {
      const voice = storePattern('Use active voice', 'voice');
      const edit = storePattern('Use active voice', 'edit');

      expect(voice.patternId).not.toBe(edit.patternId);
      expect(voice.action).toBe('created');
      expect(edit.action).toBe('created');
    });
  });

  // ==========================================================================
  // Pattern Access and Decay Tests
  // ==========================================================================

  describe('Pattern Access and Decay', () => {
    it('updates access count when pattern is accessed', () => {
      const pattern = createPattern({
        patternType: 'hook',
        description: 'Start with a question',
        evidenceCount: 2,
      });

      const updated = updatePatternAccess(pattern.id);

      expect(updated).not.toBeNull();
      expect(updated?.accessCount).toBe(1);
      expect(updated?.lastAccessedAt).not.toBeNull();
      expect(updated?.decayScore).toBeGreaterThan(0);
    });

    it('increments access count on multiple accesses', () => {
      const pattern = createPattern({
        patternType: 'topic',
        description: 'Focus on actionable advice',
        evidenceCount: 1,
      });

      updatePatternAccess(pattern.id);
      updatePatternAccess(pattern.id);
      const updated = updatePatternAccess(pattern.id);

      expect(updated).not.toBeNull();
      expect(updated?.accessCount).toBe(3);
    });

    it('calculates decay score based on recency and frequency', () => {
      const now = new Date().toISOString();

      // Recent + high access = high score
      const score1 = calculateDecayScore(now, 10);
      expect(score1).toBeCloseTo(10, 0);

      // Zero access = zero score
      const score2 = calculateDecayScore(now, 0);
      expect(score2).toBe(0);

      // Old access decays score
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const score3 = calculateDecayScore(thirtyDaysAgo.toISOString(), 10);
      expect(score3).toBeCloseTo(5, 0); // ~50% decay after 30 days
    });

    it('returns patterns ordered by decay score for generation', () => {
      // Create patterns with different decay scores
      const p1 = createPattern({
        patternType: 'voice',
        description: 'High decay pattern',
        evidenceCount: 5,
        accessCount: 10,
        decayScore: 10.0,
      });
      const p2 = createPattern({
        patternType: 'voice',
        description: 'Low decay pattern',
        evidenceCount: 5,
        accessCount: 1,
        decayScore: 0.5,
      });
      const p3 = createPattern({
        patternType: 'voice',
        description: 'Medium decay pattern',
        evidenceCount: 5,
        accessCount: 5,
        decayScore: 5.0,
      });

      const patterns = getPatternsForGeneration({
        types: ['voice'],
        minEvidenceCount: 1,
        limit: 10,
      });

      expect(patterns.length).toBe(3);
      expect(patterns[0].id).toBe(p1.id);
      expect(patterns[1].id).toBe(p3.id);
      expect(patterns[2].id).toBe(p2.id);
    });

    it('updates access tracking when retrieving patterns for generation', () => {
      const pattern = createPattern({
        patternType: 'edit',
        description: 'Keep paragraphs short',
        evidenceCount: 3,
        accessCount: 0,
      });

      getPatternsForGeneration({ types: ['edit'], minEvidenceCount: 1 });

      const updated = getPatternById(pattern.id);
      expect(updated).not.toBeNull();
      expect(updated?.accessCount).toBe(1);
      expect(updated?.lastAccessedAt).not.toBeNull();
    });

    it('returns null when updating non-existent pattern', () => {
      const result = updatePatternAccess(99999);
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Conflict Detection Tests
  // ==========================================================================

  describe('Conflict Detection', () => {
    it('detects conflict between opposite sentiment patterns with high keyword overlap', () => {
      // Must have: opposite sentiment AND sufficient keyword overlap (default threshold 0.3)
      // Sentiment: "prefer" (positive) only
      createPattern({
        patternType: 'voice',
        description: 'prefer formal language tone writing style',
        evidenceCount: 1,
      });

      // Sentiment: "avoid" (negative) only -> clear opposite
      // Keywords shared: formal, language, tone, writing, style
      const result = detectConflictsSync('avoid formal language tone writing style', 'voice', {
        keywordThreshold: 0.3,
      });

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].conflictType).toBe('keyword');
    });

    it('does not flag similar patterns without opposite sentiment', () => {
      createPattern({
        patternType: 'voice',
        description: 'prefer short sentences',
        evidenceCount: 1,
      });

      // "recommend" is also positive - same sentiment
      const result = detectConflictsSync('recommend short sentences', 'voice');

      expect(result.hasConflicts).toBe(false);
    });

    it('returns empty result when no existing patterns', () => {
      const result = detectConflictsSync('Use active voice', 'voice');

      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toEqual([]);
      expect(result.checkedCount).toBe(0);
    });

    it('only checks patterns of same type', () => {
      createPattern({
        patternType: 'edit',
        description: 'always include detailed examples content',
        evidenceCount: 1,
      });

      // Different type (voice vs edit) so no conflict checked
      const result = detectConflictsSync('avoid detailed examples content', 'voice');

      expect(result.hasConflicts).toBe(false);
      expect(result.checkedCount).toBe(0);
    });

    it('detects conflict when keyword overlap meets threshold', () => {
      // Sentiment: "recommend" (positive)
      createPattern({
        patternType: 'hook',
        description: 'recommend questions hooks opening grabber',
        evidenceCount: 1,
      });

      // Sentiment: "avoid" (negative) - opposite
      const result = detectConflictsSync('avoid questions hooks opening grabber', 'hook', {
        keywordThreshold: 0.3,
      });

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBe(1);
    });
  });

  // ==========================================================================
  // Conflict Resolution Tests
  // ==========================================================================

  describe('Conflict Resolution', () => {
    it('resolves conflict using timestamp comparison (first pattern wins on tie)', () => {
      // When timestamps are same (created in same second), date1 >= date2 is true
      // so pattern1 (first argument) wins
      const pattern1 = createPattern({
        patternType: 'voice',
        description: 'Use formal tone',
        evidenceCount: 5,
      });

      const pattern2 = createPattern({
        patternType: 'voice',
        description: 'Avoid formal tone',
        evidenceCount: 1,
      });

      const resolution = resolveConflict(pattern1, pattern2);

      // pattern1 wins because date1 >= date2 (same second, so equal)
      expect(resolution.winner.id).toBe(pattern1.id);
      expect(resolution.loser.id).toBe(pattern2.id);
      expect(resolution.reason).toContain('Recent pattern wins');
    });

    it('logs resolution for debugging', () => {
      const p1 = createPattern({
        patternType: 'edit',
        description: 'Use bullet points',
        evidenceCount: 1,
      });
      const p2 = createPattern({
        patternType: 'edit',
        description: 'Avoid bullet points',
        evidenceCount: 1,
      });

      resolveConflict(p1, p2);

      const log = getResolutionLog();
      expect(log.length).toBe(1);
      expect(log[0].winnerId).toBeDefined();
      expect(log[0].loserId).toBeDefined();
      expect(log[0].resolvedAt).toBeDefined();
    });

    it('persists resolution by updating loser status to superseded', () => {
      const pattern1 = createPattern({
        patternType: 'voice',
        description: 'Include hashtags always',
        evidenceCount: 3,
      });
      const pattern2 = createPattern({
        patternType: 'voice',
        description: 'Never include hashtags',
        evidenceCount: 1,
      });

      // pattern1 wins (first arg when timestamps equal)
      const resolution = resolveConflictAndPersist(pattern1, pattern2);

      expect(resolution).not.toBeNull();
      // pattern2 is the loser
      expect(resolution?.loser.id).toBe(pattern2.id);
      expect(resolution?.loser.status).toBe('superseded');

      // Verify in database - loser (pattern2) should be superseded
      const loserInDb = getPatternById(pattern2.id);
      expect(loserInDb).not.toBeNull();
      expect(loserInDb?.status).toBe('superseded');

      const winnerInDb = getPatternById(pattern1.id);
      expect(winnerInDb).not.toBeNull();
      expect(winnerInDb?.status).toBe('active');
    });

    it('superseded patterns are excluded from generation retrieval', () => {
      const activePattern = createPattern({
        patternType: 'topic',
        description: 'Focus on technology trends',
        evidenceCount: 3,
        status: 'active',
      });
      createPattern({
        patternType: 'topic',
        description: 'Avoid technology trends',
        evidenceCount: 5,
        status: 'superseded',
      });

      const patterns = listPatterns({
        patternType: 'topic',
        status: 'active',
      });

      expect(patterns.length).toBe(1);
      expect(patterns[0].id).toBe(activePattern.id);
    });
  });

  // ==========================================================================
  // Full Workflow Tests
  // ==========================================================================

  describe('Full Memory System Workflow', () => {
    it('complete workflow: create -> access -> decay update', () => {
      // Step 1: Create initial pattern
      // Sentiment: "prefer" (positive)
      const result1 = storePattern('prefer informal conversational tone writing', 'voice');
      expect(result1.action).toBe('created');
      const pattern1 = getPatternById(result1.patternId);
      expect(pattern1).not.toBeNull();
      if (!pattern1) return;

      // Step 2: Access pattern multiple times
      updatePatternAccess(pattern1.id);
      updatePatternAccess(pattern1.id);
      const afterAccess = getPatternById(pattern1.id);
      expect(afterAccess).not.toBeNull();
      if (!afterAccess) return;
      expect(afterAccess.accessCount).toBe(2);
      expect(afterAccess.decayScore).toBeGreaterThan(pattern1.decayScore);

      // Step 3: Check for conflicts with opposite pattern
      // Sentiment: "avoid" (negative) - clear opposite
      const conflicts = detectConflictsSync('avoid informal conversational tone writing', 'voice', {
        keywordThreshold: 0.3,
      });
      expect(conflicts.hasConflicts).toBe(true);

      // Step 4: Create a different pattern and resolve
      const result2 = storePattern('encourage formal academic style', 'voice');
      const pattern2 = getPatternById(result2.patternId);
      expect(pattern2).not.toBeNull();
      if (!pattern2) return;

      // pattern1 wins when timestamps are equal (first arg)
      const resolution = resolveConflictAndPersist(pattern1, pattern2);
      expect(resolution).not.toBeNull();
      expect(resolution?.winner.id).toBe(pattern1.id);
      expect(resolution?.loser.status).toBe('superseded');
    });

    it('pattern similarity reinforces existing patterns', () => {
      // First pattern is created
      const r1 = storePattern('Keep responses brief concise point', 'edit');
      expect(r1.action).toBe('created');

      // Similar pattern is reinforced (Jaccard similarity >= 0.5)
      const r2 = storePattern('Keep responses brief concise', 'edit');
      expect(r2.action).toBe('reinforced');

      // Very different pattern creates new entry
      const r3 = storePattern('Use detailed explanations examples', 'edit');
      expect(r3.action).toBe('created');

      const allPatterns = listPatterns({ patternType: 'edit' });
      expect(allPatterns.length).toBe(2);
    });

    it('handles high volume of patterns efficiently', () => {
      // Create 50 patterns
      for (let i = 0; i < 50; i++) {
        createPattern({
          patternType: 'voice',
          description: `Unique pattern description number ${i} with distinct keywords`,
          evidenceCount: Math.floor(Math.random() * 10) + 1,
          accessCount: Math.floor(Math.random() * 20),
          decayScore: Math.random() * 10,
        });
      }

      const patterns = listPatterns({ patternType: 'voice', limit: 100 });
      expect(patterns.length).toBe(50);

      // Retrieval for generation should limit and sort properly
      const forGeneration = getPatternsForGeneration({
        types: ['voice'],
        minEvidenceCount: 1,
        limit: 10,
      });
      expect(forGeneration.length).toBeLessThanOrEqual(10);

      // Should be sorted by decay score descending
      for (let i = 1; i < forGeneration.length; i++) {
        expect(forGeneration[i - 1].decayScore).toBeGreaterThanOrEqual(forGeneration[i].decayScore);
      }
    });

    it('similar pattern finder respects type boundaries', () => {
      storePattern('Use emojis sparingly', 'voice');
      storePattern('Use emojis sparingly', 'edit');

      const voiceMatches = findSimilarPatterns('Use emojis sparingly', 'voice');
      const editMatches = findSimilarPatterns('Use emojis sparingly', 'edit');

      expect(voiceMatches.length).toBe(1);
      expect(editMatches.length).toBe(1);
      expect(voiceMatches[0].pattern.id).not.toBe(editMatches[0].pattern.id);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles pattern with null lastAccessedAt', () => {
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 1,
        lastAccessedAt: null,
      });

      expect(pattern.lastAccessedAt).toBeNull();

      // First access should set the timestamp
      const updated = updatePatternAccess(pattern.id);
      expect(updated).not.toBeNull();
      expect(updated?.lastAccessedAt).not.toBeNull();
    });

    it('handles very old pattern with high decay', () => {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      const timestamp = sixtyDaysAgo.toISOString().slice(0, 19).replace('T', ' ');

      const pattern = createPattern({
        patternType: 'hook',
        description: 'Old pattern',
        evidenceCount: 3,
        accessCount: 5,
        lastAccessedAt: timestamp,
      });

      const score = calculateDecayScore(pattern.lastAccessedAt ?? '', pattern.accessCount);
      expect(score).toBeLessThan(2); // Heavily decayed
    });

    it('conflict detection handles empty description gracefully', () => {
      createPattern({
        patternType: 'voice',
        description: 'Use simple words',
        evidenceCount: 1,
      });

      const result = detectConflictsSync('', 'voice');
      expect(result.hasConflicts).toBe(false);
    });

    it('resolves conflict when patterns have same timestamp', () => {
      // Create patterns with same-ish timestamp by doing it quickly
      const p1 = createPattern({
        patternType: 'edit',
        description: 'Pattern A',
        evidenceCount: 1,
      });
      const p2 = createPattern({
        patternType: 'edit',
        description: 'Pattern B',
        evidenceCount: 1,
      });

      // Should still resolve without error
      const resolution = resolveConflict(p1, p2);
      expect(resolution.winner).toBeDefined();
      expect(resolution.loser).toBeDefined();
    });
  });
});
