import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { closeDb, getDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import {
  logGenerationError,
  getPatternErrorRate,
  getRecentErrors,
  getErrorStats,
  getTotalErrorCount,
  cleanupOldErrors,
} from './error-logger';

const TEST_DB_PATH = './data/test-error-logger.db';

beforeAll(() => {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
});

afterAll(() => {
  closeDb();
  resetDb();
  delete process.env.SQLITE_DB_PATH;
});

describe('error-logger', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    closeDb();
  });

  describe('logGenerationError', () => {
    it('logs a basic error without context', () => {
      const errorId = logGenerationError('api_error', 'OpenAI API timeout');

      expect(errorId).toBeDefined();
      expect(typeof errorId).toBe('string');
      expect(errorId.length).toBeGreaterThan(0);
    });

    it('logs an error with full context', () => {
      const errorId = logGenerationError('voice_mismatch', 'Voice score below threshold', {
        sourceId: 123,
        postId: 456,
        patternsUsed: [1, 2, 3],
        additionalInfo: { voiceScore: 0.45 },
      });

      expect(errorId).toBeDefined();

      const errors = getRecentErrors('voice_mismatch');
      expect(errors.length).toBe(1);
      expect(errors[0].patternsUsed).toEqual([1, 2, 3]);

      const details = JSON.parse(errors[0].errorDetails ?? '{}') as {
        sourceId: number;
        postId: number;
        voiceScore: number;
      };
      expect(details.sourceId).toBe(123);
      expect(details.postId).toBe(456);
      expect(details.voiceScore).toBe(0.45);
    });

    it('logs errors with different types', () => {
      logGenerationError('slop_detected', 'Slop score too high');
      logGenerationError('pattern_conflict', 'Conflicting patterns detected');
      logGenerationError('generation_failed', 'Generation failed after retries');

      const stats = getErrorStats();
      expect(stats['slop_detected']).toBe(1);
      expect(stats['pattern_conflict']).toBe(1);
      expect(stats['generation_failed']).toBe(1);
    });
  });

  describe('getPatternErrorRate', () => {
    it('returns 0 for pattern with no errors', () => {
      const rate = getPatternErrorRate(999);
      expect(rate).toBe(0);
    });

    it('counts errors where pattern was used', () => {
      logGenerationError('voice_mismatch', 'Error 1', { patternsUsed: [1, 2] });
      logGenerationError('slop_detected', 'Error 2', { patternsUsed: [1, 3] });
      logGenerationError('api_error', 'Error 3', { patternsUsed: [4, 5] });

      expect(getPatternErrorRate(1)).toBe(2);
      expect(getPatternErrorRate(2)).toBe(1);
      expect(getPatternErrorRate(3)).toBe(1);
      expect(getPatternErrorRate(4)).toBe(1);
      expect(getPatternErrorRate(6)).toBe(0);
    });
  });

  describe('getRecentErrors', () => {
    it('returns empty array when no errors', () => {
      const errors = getRecentErrors();
      expect(errors).toEqual([]);
    });

    it('returns errors in descending order by creation time', () => {
      // Insert with different timestamps to ensure ordering
      const db = getDb();
      const now = new Date();
      const older = new Date(now.getTime() - 60000);
      const oldest = new Date(now.getTime() - 120000);

      db.prepare(
        `
        INSERT INTO generation_errors (id, error_type, error_details, created_at)
        VALUES (?, ?, ?, ?)
      `
      ).run('err-1', 'api_error', JSON.stringify({ message: 'First error' }), oldest.toISOString());
      db.prepare(
        `
        INSERT INTO generation_errors (id, error_type, error_details, created_at)
        VALUES (?, ?, ?, ?)
      `
      ).run('err-2', 'api_error', JSON.stringify({ message: 'Second error' }), older.toISOString());
      db.prepare(
        `
        INSERT INTO generation_errors (id, error_type, error_details, created_at)
        VALUES (?, ?, ?, ?)
      `
      ).run('err-3', 'api_error', JSON.stringify({ message: 'Third error' }), now.toISOString());

      const errors = getRecentErrors('api_error');
      expect(errors.length).toBe(3);

      const details = errors.map(
        (e) => (JSON.parse(e.errorDetails ?? '{}') as { message: string }).message
      );
      expect(details[0]).toBe('Third error');
      expect(details[1]).toBe('Second error');
      expect(details[2]).toBe('First error');
    });

    it('filters by error type', () => {
      logGenerationError('api_error', 'API error');
      logGenerationError('voice_mismatch', 'Voice error');
      logGenerationError('api_error', 'Another API error');

      const apiErrors = getRecentErrors('api_error');
      expect(apiErrors.length).toBe(2);

      const voiceErrors = getRecentErrors('voice_mismatch');
      expect(voiceErrors.length).toBe(1);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        logGenerationError('api_error', `Error ${i}`);
      }

      const errors = getRecentErrors('api_error', 5);
      expect(errors.length).toBe(5);
    });
  });

  describe('getErrorStats', () => {
    it('returns empty object when no errors', () => {
      const stats = getErrorStats();
      expect(stats).toEqual({});
    });

    it('aggregates counts by error type', () => {
      logGenerationError('api_error', 'Error 1');
      logGenerationError('api_error', 'Error 2');
      logGenerationError('voice_mismatch', 'Error 3');
      logGenerationError('slop_detected', 'Error 4');
      logGenerationError('slop_detected', 'Error 5');
      logGenerationError('slop_detected', 'Error 6');

      const stats = getErrorStats();
      expect(stats['api_error']).toBe(2);
      expect(stats['voice_mismatch']).toBe(1);
      expect(stats['slop_detected']).toBe(3);
    });
  });

  describe('getTotalErrorCount', () => {
    it('returns 0 when no errors', () => {
      expect(getTotalErrorCount()).toBe(0);
    });

    it('counts all errors', () => {
      logGenerationError('api_error', 'Error 1');
      logGenerationError('voice_mismatch', 'Error 2');
      logGenerationError('slop_detected', 'Error 3');

      expect(getTotalErrorCount()).toBe(3);
    });

    it('counts errors by type', () => {
      logGenerationError('api_error', 'Error 1');
      logGenerationError('api_error', 'Error 2');
      logGenerationError('voice_mismatch', 'Error 3');

      expect(getTotalErrorCount('api_error')).toBe(2);
      expect(getTotalErrorCount('voice_mismatch')).toBe(1);
      expect(getTotalErrorCount('slop_detected')).toBe(0);
    });
  });

  describe('cleanupOldErrors', () => {
    it('returns 0 when no old errors', () => {
      logGenerationError('api_error', 'Recent error');

      const deleted = cleanupOldErrors(30);
      expect(deleted).toBe(0);
    });

    it('deletes old errors based on age', () => {
      // Create an old error by directly inserting
      const db = getDb();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      db.prepare(
        `
        INSERT INTO generation_errors (id, error_type, error_details, created_at)
        VALUES (?, ?, ?, ?)
      `
      ).run('old-error-1', 'api_error', 'Old error', oldDate.toISOString());

      // Create a recent error
      logGenerationError('api_error', 'Recent error');

      expect(getTotalErrorCount()).toBe(2);

      const deleted = cleanupOldErrors(30);
      expect(deleted).toBe(1);
      expect(getTotalErrorCount()).toBe(1);
    });
  });
});
