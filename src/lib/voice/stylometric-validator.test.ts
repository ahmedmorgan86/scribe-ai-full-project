/**
 * Tests for stylometric validation - verifies posts with intentionally wrong style are rejected.
 * PRD Section 25.4: Test: Generate posts with intentionally wrong style, verify rejection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateSync,
  validateWithSignature,
  DEFAULT_THRESHOLD,
  StylometricValidationResult,
} from './stylometric-validator';
import { StyleSignature, generateSignature, compareSignatures } from './signature';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/db/qdrant/connection', () => ({
  getQdrantClient: vi.fn(),
  collectionExists: vi.fn().mockResolvedValue(false),
  QDRANT_COLLECTION_NAMES: { APPROVED_POSTS: 'approved_posts' },
}));

// Baseline persona derived from short-form social posts (like GOOD_STYLE_POST)
// Short posts naturally have high TTR (~0.93) since words don't repeat much
// and shallow clause depth (~0.2) with simple sentence structures.
const BASELINE_PERSONA: StyleSignature = {
  sentenceLength: {
    mean: 8,
    stdDev: 3,
  },
  punctuation: {
    periodRate: 0.7,
    commaRate: 0.07,
    exclamationRate: 0,
    questionRate: 0.04,
    dashRate: 0.06,
    ellipsisRate: 0,
  },
  vocabulary: {
    typeTokenRatio: 0.93,
    hapaxRatio: 0.92,
  },
  functionWords: {
    the: 0.025,
    and: 0.013,
    but: 0,
    of: 0,
    to: 0.034,
    a: 0.026,
    in: 0.007,
    that: 0,
    is: 0.028,
    it: 0.015,
  },
  syntactic: {
    avgClauseDepth: 0.2,
    avgWordsPerClause: 6.5,
    subordinateClauseRatio: 0.18,
  },
};

const GOOD_STYLE_POST = `
Most devs overthink authentication. The simple approach: use an established library.
Don't roll your own crypto. Don't build custom session management.
Pick a battle-tested solution and move on to the actual problem you're solving.
`;

const WRONG_STYLE_TOO_LONG_SENTENCES = `
When you really stop and think about the absolutely fundamental and critical importance of implementing proper authentication mechanisms in your web applications, you begin to realize that the complexity involved in building secure systems from scratch is not only daunting but also potentially dangerous, because even the smallest oversight in your security implementation can lead to catastrophic data breaches that could affect millions of users and ultimately destroy your company's reputation in the marketplace, which is why many experienced developers recommend using well-established and thoroughly tested authentication libraries that have been battle-hardened through years of production use across thousands of different applications.
`;

const WRONG_STYLE_EXCESSIVE_EXCLAMATION = `
OMG you HAVE to check this out!!!
This is literally THE BEST thing ever!!!
I can't even believe how amazing this is!!!
WOW!!! Just WOW!!!
Everyone needs to know about this RIGHT NOW!!!
`;

const WRONG_STYLE_TOO_MANY_QUESTIONS = `
Have you ever wondered about authentication?
Why do we even need passwords?
What makes a session secure anyway?
Do cookies really work?
Should we trust JWT tokens?
Is OAuth really better?
What about biometrics?
Could quantum computing break everything?
`;

const WRONG_STYLE_TOO_SIMPLE = `
Auth is hard. Use libs. Don't DIY. It breaks. Bad idea. Get help. Stay safe. Move on. Ship code. Be smart.
`;

const WRONG_STYLE_ACADEMIC_VERBOSE = `
The implementation of authentication mechanisms within contemporary software systems necessitates a comprehensive understanding of cryptographic principles, session management paradigms, and threat modeling methodologies. Furthermore, the utilization of established frameworks, as opposed to bespoke implementations, is generally recommended by security professionals due to the inherent complexity associated with secure system design and the potential for inadvertent vulnerabilities that may arise from insufficient expertise in cryptographic engineering.
`;

const WRONG_STYLE_ELLIPSIS_HEAVY = `
So I was thinking about authentication... and well... it's complicated...
Most people don't get it... which is... you know... understandable...
The thing is... security is hard... really hard...
Maybe we should... just use a library... or something...
`;

describe('Stylometric Validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateSync with explicit persona', () => {
    it('should PASS content matching the persona style', () => {
      const result = validateSync(GOOD_STYLE_POST, BASELINE_PERSONA, DEFAULT_THRESHOLD);

      expect(result.pass).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
      expect(result.feedback).toBe('Stylometric validation passed');
    });

    it('should REJECT content with excessively long sentences', () => {
      const result = validateSync(
        WRONG_STYLE_TOO_LONG_SENTENCES,
        BASELINE_PERSONA,
        DEFAULT_THRESHOLD
      );

      expect(result.pass).toBe(false);
      // May fail due to low score OR critical dimension deviation
      expect(
        result.score < DEFAULT_THRESHOLD ||
          result.dimensionScores.sentenceLength < 0.3 ||
          result.dimensionScores.syntactic < 0.3
      ).toBe(true);
    });

    it('should REJECT content with excessive exclamation marks', () => {
      const result = validateSync(
        WRONG_STYLE_EXCESSIVE_EXCLAMATION,
        BASELINE_PERSONA,
        DEFAULT_THRESHOLD
      );

      expect(result.pass).toBe(false);
      // Punctuation dimension should be critically low (< 0.3) even if overall score is OK
      expect(result.dimensionScores.punctuation).toBeLessThan(0.3);
    });

    it('should REJECT content with too many questions', () => {
      const result = validateSync(
        WRONG_STYLE_TOO_MANY_QUESTIONS,
        BASELINE_PERSONA,
        DEFAULT_THRESHOLD
      );

      expect(result.pass).toBe(false);
      expect(result.score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should REJECT content with overly simple/choppy sentences', () => {
      const result = validateSync(WRONG_STYLE_TOO_SIMPLE, BASELINE_PERSONA, DEFAULT_THRESHOLD);

      expect(result.pass).toBe(false);
      expect(result.score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should REJECT academic/verbose style', () => {
      const result = validateSync(
        WRONG_STYLE_ACADEMIC_VERBOSE,
        BASELINE_PERSONA,
        DEFAULT_THRESHOLD
      );

      expect(result.pass).toBe(false);
      expect(result.score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should REJECT content heavy with ellipses', () => {
      const result = validateSync(WRONG_STYLE_ELLIPSIS_HEAVY, BASELINE_PERSONA, DEFAULT_THRESHOLD);

      expect(result.pass).toBe(false);
      expect(result.score).toBeLessThan(DEFAULT_THRESHOLD);
    });
  });

  describe('validateWithSignature async', () => {
    it('should pass content matching persona', async () => {
      const result = await validateWithSignature(GOOD_STYLE_POST, BASELINE_PERSONA);

      expect(result.pass).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should reject wrong style content', async () => {
      const result = await validateWithSignature(WRONG_STYLE_TOO_LONG_SENTENCES, BASELINE_PERSONA);

      expect(result.pass).toBe(false);
      expect(result.feedback).not.toBe('Stylometric validation passed');
    });

    it('should respect custom threshold', async () => {
      const strictResult = await validateWithSignature(GOOD_STYLE_POST, BASELINE_PERSONA, 0.95);
      const lenientResult = await validateWithSignature(GOOD_STYLE_POST, BASELINE_PERSONA, 0.3);

      expect(lenientResult.pass).toBe(true);
      expect(strictResult.score).toEqual(lenientResult.score);
    });
  });

  describe('validate with no persona available', () => {
    it('should pass by default when no persona signature available', async () => {
      vi.doMock('./signature', async () => {
        const actual = await vi.importActual('./signature');
        return {
          ...actual,
          loadPersonaSignature: vi.fn().mockResolvedValue(null),
        };
      });

      const { validate: validateFresh } = await import('./stylometric-validator');
      const result = await validateFresh(WRONG_STYLE_EXCESSIVE_EXCLAMATION);

      expect(result.pass).toBe(true);
      expect(result.feedback).toContain('No persona signature');
    });
  });

  describe('dimension score breakdown', () => {
    it('should provide detailed dimension scores', () => {
      const result = validateSync(WRONG_STYLE_TOO_LONG_SENTENCES, BASELINE_PERSONA);

      expect(result.dimensionScores).toHaveProperty('sentenceLength');
      expect(result.dimensionScores).toHaveProperty('punctuation');
      expect(result.dimensionScores).toHaveProperty('vocabulary');
      expect(result.dimensionScores).toHaveProperty('functionWords');
      expect(result.dimensionScores).toHaveProperty('syntactic');

      expect(typeof result.dimensionScores.sentenceLength).toBe('number');
      expect(result.dimensionScores.sentenceLength).toBeGreaterThanOrEqual(0);
      expect(result.dimensionScores.sentenceLength).toBeLessThanOrEqual(1);
    });

    it('should identify which dimension failed for long sentences', () => {
      const result = validateSync(WRONG_STYLE_TOO_LONG_SENTENCES, BASELINE_PERSONA);

      expect(result.dimensionScores.sentenceLength).toBeLessThan(0.5);
    });

    it('should identify which dimension failed for excessive punctuation', () => {
      const result = validateSync(WRONG_STYLE_EXCESSIVE_EXCLAMATION, BASELINE_PERSONA);

      expect(result.dimensionScores.punctuation).toBeLessThan(0.8);
    });
  });

  describe('actionable feedback generation', () => {
    it('should provide actionable feedback for sentence length issues', () => {
      const result = validateSync(WRONG_STYLE_TOO_LONG_SENTENCES, BASELINE_PERSONA);

      // Feedback may contain "sentence", "syntactic", or "Critical deviation"
      const hasRelevantFeedback =
        result.feedback.toLowerCase().includes('sentence') ||
        result.feedback.toLowerCase().includes('syntactic') ||
        result.feedback.toLowerCase().includes('critical');
      expect(hasRelevantFeedback).toBe(true);
    });

    it('should provide actionable feedback for punctuation issues', () => {
      const result = validateSync(WRONG_STYLE_EXCESSIVE_EXCLAMATION, BASELINE_PERSONA);

      const hasRelevantFeedback =
        result.feedback.toLowerCase().includes('exclamation') ||
        result.feedback.toLowerCase().includes('punctuation') ||
        result.feedback.toLowerCase().includes('critical') ||
        result.detailedFeedback.some(
          (f) => f.toLowerCase().includes('exclamation') || f.toLowerCase().includes('emphasis')
        );

      expect(hasRelevantFeedback).toBe(true);
    });

    it('should include detailedFeedback array', () => {
      const result = validateSync(WRONG_STYLE_TOO_LONG_SENTENCES, BASELINE_PERSONA);

      expect(Array.isArray(result.detailedFeedback)).toBe(true);
    });
  });

  describe('PRD Section 25.4 verification: wrong style rejection', () => {
    const wrongStyleSamples = [
      { name: 'Too long sentences', content: WRONG_STYLE_TOO_LONG_SENTENCES },
      { name: 'Excessive exclamation', content: WRONG_STYLE_EXCESSIVE_EXCLAMATION },
      { name: 'Too many questions', content: WRONG_STYLE_TOO_MANY_QUESTIONS },
      { name: 'Too simple/choppy', content: WRONG_STYLE_TOO_SIMPLE },
      { name: 'Academic verbose', content: WRONG_STYLE_ACADEMIC_VERBOSE },
      { name: 'Ellipsis heavy', content: WRONG_STYLE_ELLIPSIS_HEAVY },
    ];

    it.each(wrongStyleSamples)('should REJECT $name style', ({ content }) => {
      const result = validateSync(content, BASELINE_PERSONA, DEFAULT_THRESHOLD);

      // pass should be false (may be due to low score OR critical dimension deviation)
      expect(result.pass).toBe(false);
    });

    it('should PASS content matching the persona', () => {
      const result = validateSync(GOOD_STYLE_POST, BASELINE_PERSONA, DEFAULT_THRESHOLD);

      expect(result.pass).toBe(true);
    });

    it('should provide rejection reasons for all wrong style content', () => {
      const results: StylometricValidationResult[] = wrongStyleSamples.map(({ content }) =>
        validateSync(content, BASELINE_PERSONA, DEFAULT_THRESHOLD)
      );

      results.forEach((result) => {
        expect(result.pass).toBe(false);
        expect(result.feedback).not.toBe('Stylometric validation passed');
        expect(result.feedback.length).toBeGreaterThan(0);
      });
    });
  });

  describe('signature generation and comparison', () => {
    it('should generate consistent signatures for same content', () => {
      const sig1 = generateSignature(GOOD_STYLE_POST);
      const sig2 = generateSignature(GOOD_STYLE_POST);

      expect(sig1.sentenceLength.mean).toEqual(sig2.sentenceLength.mean);
      expect(sig1.vocabulary.typeTokenRatio).toEqual(sig2.vocabulary.typeTokenRatio);
    });

    it('should generate different signatures for different content', () => {
      const goodSig = generateSignature(GOOD_STYLE_POST);
      const badSig = generateSignature(WRONG_STYLE_TOO_LONG_SENTENCES);

      expect(goodSig.sentenceLength.mean).not.toEqual(badSig.sentenceLength.mean);
    });

    it('should have high similarity for same content', () => {
      const sig = generateSignature(GOOD_STYLE_POST);
      const similarity = compareSignatures(sig, sig);

      expect(similarity).toBe(1);
    });

    it('should have lower similarity for different styles', () => {
      const goodSig = generateSignature(GOOD_STYLE_POST);
      const badSig = generateSignature(WRONG_STYLE_TOO_LONG_SENTENCES);
      const similarity = compareSignatures(goodSig, badSig);

      expect(similarity).toBeLessThan(0.8);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content gracefully', () => {
      const result = validateSync('', BASELINE_PERSONA);

      expect(result).toBeDefined();
      expect(typeof result.pass).toBe('boolean');
      expect(typeof result.score).toBe('number');
    });

    it('should handle single word content', () => {
      const result = validateSync('Hello', BASELINE_PERSONA);

      expect(result).toBeDefined();
      expect(typeof result.pass).toBe('boolean');
    });

    it('should handle content with only punctuation', () => {
      const result = validateSync('!!! ??? ...', BASELINE_PERSONA);

      expect(result).toBeDefined();
      expect(result.pass).toBe(false);
    });

    it('should handle very long content', () => {
      const longContent = GOOD_STYLE_POST.repeat(50);
      const result = validateSync(longContent, BASELINE_PERSONA);

      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
    });
  });
});
