import { describe, it, expect } from 'vitest';

import {
  checkHumanizerPatterns,
  checkPattern,
  getPatternName,
  getAllPatternTypes,
  getHumanizerScore,
  hasHighHumanizerScore,
  formatHumanizerResult,
  detectPatternWithRewrite,
  detectAllPatternsWithRewrites,
} from './humanizer-patterns';

describe('Humanizer Patterns', () => {
  describe('Content Patterns (1-6)', () => {
    it('detects significance inflation', () => {
      const content = 'This is revolutionizing the industry with unprecedented growth.';
      const result = checkPattern(content, 'significance_inflation');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThan(0);
      expect(result?.severity).toBe('medium');
    });

    it('detects notability name-dropping', () => {
      const content = 'Featured in major publications and recognized by industry leaders.';
      const result = checkPattern(content, 'notability_namedropping');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThan(0);
    });

    it('detects superficial -ing analysis', () => {
      const content = 'Showcasing the importance of innovation while leveraging synergies.';
      const result = checkPattern(content, 'superficial_ing_analysis');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThan(0);
    });

    it('detects promotional language', () => {
      const content = 'Our cutting-edge, state-of-the-art solution offers unparalleled value.';
      const result = checkPattern(content, 'promotional_language');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(2);
    });

    it('detects vague attributions', () => {
      const content = 'Experts believe this approach is effective. Studies show great results.';
      const result = checkPattern(content, 'vague_attributions');

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('high');
    });

    it('detects formulaic challenges', () => {
      const content = 'Despite the challenges, we overcame the obstacles and succeeded.';
      const result = checkPattern(content, 'formulaic_challenges');

      expect(result).not.toBeNull();
    });
  });

  describe('Language Patterns (7-12)', () => {
    it('detects AI vocabulary', () => {
      const content = 'Additionally, this serves as a testament to the evolving landscape.';
      const result = checkPattern(content, 'ai_vocabulary');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(2);
      expect(result?.severity).toBe('high');
    });

    it('detects copula avoidance', () => {
      const content = 'The product serves as a solution. It features a wide array of options.';
      const result = checkPattern(content, 'copula_avoidance');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(1);
    });

    it('detects negative parallelisms', () => {
      const content = "It's not just a tool, it's a revolution. More than merely a product.";
      const result = checkPattern(content, 'negative_parallelisms');

      expect(result).not.toBeNull();
    });

    it('detects false ranges', () => {
      const content = 'From startups to enterprises, everything from simple to complex.';
      const result = checkPattern(content, 'false_ranges');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Style Patterns (13-18)', () => {
    it('detects em dash overuse', () => {
      const content = 'This is important—very important—for success—and growth—in the market.';
      const result = checkPattern(content, 'em_dash_overuse');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(3);
    });

    it('does not flag normal dash usage', () => {
      const content = 'This is important—very important indeed.';
      const result = checkPattern(content, 'em_dash_overuse');

      expect(result).toBeNull();
    });

    it('detects boldface overuse', () => {
      const content = '**Feature 1** is great. **Feature 2** rocks. **Feature 3** is amazing.';
      const result = checkPattern(content, 'boldface_overuse');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(3);
    });

    it('detects inline header lists', () => {
      const content = '**Key Features:** This is it.\n- **Label:** description here.';
      const result = checkPattern(content, 'inline_header_lists');

      expect(result).not.toBeNull();
    });

    it('detects curly quotes', () => {
      const content = 'He said "hello" and "goodbye" in a very "nice" way.';
      const result = checkPattern(content, 'curly_quotes');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThan(0);
    });

    it('detects emojis in professional text', () => {
      const content = 'Our solution is amazing! 🚀 Check out the results! 💯';
      const result = checkPattern(content, 'emoji_in_professional');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBe(2);
    });
  });

  describe('Communication Patterns (19-21)', () => {
    it('detects chatbot artifacts', () => {
      const content = 'Here is the answer. I hope this helps! Let me know if you need more.';
      const result = checkPattern(content, 'chatbot_artifacts');

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('high');
    });

    it('detects cutoff disclaimers', () => {
      const content = 'As of my knowledge cutoff, I cannot access real-time information.';
      const result = checkPattern(content, 'cutoff_disclaimers');

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('high');
    });

    it('detects sycophantic tone', () => {
      const content =
        "That's a great question! You're absolutely right about that. I completely agree.";
      const result = checkPattern(content, 'sycophantic_tone');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Filler and Hedging (22-24)', () => {
    it('detects filler phrases', () => {
      const content = 'In order to succeed, at the end of the day we are prepared.';
      const result = checkPattern(content, 'filler_phrases');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBe(2);
    });

    it('detects excessive hedging', () => {
      const content = 'This could potentially help. It might possibly work. Perhaps maybe.';
      const result = checkPattern(content, 'excessive_hedging');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(2);
    });

    it('detects generic conclusions', () => {
      const content = 'Only time will tell. The future looks bright. Exciting times ahead!';
      const result = checkPattern(content, 'generic_conclusions');

      expect(result).not.toBeNull();
      expect(result?.matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('checkHumanizerPatterns', () => {
    it('returns no issues for clean content', () => {
      const content = 'I built a simple tool that helps developers write better code.';
      const result = checkHumanizerPatterns(content);

      expect(result.hasIssues).toBe(false);
      expect(result.patterns).toHaveLength(0);
      expect(result.totalScore).toBe(0);
    });

    it('detects multiple patterns in AI-heavy content', () => {
      const content = `
        This groundbreaking solution is revolutionizing the industry.
        Additionally, experts believe it's not just a tool, it's a game-changer.
        I hope this helps! Let me know if you have questions.
      `;
      const result = checkHumanizerPatterns(content);

      expect(result.hasIssues).toBe(true);
      expect(result.patterns.length).toBeGreaterThanOrEqual(3);
      expect(result.totalScore).toBeGreaterThan(0);
    });

    it('calculates severity scores correctly', () => {
      const content = 'I hope this helps! Additionally, experts believe this works.';
      const result = checkHumanizerPatterns(content);

      // chatbot_artifacts = high (30), ai_vocabulary = high (30), vague_attributions = high (30)
      expect(result.totalScore).toBeGreaterThanOrEqual(30);
    });
  });

  describe('hasHighHumanizerScore', () => {
    it('returns true when score exceeds threshold', () => {
      const content =
        'Additionally, experts believe this revolutionary solution is unprecedented. I hope this helps!';
      const result = checkHumanizerPatterns(content);

      expect(hasHighHumanizerScore(result, 30)).toBe(true);
    });

    it('returns false for clean content', () => {
      const content = 'I made a simple script.';
      const result = checkHumanizerPatterns(content);

      expect(hasHighHumanizerScore(result, 50)).toBe(false);
    });

    it('uses default threshold of 50', () => {
      const result = checkHumanizerPatterns('Simple text.');
      expect(hasHighHumanizerScore(result)).toBe(false);
    });
  });

  describe('getPatternName', () => {
    it('returns human-readable names', () => {
      expect(getPatternName('ai_vocabulary')).toBe('AI Vocabulary');
      expect(getPatternName('chatbot_artifacts')).toBe('Chatbot Artifacts');
      expect(getPatternName('significance_inflation')).toBe('Significance Inflation');
    });
  });

  describe('getAllPatternTypes', () => {
    it('returns all 24 pattern types', () => {
      const types = getAllPatternTypes();
      expect(types.length).toBe(24);
    });

    it('includes expected pattern types', () => {
      const types = getAllPatternTypes();
      expect(types).toContain('ai_vocabulary');
      expect(types).toContain('chatbot_artifacts');
      expect(types).toContain('significance_inflation');
      expect(types).toContain('generic_conclusions');
    });
  });

  describe('getHumanizerScore', () => {
    it('returns totalScore from result', () => {
      const content = 'Additionally, this is important.';
      const result = checkHumanizerPatterns(content);
      expect(getHumanizerScore(result)).toBe(result.totalScore);
    });
  });

  describe('formatHumanizerResult', () => {
    it('formats clean result correctly', () => {
      const result = checkHumanizerPatterns('Simple text.');
      const formatted = formatHumanizerResult(result);

      expect(formatted).toBe('No AI-sounding patterns detected.');
    });

    it('formats issues with severity and suggestions', () => {
      const result = checkHumanizerPatterns('Additionally, I hope this helps!');
      const formatted = formatHumanizerResult(result);

      expect(formatted).toContain('AI-sounding patterns detected');
      expect(formatted).toContain('Suggestion:');
      expect(formatted).toContain('[HIGH]');
    });
  });

  describe('Pattern edge cases', () => {
    it('handles empty content', () => {
      const result = checkHumanizerPatterns('');
      expect(result.hasIssues).toBe(false);
    });

    it('handles content with only whitespace', () => {
      const result = checkHumanizerPatterns('   \n\t   ');
      expect(result.hasIssues).toBe(false);
    });

    it('is case insensitive for most patterns', () => {
      const upperResult = checkPattern('ADDITIONALLY', 'ai_vocabulary');
      const lowerResult = checkPattern('additionally', 'ai_vocabulary');

      expect(upperResult).not.toBeNull();
      expect(lowerResult).not.toBeNull();
    });
  });

  describe('Synonym cycling detection', () => {
    it('detects cycling through importance synonyms', () => {
      const content =
        'This is important for success. It is crucial for growth. It is vital for survival.';
      const result = checkPattern(content, 'synonym_cycling');

      expect(result).not.toBeNull();
    });

    it('does not flag single word usage', () => {
      const content = 'This is important for success.';
      const result = checkPattern(content, 'synonym_cycling');

      expect(result).toBeNull();
    });
  });

  describe('Rule of three detection', () => {
    it('detects forced triplets with similar word lengths', () => {
      const content = 'We focus on speed, scale, and scope.';
      const result = checkPattern(content, 'rule_of_three');

      expect(result).not.toBeNull();
    });
  });

  describe('Integration with main detector', () => {
    it('provides suggestions for each pattern', () => {
      const content = 'Additionally, experts believe this revolutionary solution is unprecedented.';
      const result = checkHumanizerPatterns(content);

      for (const pattern of result.patterns) {
        expect(pattern.suggestion).toBeTruthy();
        expect(pattern.suggestion.length).toBeGreaterThan(0);
      }
    });

    it('includes match examples', () => {
      const content = 'Additionally, furthermore, moreover this is important.';
      const result = checkHumanizerPatterns(content);

      const aiVocab = result.patterns.find((p) => p.patternType === 'ai_vocabulary');
      expect(aiVocab).toBeDefined();
      expect(aiVocab?.matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('detectPatternWithRewrite', () => {
    it('returns PatternDetectionResult array with correct structure', () => {
      const results = detectPatternWithRewrite(
        'Additionally, we need to delve into this.',
        'ai_vocabulary'
      );

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result).toHaveProperty('detected');
        expect(result).toHaveProperty('original');
        expect(result).toHaveProperty('suggestion');
        expect(result).toHaveProperty('patternName');
        expect(result.detected).toBe(true);
        expect(typeof result.original).toBe('string');
        expect(typeof result.suggestion).toBe('string');
        expect(typeof result.patternName).toBe('string');
      }
    });

    it('provides specific rewrite for AI vocabulary', () => {
      const results = detectPatternWithRewrite(
        'Additionally, the project was successful.',
        'ai_vocabulary'
      );

      expect(results.length).toBeGreaterThan(0);
      const additionally = results.find((r) => r.original.toLowerCase().includes('additionally'));
      expect(additionally).toBeDefined();
      expect(additionally?.suggestion).toContain('also');
    });

    it('provides specific rewrite for filler phrases', () => {
      const results = detectPatternWithRewrite(
        'In order to succeed, we must try.',
        'filler_phrases'
      );

      expect(results.length).toBe(1);
      expect(results[0].original.toLowerCase()).toContain('in order to');
      expect(results[0].suggestion).toContain('to');
      expect(results[0].patternName).toBe('Filler Phrases');
    });

    it('provides specific rewrite for copula avoidance', () => {
      const results = detectPatternWithRewrite(
        'The tool serves as a solution.',
        'copula_avoidance'
      );

      expect(results.length).toBe(1);
      expect(results[0].suggestion).toContain('is');
    });

    it('returns empty array when pattern not detected', () => {
      const results = detectPatternWithRewrite('Simple clean text here.', 'ai_vocabulary');

      expect(results).toHaveLength(0);
    });

    it('includes pattern name in result', () => {
      const results = detectPatternWithRewrite('I hope this helps!', 'chatbot_artifacts');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].patternName).toBe('Chatbot Artifacts');
    });
  });

  describe('detectAllPatternsWithRewrites', () => {
    it('detects multiple patterns with rewrites', () => {
      const content = 'Additionally, I hope this helps! In order to succeed, we must try.';
      const results = detectAllPatternsWithRewrites(content);

      expect(results.length).toBeGreaterThanOrEqual(3);

      const patternNames = results.map((r) => r.patternName);
      expect(patternNames).toContain('AI Vocabulary');
      expect(patternNames).toContain('Chatbot Artifacts');
      expect(patternNames).toContain('Filler Phrases');
    });

    it('returns empty array for clean content', () => {
      const results = detectAllPatternsWithRewrites('Simple direct text.');

      expect(results).toHaveLength(0);
    });

    it('all results have required fields', () => {
      const content = 'Additionally, experts believe this is unprecedented. I hope this helps!';
      const results = detectAllPatternsWithRewrites(content);

      for (const result of results) {
        expect(result.detected).toBe(true);
        expect(result.original.length).toBeGreaterThan(0);
        expect(result.suggestion.length).toBeGreaterThan(0);
        expect(result.patternName.length).toBeGreaterThan(0);
      }
    });

    it('provides actionable rewrites', () => {
      const results = detectAllPatternsWithRewrites(
        'Furthermore, this represents a paradigm shift.'
      );

      const furthermoreResult = results.find((r) =>
        r.original.toLowerCase().includes('furthermore')
      );
      expect(furthermoreResult).toBeDefined();
      expect(furthermoreResult?.suggestion).not.toBe(furthermoreResult?.original);

      const paradigmResult = results.find((r) => r.original.toLowerCase().includes('paradigm'));
      expect(paradigmResult).toBeDefined();
      expect(paradigmResult?.suggestion).toContain('approach');
    });
  });
});
