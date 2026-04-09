import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { closeDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createPattern, getPatternById } from '@/db/models/patterns';

import {
  calculateDecayScore,
  updatePatternAccess,
  calculateEffectiveDecay,
  calculateTimeDecay,
} from './decay';

const TEST_DB_PATH = './data/test-decay.db';

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

describe('calculateDecayScore', () => {
  describe('edge cases', () => {
    it('returns 0 when accessCount is 0', () => {
      const result = calculateDecayScore('2025-01-01 12:00:00', 0);
      expect(result).toBe(0);
    });

    it('returns 0 when accessCount is negative', () => {
      const result = calculateDecayScore('2025-01-01 12:00:00', -5);
      expect(result).toBe(0);
    });

    it('returns accessCount when lastAccessed is null', () => {
      const result = calculateDecayScore(null, 10);
      expect(result).toBe(10);
    });

    it('returns accessCount when lastAccessed is invalid date string', () => {
      const result = calculateDecayScore('not-a-date', 10);
      expect(result).toBe(10);
    });

    it('returns accessCount when lastAccessed is empty string', () => {
      const result = calculateDecayScore('', 10);
      expect(result).toBe(10);
    });
  });

  describe('decay formula', () => {
    it('returns full accessCount for just-accessed pattern', () => {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const result = calculateDecayScore(now, 10);
      // Should be very close to 10 (within milliseconds)
      expect(result).toBeCloseTo(10, 1);
    });

    it('decays by ~50% after 30 days', () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateStr = thirtyDaysAgo.toISOString().slice(0, 19).replace('T', ' ');

      const result = calculateDecayScore(dateStr, 10);
      // Formula: 10 / (1 + 30/30) = 10 / 2 = 5
      expect(result).toBeCloseTo(5, 1);
    });

    it('decays by ~67% after 60 days', () => {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      const dateStr = sixtyDaysAgo.toISOString().slice(0, 19).replace('T', ' ');

      const result = calculateDecayScore(dateStr, 10);
      // Formula: 10 / (1 + 60/30) = 10 / 3 ≈ 3.33
      expect(result).toBeCloseTo(3.33, 1);
    });

    it('handles very old dates gracefully', () => {
      const yearAgo = new Date();
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      const dateStr = yearAgo.toISOString().slice(0, 19).replace('T', ' ');

      const result = calculateDecayScore(dateStr, 100);
      // Formula: 100 / (1 + 365/30) ≈ 100 / 13.17 ≈ 7.6
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(10);
    });

    it('handles future dates by treating as just accessed', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const dateStr = futureDate.toISOString().slice(0, 19).replace('T', ' ');

      const result = calculateDecayScore(dateStr, 10);
      // daysSince is clamped to 0 by Math.max, so returns full accessCount
      expect(result).toBeCloseTo(10, 1);
    });
  });

  describe('formula correctness', () => {
    it('higher access count = higher score', () => {
      const dateStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const low = calculateDecayScore(dateStr, 5);
      const high = calculateDecayScore(dateStr, 10);
      expect(high).toBeGreaterThan(low);
    });

    it('more recent access = higher score', () => {
      const recent = new Date();
      const old = new Date();
      old.setDate(old.getDate() - 30);

      const recentStr = recent.toISOString().slice(0, 19).replace('T', ' ');
      const oldStr = old.toISOString().slice(0, 19).replace('T', ' ');

      const recentScore = calculateDecayScore(recentStr, 10);
      const oldScore = calculateDecayScore(oldStr, 10);

      expect(recentScore).toBeGreaterThan(oldScore);
    });
  });
});

describe('updatePatternAccess', () => {
  it('returns null for non-existent pattern', () => {
    const result = updatePatternAccess(999);
    expect(result).toBeNull();
  });

  it('increments access count', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
      accessCount: 3,
    });

    const updated = updatePatternAccess(pattern.id);

    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.accessCount).toBe(4);
    }
  });

  it('updates lastAccessedAt to current time', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
      lastAccessedAt: null,
    });

    const updated = updatePatternAccess(pattern.id);

    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.lastAccessedAt).not.toBeNull();
      // Verify it's a valid date string in YYYY-MM-DD HH:MM:SS format
      expect(updated.lastAccessedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });

  it('recalculates decay score', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
      accessCount: 0,
      decayScore: 0,
    });

    const updated = updatePatternAccess(pattern.id);

    expect(updated).not.toBeNull();
    if (updated) {
      // With accessCount = 1 and just accessed, score should be ~1
      expect(updated.decayScore).toBeCloseTo(1, 1);
    }
  });

  it('persists changes to database', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
      accessCount: 2,
    });

    updatePatternAccess(pattern.id);

    const fromDb = getPatternById(pattern.id);
    expect(fromDb).not.toBeNull();
    if (fromDb) {
      expect(fromDb.accessCount).toBe(3);
    }
  });

  it('updates pattern with existing lastAccessedAt', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    const oldDateStr = oldDate.toISOString().slice(0, 19).replace('T', ' ');

    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
      accessCount: 5,
      lastAccessedAt: oldDateStr,
    });

    const updated = updatePatternAccess(pattern.id);

    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.accessCount).toBe(6);
      expect(updated.lastAccessedAt).not.toBe(oldDateStr);
    }
  });
});

describe('calculateTimeDecay', () => {
  it('normalizes stored decay score', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
      decayScore: 5,
    });

    const timeDecay = calculateTimeDecay(pattern);
    expect(timeDecay).toBe(0.5); // 5/10 = 0.5
  });

  it('caps at 1.0 for high decay scores', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
      decayScore: 20,
    });

    const timeDecay = calculateTimeDecay(pattern);
    expect(timeDecay).toBe(1.0);
  });

  it('calculates from access data when decay score is 0', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern',
      evidenceCount: 5,
      accessCount: 5,
      decayScore: 0,
      lastAccessedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    const timeDecay = calculateTimeDecay(pattern);
    expect(timeDecay).toBeCloseTo(0.5, 1); // 5/10 ≈ 0.5
  });
});

describe('calculateEffectiveDecay', () => {
  it('returns base decay when no engagement data', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Test pattern with no engagement',
      evidenceCount: 5,
      decayScore: 5,
    });

    const effectiveDecay = calculateEffectiveDecay(pattern);
    // Base decay is 5/10 = 0.5, multiplier is 1.0 (no data)
    expect(effectiveDecay).toBe(0.5);
  });

  it('clamps result to minimum 0.01', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'Very low decay pattern',
      evidenceCount: 1,
      decayScore: 0.05,
    });

    const effectiveDecay = calculateEffectiveDecay(pattern);
    expect(effectiveDecay).toBeGreaterThanOrEqual(0.01);
  });

  it('clamps result to maximum 1.0', () => {
    const pattern = createPattern({
      patternType: 'voice',
      description: 'High decay pattern',
      evidenceCount: 50,
      decayScore: 20,
    });

    const effectiveDecay = calculateEffectiveDecay(pattern);
    expect(effectiveDecay).toBeLessThanOrEqual(1.0);
  });
});
