import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  logGenerationSession,
  createSessionTracker,
  readRecentSessions,
  getSessionStats,
  clearSessionLogs,
} from './session-logger';

const LOG_FILE = path.resolve(process.cwd(), 'logs', 'generation-sessions.jsonl');

describe('session-logger', () => {
  beforeEach(() => {
    clearSessionLogs();
  });

  afterEach(() => {
    clearSessionLogs();
  });

  describe('logGenerationSession', () => {
    it('creates log file if it does not exist', () => {
      logGenerationSession({
        sourceId: 1,
        patternsUsed: [1, 2, 3],
        attempts: 2,
        finalStatus: 'success',
        durationMs: 1500,
      });

      expect(fs.existsSync(LOG_FILE)).toBe(true);
    });

    it('appends session to log file in JSONL format', () => {
      logGenerationSession({
        sourceId: 1,
        patternsUsed: [1, 2],
        attempts: 1,
        finalStatus: 'success',
        durationMs: 1000,
      });

      logGenerationSession({
        sourceId: 2,
        patternsUsed: [3, 4],
        attempts: 3,
        finalStatus: 'failed',
        durationMs: 5000,
        errorType: 'api_error',
      });

      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);

      const first = JSON.parse(lines[0]) as { sourceId: number; finalStatus: string };
      expect(first.sourceId).toBe(1);
      expect(first.finalStatus).toBe('success');

      const second = JSON.parse(lines[1]) as { sourceId: number; finalStatus: string };
      expect(second.sourceId).toBe(2);
      expect(second.finalStatus).toBe('failed');
    });

    it('includes timestamp in log entry', () => {
      const before = new Date().toISOString();

      logGenerationSession({
        sourceId: 1,
        patternsUsed: [],
        attempts: 1,
        finalStatus: 'success',
        durationMs: 100,
      });

      const after = new Date().toISOString();
      const sessions = readRecentSessions(1);
      expect(sessions.length).toBe(1);
      expect(sessions[0].timestamp >= before).toBe(true);
      expect(sessions[0].timestamp <= after).toBe(true);
    });
  });

  describe('SessionTracker', () => {
    it('tracks attempts and patterns used', () => {
      const tracker = createSessionTracker(123);

      tracker.recordAttempt([1, 2]);
      tracker.recordAttempt([2, 3]);
      tracker.complete('success', { postId: 456 });

      const sessions = readRecentSessions(1);
      expect(sessions.length).toBe(1);
      expect(sessions[0].sourceId).toBe(123);
      expect(sessions[0].attempts).toBe(2);
      expect(sessions[0].patternsUsed.sort()).toEqual([1, 2, 3]);
      expect(sessions[0].postId).toBe(456);
    });

    it('calculates duration correctly', async () => {
      const tracker = createSessionTracker(1);

      await new Promise((r) => setTimeout(r, 50));
      tracker.recordAttempt();
      tracker.complete('success');

      const sessions = readRecentSessions(1);
      expect(sessions[0].durationMs).toBeGreaterThanOrEqual(50);
    });

    it('handles null sourceId', () => {
      const tracker = createSessionTracker(null);
      tracker.recordAttempt();
      tracker.complete('success');

      const sessions = readRecentSessions(1);
      expect(sessions[0].sourceId).toBeNull();
    });

    it('records error type on failure', () => {
      const tracker = createSessionTracker(1);
      tracker.recordAttempt();
      tracker.complete('failed', { errorType: 'voice_mismatch' });

      const sessions = readRecentSessions(1);
      expect(sessions[0].finalStatus).toBe('failed');
      expect(sessions[0].errorType).toBe('voice_mismatch');
    });
  });

  describe('readRecentSessions', () => {
    it('returns empty array when no log file exists', () => {
      const sessions = readRecentSessions();
      expect(sessions).toEqual([]);
    });

    it('returns sessions in reverse chronological order', () => {
      logGenerationSession({
        sourceId: 1,
        patternsUsed: [],
        attempts: 1,
        finalStatus: 'success',
        durationMs: 100,
      });
      logGenerationSession({
        sourceId: 2,
        patternsUsed: [],
        attempts: 1,
        finalStatus: 'success',
        durationMs: 100,
      });
      logGenerationSession({
        sourceId: 3,
        patternsUsed: [],
        attempts: 1,
        finalStatus: 'success',
        durationMs: 100,
      });

      const sessions = readRecentSessions();
      expect(sessions.length).toBe(3);
      expect(sessions[0].sourceId).toBe(3);
      expect(sessions[1].sourceId).toBe(2);
      expect(sessions[2].sourceId).toBe(1);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        logGenerationSession({
          sourceId: i,
          patternsUsed: [],
          attempts: 1,
          finalStatus: 'success',
          durationMs: 100,
        });
      }

      const sessions = readRecentSessions(3);
      expect(sessions.length).toBe(3);
    });
  });

  describe('getSessionStats', () => {
    it('returns zero stats when no sessions', () => {
      const stats = getSessionStats();
      expect(stats).toEqual({
        total: 0,
        byStatus: {},
        avgDurationMs: 0,
        avgAttempts: 0,
      });
    });

    it('aggregates session statistics', () => {
      logGenerationSession({
        sourceId: 1,
        patternsUsed: [],
        attempts: 1,
        finalStatus: 'success',
        durationMs: 1000,
      });
      logGenerationSession({
        sourceId: 2,
        patternsUsed: [],
        attempts: 3,
        finalStatus: 'success',
        durationMs: 3000,
      });
      logGenerationSession({
        sourceId: 3,
        patternsUsed: [],
        attempts: 2,
        finalStatus: 'failed',
        durationMs: 2000,
      });

      const stats = getSessionStats();
      expect(stats.total).toBe(3);
      expect(stats.byStatus['success']).toBe(2);
      expect(stats.byStatus['failed']).toBe(1);
      expect(stats.avgDurationMs).toBe(2000);
      expect(stats.avgAttempts).toBe(2);
    });
  });

  describe('clearSessionLogs', () => {
    it('removes log file', () => {
      logGenerationSession({
        sourceId: 1,
        patternsUsed: [],
        attempts: 1,
        finalStatus: 'success',
        durationMs: 100,
      });

      expect(fs.existsSync(LOG_FILE)).toBe(true);
      clearSessionLogs();
      expect(fs.existsSync(LOG_FILE)).toBe(false);
    });

    it('does not throw if file does not exist', () => {
      expect(() => clearSessionLogs()).not.toThrow();
    });
  });
});
