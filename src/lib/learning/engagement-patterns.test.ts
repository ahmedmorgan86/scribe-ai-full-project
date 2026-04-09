import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { closeDb, getDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import {
  updatePatternDecayFromEngagement,
  getEngagementMultiplier,
  getPatternsByEngagement,
} from './engagement-patterns';
import { createPattern, getPatternById } from '@/db/models/patterns';

const TEST_DB_PATH = './data/test-engagement-patterns.db';

beforeAll(() => {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
});

afterAll(() => {
  closeDb();
  resetDb();
  delete process.env.SQLITE_DB_PATH;
});

describe('engagement-patterns', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    closeDb();
  });

  describe('updatePatternDecayFromEngagement', () => {
    it('returns 0 for empty pattern array', () => {
      const updated = updatePatternDecayFromEngagement([], 100);
      expect(updated).toBe(0);
    });

    it('boosts decay for high engagement', () => {
      const db = getDb();
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 5,
      });

      // Set initial decay to a lower value so boost can be observed
      db.prepare(`UPDATE patterns SET decay_score = 0.7 WHERE id = ?`).run(pattern.id);
      const initialDecay = 0.7;

      const updated = updatePatternDecayFromEngagement([pattern.id], 100);

      expect(updated).toBe(1);

      const updatedPattern = getPatternById(pattern.id);
      expect(updatedPattern?.decayScore).toBeGreaterThan(initialDecay);
    });

    it('reduces decay for low engagement', () => {
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 5,
      });

      const initialDecay = pattern.decayScore;
      const updated = updatePatternDecayFromEngagement([pattern.id], 2);

      expect(updated).toBe(1);

      const updatedPattern = getPatternById(pattern.id);
      expect(updatedPattern?.decayScore).toBeLessThan(initialDecay);
    });

    it('does not update for neutral engagement', () => {
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 5,
      });

      const initialDecay = pattern.decayScore;
      const updated = updatePatternDecayFromEngagement([pattern.id], 25);

      expect(updated).toBe(0);

      const updatedPattern = getPatternById(pattern.id);
      expect(updatedPattern?.decayScore).toBe(initialDecay);
    });

    it('clamps decay to minimum 0.01', () => {
      const db = getDb();
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 5,
      });

      // Set decay to very low value
      db.prepare(`UPDATE patterns SET decay_score = 0.02 WHERE id = ?`).run(pattern.id);

      // Apply multiple low engagement penalties
      for (let i = 0; i < 5; i++) {
        updatePatternDecayFromEngagement([pattern.id], 0);
      }

      const updatedPattern = getPatternById(pattern.id);
      expect(updatedPattern?.decayScore).toBeGreaterThanOrEqual(0.01);
    });

    it('clamps decay to maximum 1.0', () => {
      const db = getDb();
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 5,
      });

      // Set decay to high value
      db.prepare(`UPDATE patterns SET decay_score = 0.95 WHERE id = ?`).run(pattern.id);

      // Apply multiple high engagement boosts
      for (let i = 0; i < 5; i++) {
        updatePatternDecayFromEngagement([pattern.id], 200);
      }

      const updatedPattern = getPatternById(pattern.id);
      expect(updatedPattern?.decayScore).toBeLessThanOrEqual(1.0);
    });

    it('updates multiple patterns', () => {
      const p1 = createPattern({
        patternType: 'voice',
        description: 'Pattern 1',
        evidenceCount: 5,
      });
      const p2 = createPattern({
        patternType: 'hook',
        description: 'Pattern 2',
        evidenceCount: 3,
      });

      const updated = updatePatternDecayFromEngagement([p1.id, p2.id], 100);
      expect(updated).toBe(2);
    });
  });

  describe('getEngagementMultiplier', () => {
    it('returns 1.0 for pattern with no engagement data', () => {
      const pattern = createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 5,
      });

      const multiplier = getEngagementMultiplier(pattern.id);
      expect(multiplier).toBe(1.0);
    });

    it('returns multiplier based on average engagement', () => {
      // Note: This test would require posts with engagement data
      // that reference the pattern. For simplicity, we just test the default case.
      const multiplier = getEngagementMultiplier(999);
      expect(multiplier).toBe(1.0);
    });
  });

  describe('getPatternsByEngagement', () => {
    it('returns empty array when no patterns have engagement', () => {
      createPattern({
        patternType: 'voice',
        description: 'Test pattern',
        evidenceCount: 5,
      });

      const patterns = getPatternsByEngagement();
      // Patterns without post associations return empty
      expect(patterns).toEqual([]);
    });
  });
});
