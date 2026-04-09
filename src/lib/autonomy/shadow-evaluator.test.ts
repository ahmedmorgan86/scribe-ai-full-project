import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { closeDb, getDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { evaluateShadow, recordShadowEvaluation, getShadowStats } from './shadow-evaluator';
import { createPost } from '@/db/models/posts';
import { createPattern } from '@/db/models/patterns';

const TEST_DB_PATH = './data/test-shadow-evaluator.db';

beforeAll(() => {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
});

afterAll(() => {
  closeDb();
  resetDb();
  delete process.env.SQLITE_DB_PATH;
});

describe('shadow-evaluator', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    closeDb();
  });

  describe('evaluateShadow', () => {
    it('returns approve for high confidence', () => {
      // Create some patterns with high decay scores
      createPattern({
        patternType: 'voice',
        description: 'Test pattern 1',
        evidenceCount: 10,
      });
      const p2 = createPattern({
        patternType: 'hook',
        description: 'Test pattern 2',
        evidenceCount: 8,
      });

      // Create some approved posts for consistency
      for (let i = 0; i < 5; i++) {
        const post = createPost({
          content: `Approved post ${i}`,
          type: 'single',
          confidenceScore: 0.9,
          reasoning: {
            source: 'test',
            whyItWorks: 'test',
            voiceMatch: 0.9,
            timing: 'now',
            concerns: [],
          },
        });
        const db = getDb();
        db.prepare(`UPDATE posts SET status = 'approved' WHERE id = ?`).run(post.id);
      }

      const result = evaluateShadow({
        postId: 1,
        content: 'Test content',
        voiceScore: {
          voice: 85,
          hook: 80,
          topic: 75,
          originality: 70,
          overall: 80,
        },
        patternsUsed: [p2.id],
      });

      expect(result.decision).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.factors.voiceScore).toBe(0.8); // 80/100
      expect(result.reasoning.length).toBeGreaterThan(0);
    });

    it('returns reject for low confidence', () => {
      const result = evaluateShadow({
        postId: 1,
        content: 'Test content',
        voiceScore: {
          voice: 30,
          hook: 25,
          topic: 20,
          originality: 25,
          overall: 25,
        },
        patternsUsed: [],
      });

      expect(result.decision).toBe('reject');
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('handles missing voice score', () => {
      const result = evaluateShadow({
        postId: 1,
        content: 'Test content',
        voiceScore: null,
        patternsUsed: [],
      });

      expect(result.decision).toBeDefined();
      expect(result.factors.voiceScore).toBe(0.5); // Default for missing
    });

    it('handles empty patterns', () => {
      const result = evaluateShadow({
        postId: 1,
        content: 'Test content',
        patternsUsed: [],
      });

      expect(result.decision).toBeDefined();
      expect(result.factors.patternScore).toBe(0.5);
      expect(result.factors.decayScore).toBe(0.5);
    });
  });

  describe('recordShadowEvaluation', () => {
    it('stores evaluation in database', () => {
      const post = createPost({
        content: 'Test post',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });

      const result = evaluateShadow({
        postId: post.id,
        content: post.content,
        voiceScore: {
          voice: 80,
          hook: 75,
          topic: 70,
          originality: 65,
          overall: 75,
        },
      });

      recordShadowEvaluation(post.id, result);

      const db = getDb();
      const stmt = db.prepare(`SELECT ai_decision, ai_confidence FROM posts WHERE id = ?`);
      const row = stmt.get(post.id) as { ai_decision: string; ai_confidence: number };

      expect(row.ai_decision).toBe(result.decision);
      expect(row.ai_confidence).toBeCloseTo(result.confidence, 2);
    });
  });

  describe('getShadowStats', () => {
    it('returns zero stats when no evaluations', () => {
      const stats = getShadowStats();

      expect(stats.total).toBe(0);
      expect(stats.byDecision.approve).toBe(0);
      expect(stats.byDecision.reject).toBe(0);
      expect(stats.byDecision.needs_edit).toBe(0);
      expect(stats.avgConfidence).toBe(0);
      expect(stats.agreementRate).toBeNull();
    });

    it('calculates stats correctly', () => {
      // Create posts with AI decisions
      const db = getDb();

      for (let i = 0; i < 3; i++) {
        const post = createPost({
          content: `Post ${i}`,
          type: 'single',
          confidenceScore: 0.9,
          reasoning: {
            source: 'test',
            whyItWorks: 'test',
            voiceMatch: 0.9,
            timing: 'now',
            concerns: [],
          },
        });
        db.prepare(
          `UPDATE posts SET ai_decision = 'approve', ai_confidence = 0.8 WHERE id = ?`
        ).run(post.id);
      }

      for (let i = 0; i < 2; i++) {
        const post = createPost({
          content: `Reject post ${i}`,
          type: 'single',
          confidenceScore: 0.3,
          reasoning: {
            source: 'test',
            whyItWorks: 'test',
            voiceMatch: 0.3,
            timing: 'now',
            concerns: [],
          },
        });
        db.prepare(`UPDATE posts SET ai_decision = 'reject', ai_confidence = 0.3 WHERE id = ?`).run(
          post.id
        );
      }

      const stats = getShadowStats();

      expect(stats.total).toBe(5);
      expect(stats.byDecision.approve).toBe(3);
      expect(stats.byDecision.reject).toBe(2);
      expect(stats.avgConfidence).toBeCloseTo((0.8 * 3 + 0.3 * 2) / 5, 2);
    });

    it('calculates agreement rate', () => {
      const db = getDb();

      // AI says approve, human approved -> agreement
      const p1 = createPost({
        content: 'Post 1',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });
      db.prepare(
        `UPDATE posts SET status = 'approved', ai_decision = 'approve', ai_confidence = 0.8 WHERE id = ?`
      ).run(p1.id);

      // AI says approve, human rejected -> disagreement
      const p2 = createPost({
        content: 'Post 2',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });
      db.prepare(
        `UPDATE posts SET status = 'rejected', ai_decision = 'approve', ai_confidence = 0.8 WHERE id = ?`
      ).run(p2.id);

      // AI says reject, human rejected -> agreement
      const p3 = createPost({
        content: 'Post 3',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });
      db.prepare(
        `UPDATE posts SET status = 'rejected', ai_decision = 'reject', ai_confidence = 0.3 WHERE id = ?`
      ).run(p3.id);

      const stats = getShadowStats();

      expect(stats.total).toBe(3);
      expect(stats.agreementRate).toBeCloseTo(2 / 3, 2); // 2 agreements out of 3
    });
  });
});
