import { describe, it, expect } from 'vitest';

import {
  checkForBannedPhrases,
  isBannedPhrase,
  getBannedPhrasesList,
  formatPhraseCheckResult,
  BANNED_PHRASES,
} from './phrase-blacklist';

import {
  checkStructuralPatterns,
  checkForExcessiveEmoji,
  checkForListicleFormat,
  checkForHashtags,
  checkForAllCapsAbuse,
  checkForExcessivePunctuation,
  checkForClickbaitOpening,
  checkForFillerPhrases,
  checkForFormulaicStructure,
  hasHighSeverityIssue,
  getIssueSeverityScore,
  formatStructuralCheckResult,
} from './structural';

describe('Phrase Blacklist Detector', () => {
  describe('checkForBannedPhrases', () => {
    it('detects basic banned phrases', () => {
      const content = "Let's dive in and explore this topic.";
      const result = checkForBannedPhrases(content);

      expect(result.hasBannedPhrases).toBe(true);
      expect(result.detector).toBe('phrase');
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.some((m) => m.phrase === "let's dive in")).toBe(true);
    });

    it('detects multiple banned phrases', () => {
      const content =
        "Here's the thing: this is a game changer that will revolutionize everything.";
      const result = checkForBannedPhrases(content);

      expect(result.hasBannedPhrases).toBe(true);
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
    });

    it('returns no matches for clean content', () => {
      const content = 'I built a tool that helps developers write better code.';
      const result = checkForBannedPhrases(content);

      expect(result.hasBannedPhrases).toBe(false);
      expect(result.matches).toHaveLength(0);
    });

    it('handles case insensitivity', () => {
      const content = "GAME CHANGER alert! LET'S DIVE IN to this topic.";
      const result = checkForBannedPhrases(content);

      expect(result.hasBannedPhrases).toBe(true);
    });

    it('handles smart quotes and apostrophes', () => {
      const content = "Here's the thing about this approach.";
      const result = checkForBannedPhrases(content);

      expect(result.hasBannedPhrases).toBe(true);
    });

    it('tracks positions of matches', () => {
      const content = "First, let's dive in to understand.";
      const result = checkForBannedPhrases(content);

      expect(result.hasBannedPhrases).toBe(true);
      expect(result.matches[0].position).toBeGreaterThanOrEqual(0);
    });
  });

  describe('isBannedPhrase', () => {
    it('returns true for banned phrase text', () => {
      expect(isBannedPhrase("let's dive in")).toBe(true);
      expect(isBannedPhrase('game changer')).toBe(true);
      expect(isBannedPhrase("here's the thing")).toBe(true);
    });

    it('returns false for clean text', () => {
      expect(isBannedPhrase('useful information')).toBe(false);
      expect(isBannedPhrase('practical advice')).toBe(false);
    });
  });

  describe('getBannedPhrasesList', () => {
    it('returns the full list of banned phrases', () => {
      const list = getBannedPhrasesList();

      expect(list).toEqual(BANNED_PHRASES);
      expect(list.length).toBeGreaterThan(50);
    });

    it('returns readonly array', () => {
      const list = getBannedPhrasesList();
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe('formatPhraseCheckResult', () => {
    it('formats clean result correctly', () => {
      const result = checkForBannedPhrases('Clean content here.');
      const formatted = formatPhraseCheckResult(result);

      expect(formatted).toBe('No banned phrases detected.');
    });

    it('formats result with matches correctly', () => {
      const result = checkForBannedPhrases("Let's dive in to this topic.");
      const formatted = formatPhraseCheckResult(result);

      expect(formatted).toContain('Banned phrases detected');
      expect(formatted).toContain("let's dive in");
    });
  });
});

describe('Structural Pattern Detector', () => {
  describe('checkStructuralPatterns', () => {
    it('returns clean result for good content', () => {
      const content = 'This is a well-written piece about software engineering.';
      const result = checkStructuralPatterns(content);

      expect(result.hasIssues).toBe(false);
      expect(result.detector).toBe('structural');
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('checkForExcessiveEmoji', () => {
    it('detects excessive emoji usage', () => {
      const content = '🚀🔥💯🎉 This is amazing content!';
      const result = checkForExcessiveEmoji(content, 3);

      expect(result).not.toBeNull();
      expect(result?.pattern).toBe('excessive_emoji');
      expect(result?.severity).toBe('medium');
      expect(result?.count).toBe(4);
    });

    it('allows reasonable emoji usage', () => {
      const content = 'Great tool 🚀 Check it out.';
      const result = checkForExcessiveEmoji(content, 3);

      expect(result).toBeNull();
    });

    it('respects custom threshold', () => {
      const content = '🚀🔥 Two emojis here.';
      const resultDefault = checkForExcessiveEmoji(content, 3);
      const resultStrict = checkForExcessiveEmoji(content, 1);

      expect(resultDefault).toBeNull();
      expect(resultStrict).not.toBeNull();
    });
  });

  describe('checkForListicleFormat', () => {
    it('detects numbered list format', () => {
      const content = '1. First point\n2. Second point\n3. Third point';
      const result = checkForListicleFormat(content);

      expect(result).not.toBeNull();
      expect(result?.pattern).toBe('listicle_format');
      expect(result?.severity).toBe('high');
    });

    it('detects parenthetical list format', () => {
      const content = '1) First thing\n2) Second thing';
      const result = checkForListicleFormat(content);

      expect(result).not.toBeNull();
    });

    it('allows inline numbers', () => {
      const content = 'There are 10 ways to improve this, but only 3 matter.';
      const result = checkForListicleFormat(content);

      expect(result).toBeNull();
    });
  });

  describe('checkForHashtags', () => {
    it('detects hashtags', () => {
      const content = 'Check out this tool #AItools #coding';
      const result = checkForHashtags(content);

      expect(result).not.toBeNull();
      expect(result?.pattern).toBe('hashtag');
      expect(result?.severity).toBe('high');
      expect(result?.matches).toContain('#AItools');
      expect(result?.matches).toContain('#coding');
    });

    it('allows content without hashtags', () => {
      const content = 'This is a great tool for developers.';
      const result = checkForHashtags(content);

      expect(result).toBeNull();
    });

    it('ignores hash symbols that are not tags', () => {
      // C# is a language name, #123 is an issue number - neither are hashtags
      // The regex /#[a-zA-Z][a-zA-Z0-9_]*/ requires a letter after #
      const content = 'The C# language is great. Also check issue #123.';
      const result = checkForHashtags(content);

      expect(result).toBeNull();
    });
  });

  describe('checkForAllCapsAbuse', () => {
    it('detects excessive all-caps words', () => {
      const content = 'This is AMAZING and INCREDIBLE and REVOLUTIONARY!';
      const result = checkForAllCapsAbuse(content, 2);

      expect(result).not.toBeNull();
      expect(result?.pattern).toBe('all_caps_abuse');
      expect(result?.count).toBe(3);
    });

    it('allows occasional emphasis', () => {
      const content = 'This is REALLY important.';
      const result = checkForAllCapsAbuse(content, 2);

      expect(result).toBeNull();
    });

    it('ignores short all-caps (acronyms)', () => {
      const content = 'The API and SDK are both RESTful.';
      const result = checkForAllCapsAbuse(content, 1);

      expect(result).toBeNull();
    });
  });

  describe('checkForExcessivePunctuation', () => {
    it('detects excessive punctuation', () => {
      const content = 'This is amazing!!! Can you believe it???';
      const result = checkForExcessivePunctuation(content);

      expect(result).not.toBeNull();
      expect(result?.pattern).toBe('excessive_punctuation');
      expect(result?.count).toBe(2);
    });

    it('allows normal punctuation', () => {
      const content = 'Is this good? Yes, it is! Absolutely.';
      const result = checkForExcessivePunctuation(content);

      expect(result).toBeNull();
    });
  });

  describe('checkForClickbaitOpening', () => {
    it('detects clickbait-style openings', () => {
      const clickbaits = [
        'So, here is what happened next.',
        'Look, this is important.',
        'Okay so I found something interesting.',
        "Here's the deal with this approach.",
        'Wait, this changes everything.',
        'OMG you need to see this!',
        "I can't believe this worked.",
      ];

      for (const content of clickbaits) {
        const result = checkForClickbaitOpening(content);
        expect(result).not.toBeNull();
        expect(result?.pattern).toBe('clickbait_opening');
      }
    });

    it('allows direct openings', () => {
      const content = 'Building a REST API in Node.js requires understanding a few concepts.';
      const result = checkForClickbaitOpening(content);

      expect(result).toBeNull();
    });
  });

  describe('checkForFillerPhrases', () => {
    it('detects filler word abuse', () => {
      const content =
        'Basically, this is essentially the same thing. Actually, it literally works the same way.';
      const result = checkForFillerPhrases(content, 2);

      expect(result).not.toBeNull();
      expect(result?.pattern).toBe('filler_phrases');
      expect(result?.count).toBeGreaterThanOrEqual(3);
    });

    it('allows occasional filler words', () => {
      const content = 'Actually, this approach works better.';
      const result = checkForFillerPhrases(content, 2);

      expect(result).toBeNull();
    });
  });

  describe('checkForFormulaicStructure', () => {
    it('detects formulaic parallel structures', () => {
      const content = '🚀 First point here.\n🔥 Second point here.\n💡 Third point here.';
      const result = checkForFormulaicStructure(content);

      expect(result).not.toBeNull();
      expect(result?.pattern).toBe('formulaic_structure');
    });

    it('allows varied sentence structures', () => {
      const content =
        'Here is one idea. Another approach would be different. Finally, consider this.';
      const result = checkForFormulaicStructure(content);

      expect(result).toBeNull();
    });
  });

  describe('hasHighSeverityIssue', () => {
    it('returns true when high severity issue exists', () => {
      const content = '#hashtags are never allowed';
      const result = checkStructuralPatterns(content);

      expect(hasHighSeverityIssue(result)).toBe(true);
    });

    it('returns false when only low/medium severity', () => {
      const content = '🚀🔥💯🎉 Lots of emojis but no high severity issues.';
      const result = checkStructuralPatterns(content);

      if (result.hasIssues) {
        const hasOnlyMediumOrLow = result.issues.every((i) => i.severity !== 'high');
        if (hasOnlyMediumOrLow) {
          expect(hasHighSeverityIssue(result)).toBe(false);
        }
      }
    });
  });

  describe('getIssueSeverityScore', () => {
    it('calculates score based on severity weights', () => {
      const contentWithHashtag = '#testing hashtags';
      const result = checkStructuralPatterns(contentWithHashtag);

      const score = getIssueSeverityScore(result);
      expect(score).toBeGreaterThanOrEqual(30);
    });

    it('returns 0 for clean content', () => {
      const content = 'Clean content with no issues.';
      const result = checkStructuralPatterns(content);

      expect(getIssueSeverityScore(result)).toBe(0);
    });

    it('caps score at 100', () => {
      const content =
        '#tag1 #tag2 #tag3 #tag4 1. First\n2. Second\n3. Third 🚀🔥💯🎉 AMAZING!!! ???';
      const result = checkStructuralPatterns(content);

      expect(getIssueSeverityScore(result)).toBeLessThanOrEqual(100);
    });
  });

  describe('formatStructuralCheckResult', () => {
    it('formats clean result', () => {
      const result = checkStructuralPatterns('Clean content.');
      const formatted = formatStructuralCheckResult(result);

      expect(formatted).toBe('No structural issues detected.');
    });

    it('formats result with issues', () => {
      const result = checkStructuralPatterns('#hashtag detected');
      const formatted = formatStructuralCheckResult(result);

      expect(formatted).toContain('Structural issues detected');
      expect(formatted).toContain('HIGH');
      expect(formatted).toContain('hashtag');
    });
  });
});

describe('Integration: Multiple Detectors', () => {
  it('detects multiple types of slop in combined content', () => {
    const slopContent =
      "Let's dive in! #AI 🚀🔥💯🎉\n1. First amazing point\n2. Second incredible point\n3. Third mind-blowing point";

    const phraseResult = checkForBannedPhrases(slopContent);
    const structuralResult = checkStructuralPatterns(slopContent);

    expect(phraseResult.hasBannedPhrases).toBe(true);
    expect(structuralResult.hasIssues).toBe(true);
    expect(structuralResult.issues.some((i) => i.pattern === 'hashtag')).toBe(true);
    expect(structuralResult.issues.some((i) => i.pattern === 'listicle_format')).toBe(true);
  });

  it('passes clean professional content', () => {
    const cleanContent =
      'Built a CLI tool that reduces Docker image sizes by 60%. Uses multi-stage builds and Alpine base images. Works with any Dockerfile - just run `docker-slim build myapp` and watch the magic happen.';

    const phraseResult = checkForBannedPhrases(cleanContent);
    const structuralResult = checkStructuralPatterns(cleanContent);

    expect(phraseResult.hasBannedPhrases).toBe(false);
    expect(structuralResult.hasIssues).toBe(false);
  });
});
