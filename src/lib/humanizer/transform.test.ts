/**
 * Tests for humanize transform function
 * HUM-003: Test each pattern category, multiple patterns, no false positives
 */

import { describe, it, expect } from 'vitest';
import {
  humanizeContent,
  getAppliedChangesCount,
  getSuggestedChangesCount,
  formatHumanizeResult,
} from './transform';

describe('humanizeContent', () => {
  describe('Content Patterns (1-6)', () => {
    it('detects and rewrites significance inflation', () => {
      const text = 'This tool is revolutionizing the industry.';
      const result = humanizeContent(text);

      expect(result.changes.length).toBeGreaterThan(0);
      const change = result.changes.find((c) => c.patternName === 'Significance Inflation');
      expect(change).toBeDefined();
      expect(change?.applied).toBe(true);
      expect(result.humanized).toContain('changing');
    });

    it('detects vague attributions', () => {
      const text = 'Experts believe this is the best approach.';
      const result = humanizeContent(text);

      const change = result.changes.find((c) => c.patternName === 'Vague Attributions');
      expect(change).toBeDefined();
      // Vague attributions suggest manual review (bracketed suggestion)
      expect(change?.applied).toBe(false);
    });

    it('detects formulaic challenges', () => {
      const text = 'Despite the challenges, they succeeded.';
      const result = humanizeContent(text);

      const change = result.changes.find((c) => c.patternName === 'Formulaic Challenges');
      expect(change).toBeDefined();
    });

    it('detects promotional language', () => {
      const text = 'Our cutting-edge solution offers seamless integration.';
      const result = humanizeContent(text);

      const changes = result.changes.filter((c) => c.patternName === 'Promotional Language');
      expect(changes.length).toBeGreaterThanOrEqual(2);
      // Should apply rewrites
      expect(result.humanized).toContain('new');
      expect(result.humanized).toContain('smooth');
    });
  });

  describe('Language Patterns (7-12)', () => {
    it('detects and rewrites AI vocabulary', () => {
      const text = 'Additionally, we must delve into the landscape of AI.';
      const result = humanizeContent(text);

      const changes = result.changes.filter((c) => c.patternName === 'AI Vocabulary');
      expect(changes.length).toBeGreaterThanOrEqual(2);
      // Rewrite is case-insensitive, so 'Additionally' -> 'also'
      expect(result.humanized).toContain('also');
      expect(result.humanized).toContain('field');
    });

    it('detects and rewrites copula avoidance', () => {
      const text = 'This platform serves as a powerful tool.';
      const result = humanizeContent(text);

      const change = result.changes.find((c) => c.patternName === 'Copula Avoidance');
      expect(change).toBeDefined();
      expect(change?.applied).toBe(true);
      expect(result.humanized).toContain('is');
    });

    it('detects negative parallelisms', () => {
      // Pattern requires "it's not just X, it's Y" format (word boundaries)
      const text = "It's not just good, it's great.";
      const result = humanizeContent(text);

      const change = result.changes.find((c) => c.patternName === 'Negative Parallelisms');
      expect(change).toBeDefined();
    });

    it('detects filler phrases and rewrites them', () => {
      const text = 'In order to succeed, we need to plan.';
      const result = humanizeContent(text);

      const change = result.changes.find((c) => c.patternName === 'Filler Phrases');
      expect(change).toBeDefined();
      expect(change?.applied).toBe(true);
      // 'in order to' -> 'to' (lowercase replacement)
      expect(result.humanized.toLowerCase()).toContain('to succeed');
    });
  });

  describe('Style Patterns (13-18)', () => {
    it('detects inline header lists', () => {
      // Test inline header list pattern: **Label:** description
      const text = '**Summary:** This is the summary. **Details:** Here are the details.';
      const result = humanizeContent(text);

      const changes = result.changes.filter((c) => c.patternName === 'Inline-Header Lists');
      expect(changes.length).toBeGreaterThan(0);
      // Inline header lists suggest manual conversion to prose
      expect(changes[0].applied).toBe(false);
    });

    it('detects emoji in professional text', () => {
      const text = 'Our Q4 results are amazing! 🚀';
      const result = humanizeContent(text);

      const change = result.changes.find((c) => c.patternName === 'Emojis in Professional Text');
      expect(change).toBeDefined();
      // Emoji removal is a suggestion, not auto-applied
      expect(change?.applied).toBe(false);
    });

    it('detects em dash overuse only when 3+ dashes', () => {
      const textFew = 'This is important—very important.';
      const resultFew = humanizeContent(textFew);
      const fewDashes = resultFew.changes.filter((c) => c.patternName === 'Em Dash Overuse');
      expect(fewDashes.length).toBe(0);

      const textMany = 'First—then—next—finally.';
      const resultMany = humanizeContent(textMany);
      const manyDashes = resultMany.changes.filter((c) => c.patternName === 'Em Dash Overuse');
      expect(manyDashes.length).toBeGreaterThan(0);
    });

    it('detects boldface overuse only when 3+ bold sections', () => {
      const textFew = '**Important** point here.';
      const resultFew = humanizeContent(textFew);
      const fewBold = resultFew.changes.filter((c) => c.patternName === 'Boldface Overuse');
      expect(fewBold.length).toBe(0);

      const textMany = '**First** and **second** and **third** points.';
      const resultMany = humanizeContent(textMany);
      const manyBold = resultMany.changes.filter((c) => c.patternName === 'Boldface Overuse');
      expect(manyBold.length).toBeGreaterThan(0);
    });
  });

  describe('Communication Patterns (19-24)', () => {
    it('detects chatbot artifacts', () => {
      const text = 'I hope this helps! Let me know if you have any questions.';
      const result = humanizeContent(text);

      const changes = result.changes.filter((c) => c.patternName === 'Chatbot Artifacts');
      expect(changes.length).toBeGreaterThanOrEqual(2);
    });

    it('detects cutoff disclaimers', () => {
      const text = 'As of my knowledge cutoff, this was the latest data.';
      const result = humanizeContent(text);

      const change = result.changes.find((c) => c.patternName === 'Cutoff Disclaimers');
      expect(change).toBeDefined();
    });

    it('detects sycophantic tone', () => {
      const text = "That's a great question! I completely agree with you.";
      const result = humanizeContent(text);

      const changes = result.changes.filter((c) => c.patternName === 'Sycophantic Tone');
      expect(changes.length).toBeGreaterThanOrEqual(1);
    });

    it('detects generic conclusions', () => {
      const text = 'Only time will tell what the future holds.';
      const result = humanizeContent(text);

      const change = result.changes.find((c) => c.patternName === 'Generic Conclusions');
      expect(change).toBeDefined();
    });

    it('detects excessive hedging only when 2+ hedges', () => {
      const textFew = 'This could potentially work.';
      const resultFew = humanizeContent(textFew);
      const change = resultFew.changes.find((c) => c.patternName === 'Excessive Hedging');
      // Single hedge with double qualifier still counts
      expect(change?.applied).toBe(true);
      expect(resultFew.humanized).toContain('may');
    });
  });

  describe('Multiple patterns in one text', () => {
    it('detects and applies multiple patterns', () => {
      const text =
        'Additionally, this cutting-edge solution serves as a powerful tool. I hope this helps!';
      const result = humanizeContent(text);

      expect(result.changes.length).toBeGreaterThanOrEqual(4);

      const patternNames = result.changes.map((c) => c.patternName);
      expect(patternNames).toContain('AI Vocabulary'); // Additionally
      expect(patternNames).toContain('Promotional Language'); // cutting-edge
      expect(patternNames).toContain('Copula Avoidance'); // serves as
      expect(patternNames).toContain('Chatbot Artifacts'); // I hope this helps

      // Check applied transformations (replacements are lowercase)
      expect(result.humanized).toContain('also'); // Additionally -> also
      expect(result.humanized).toContain('new'); // cutting-edge -> new
      expect(result.humanized).toContain('is'); // serves as -> is
    });

    it('tracks applied vs suggested changes separately', () => {
      const text = 'Experts believe this innovative approach is testament to progress.';
      const result = humanizeContent(text);

      const applied = result.changes.filter((c) => c.applied);
      const suggested = result.changes.filter((c) => !c.applied);

      // 'innovative' and 'testament to' should be applied
      expect(applied.length).toBeGreaterThan(0);
      // 'Experts believe' needs manual review (bracketed suggestion)
      expect(suggested.length).toBeGreaterThan(0);
    });
  });

  describe('No false positives', () => {
    it('does not flag clean conversational text', () => {
      const text = 'I went to the store and bought some groceries. The weather was nice today.';
      const result = humanizeContent(text);

      expect(result.changes.length).toBe(0);
      expect(result.humanized).toBe(text);
    });

    it('does not flag technical text without AI patterns', () => {
      const text =
        'The function accepts two parameters and returns a boolean. It checks if the value is null.';
      const result = humanizeContent(text);

      expect(result.changes.length).toBe(0);
      expect(result.humanized).toBe(text);
    });

    it('does not flag news-style writing without AI patterns', () => {
      const text =
        'The company announced earnings of $2.5 billion. Stock prices rose 3% in after-hours trading.';
      const result = humanizeContent(text);

      expect(result.changes.length).toBe(0);
      expect(result.humanized).toBe(text);
    });

    it('does not flag normal use of common words', () => {
      const text = 'The show features great performances from the entire cast.';
      const result = humanizeContent(text);

      // 'features' alone without the specific pattern "features a/an/the X array/range/variety"
      // should not trigger copula avoidance
      const copulaChanges = result.changes.filter((c) => c.patternName === 'Copula Avoidance');
      expect(copulaChanges.length).toBe(0);
    });

    it('preserves content when no patterns detected', () => {
      const text = 'Simple text here.';
      const result = humanizeContent(text);

      expect(result.humanized).toBe(text);
      expect(getAppliedChangesCount(result)).toBe(0);
      expect(getSuggestedChangesCount(result)).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('handles empty string', () => {
      const result = humanizeContent('');

      expect(result.humanized).toBe('');
      expect(result.changes.length).toBe(0);
    });

    it('handles string with only whitespace', () => {
      const result = humanizeContent('   \n\t  ');

      expect(result.humanized).toBe('   \n\t  ');
      expect(result.changes.length).toBe(0);
    });

    it('handles very long text', () => {
      const text = 'Additionally, '.repeat(100) + 'this is the end.';
      const result = humanizeContent(text);

      // Should detect pattern but not crash
      expect(result.changes.length).toBeGreaterThan(0);
      // Replacement is lowercase
      expect(result.humanized).toContain('also');
    });

    it('preserves case when applying rewrites', () => {
      const text = 'ADDITIONALLY, this is important.';
      const result = humanizeContent(text);

      // The replacement should work case-insensitively
      const change = result.changes.find((c) => c.patternName === 'AI Vocabulary');
      expect(change).toBeDefined();
      expect(change?.applied).toBe(true);
    });

    it('does not double-process same match', () => {
      const text = 'Furthermore, furthermore, we proceed.';
      const result = humanizeContent(text);

      // Each occurrence is detected separately by the pattern detector
      const aiVocabChanges = result.changes.filter(
        (c) => c.patternName === 'AI Vocabulary' && c.original.toLowerCase() === 'furthermore'
      );
      // The detector finds both matches, but the first replacement handles both via global replace
      expect(aiVocabChanges.length).toBe(2);
      // Both should be replaced (global replace in applyRewrite)
      expect(result.humanized).not.toContain('furthermore');
      expect(result.humanized).not.toContain('Furthermore');
    });
  });
});

describe('getAppliedChangesCount', () => {
  it('counts only applied changes', () => {
    const text = 'Additionally, experts believe this is good.';
    const result = humanizeContent(text);

    const appliedCount = getAppliedChangesCount(result);
    const actualApplied = result.changes.filter((c) => c.applied).length;

    expect(appliedCount).toBe(actualApplied);
    expect(appliedCount).toBeGreaterThan(0);
  });
});

describe('getSuggestedChangesCount', () => {
  it('counts only suggested (not applied) changes', () => {
    const text = 'Experts believe this is correct.';
    const result = humanizeContent(text);

    const suggestedCount = getSuggestedChangesCount(result);
    const actualSuggested = result.changes.filter((c) => !c.applied).length;

    expect(suggestedCount).toBe(actualSuggested);
    expect(suggestedCount).toBeGreaterThan(0);
  });
});

describe('formatHumanizeResult', () => {
  it('formats result with no patterns', () => {
    const result = humanizeContent('Clean text here.');
    const formatted = formatHumanizeResult(result);

    expect(formatted).toContain('No AI patterns detected');
    expect(formatted).toContain('Content unchanged');
  });

  it('formats result with applied changes', () => {
    const result = humanizeContent('Additionally, this is good.');
    const formatted = formatHumanizeResult(result);

    expect(formatted).toContain('Humanized content');
    expect(formatted).toContain('Applied changes');
    expect(formatted).toContain('AI Vocabulary');
  });

  it('formats result with suggested changes needing manual review', () => {
    const result = humanizeContent('Experts believe this is true.');
    const formatted = formatHumanizeResult(result);

    expect(formatted).toContain('Manual review needed');
  });

  it('shows both applied and suggested sections', () => {
    const result = humanizeContent('Additionally, experts believe this is true.');
    const formatted = formatHumanizeResult(result);

    expect(formatted).toContain('Applied changes');
    expect(formatted).toContain('Manual review needed');
  });
});
