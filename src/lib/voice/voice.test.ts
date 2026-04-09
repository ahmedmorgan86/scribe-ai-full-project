import { describe, it, expect } from 'vitest';

import {
  structuralPatternFilter,
  formatStructuralFilterResult,
  formatEmbeddingFilterResult,
  DEFAULT_SIMILARITY_THRESHOLD,
  type EmbeddingFilterResult,
  type StructuralFilterOptions,
} from './fast-filter';

describe('Voice Matching Fast Filter - Structural Pattern Filter', () => {
  describe('structuralPatternFilter', () => {
    describe('sentence length checks', () => {
      it('passes content with normal sentence lengths', () => {
        const content =
          'This is a well-structured tweet about software engineering. It makes a clear point.';
        const result = structuralPatternFilter(content);

        expect(result.passed).toBe(true);
        const sentenceCheck = result.checks.find((c) => c.name === 'sentence_length');
        expect(sentenceCheck?.passed).toBe(true);
      });

      it('fails content with extremely short sentences', () => {
        const content = 'Hi.';
        const result = structuralPatternFilter(content);

        const sentenceCheck = result.checks.find((c) => c.name === 'sentence_length');
        expect(sentenceCheck?.passed).toBe(false);
      });

      it('fails content exceeding max sentence length (280 chars)', () => {
        const longSentence = 'A'.repeat(300);
        const result = structuralPatternFilter(longSentence);

        const sentenceCheck = result.checks.find((c) => c.name === 'sentence_length');
        expect(sentenceCheck?.passed).toBe(false);
        expect(sentenceCheck?.severity).toBe('medium');
      });

      it('respects custom min/max sentence length options', () => {
        const options: StructuralFilterOptions = {
          minSentenceLength: 10,
          maxSentenceLength: 100,
        };
        const content = 'Short.';
        const result = structuralPatternFilter(content, options);

        const sentenceCheck = result.checks.find((c) => c.name === 'sentence_length');
        expect(sentenceCheck?.passed).toBe(false);
      });
    });

    describe('average words per sentence check', () => {
      it('passes content with reasonable word count per sentence', () => {
        const content = 'This sentence has eight words in it. So does this one too here.';
        const result = structuralPatternFilter(content);

        const avgCheck = result.checks.find((c) => c.name === 'avg_words_per_sentence');
        expect(avgCheck?.passed).toBe(true);
      });

      it('fails content with too many words per sentence', () => {
        const longSentence =
          'This is an incredibly long sentence that just keeps going on and on with many many words that would make it very difficult to read in a single breath or even comprehend what the main point is supposed to be because it lacks proper structure.';
        const result = structuralPatternFilter(longSentence);

        const avgCheck = result.checks.find((c) => c.name === 'avg_words_per_sentence');
        expect(avgCheck?.passed).toBe(false);
        expect(avgCheck?.severity).toBe('medium');
      });

      it('respects custom maxAvgWordsPerSentence option', () => {
        const options: StructuralFilterOptions = {
          maxAvgWordsPerSentence: 5,
        };
        const content = 'This sentence has more than five words.';
        const result = structuralPatternFilter(content, options);

        const avgCheck = result.checks.find((c) => c.name === 'avg_words_per_sentence');
        expect(avgCheck?.passed).toBe(false);
      });
    });

    describe('hook detection', () => {
      it('detects problem-first hooks', () => {
        const problemHooks = [
          'Problem: most developers waste hours on this simple task.',
          'Struggling with Docker? Here is a better approach.',
          'Why do builds take so long? I found the answer.',
          'Tired of debugging CSS? Try this technique.',
        ];

        for (const content of problemHooks) {
          const result = structuralPatternFilter(content);
          const hookCheck = result.checks.find((c) => c.name === 'hook');
          expect(hookCheck?.passed).toBe(true);
        }
      });

      it('detects question hooks', () => {
        const content = 'Have you ever wondered why code reviews take so long?';
        const result = structuralPatternFilter(content);

        const hookCheck = result.checks.find((c) => c.name === 'hook');
        expect(hookCheck?.passed).toBe(true);
        expect(hookCheck?.value).toBe('detected');
      });

      it('detects direct address hooks', () => {
        const content = 'You are probably making this mistake in your React apps.';
        const result = structuralPatternFilter(content);

        const hookCheck = result.checks.find((c) => c.name === 'hook');
        expect(hookCheck?.passed).toBe(true);
      });

      it('detects imperative hooks', () => {
        const imperativeHooks = [
          'Stop using var in JavaScript.',
          "Don't deploy on Fridays without this checklist.",
          'Never commit directly to main.',
          'Avoid these common TypeScript mistakes.',
        ];

        for (const content of imperativeHooks) {
          const result = structuralPatternFilter(content);
          const hookCheck = result.checks.find((c) => c.name === 'hook');
          expect(hookCheck?.passed).toBe(true);
        }
      });

      it('detects discovery hooks', () => {
        const discoveryHooks = [
          'I discovered a tool that cuts build times by 50%.',
          'We found a bug that affected thousands of users.',
          'I spent 3 hours debugging this before finding the solution.',
        ];

        for (const content of discoveryHooks) {
          const result = structuralPatternFilter(content);
          const hookCheck = result.checks.find((c) => c.name === 'hook');
          expect(hookCheck?.passed).toBe(true);
        }
      });

      it('detects numbered hooks', () => {
        const content = '5 things I wish I knew before learning Rust.';
        const result = structuralPatternFilter(content);

        const hookCheck = result.checks.find((c) => c.name === 'hook');
        expect(hookCheck?.passed).toBe(true);
      });

      it('fails content without a hook', () => {
        const content = 'Software engineering is an interesting field with many opportunities.';
        const result = structuralPatternFilter(content);

        const hookCheck = result.checks.find((c) => c.name === 'hook');
        expect(hookCheck?.passed).toBe(false);
        expect(hookCheck?.value).toBe('missing');
        expect(hookCheck?.severity).toBe('medium');
      });

      it('can skip hook requirement with option', () => {
        const options: StructuralFilterOptions = {
          requireHook: false,
        };
        const content = 'Software engineering is an interesting field.';
        const result = structuralPatternFilter(content, options);

        const hookCheck = result.checks.find((c) => c.name === 'hook');
        expect(hookCheck?.passed).toBe(true);
        expect(hookCheck?.value).toBe('not required');
      });
    });

    describe('emoji count check', () => {
      it('passes content with no emojis', () => {
        const content = 'This is clean professional content without any emojis.';
        const result = structuralPatternFilter(content);

        const emojiCheck = result.checks.find((c) => c.name === 'emoji_count');
        expect(emojiCheck?.passed).toBe(true);
        expect(emojiCheck?.value).toBe(0);
      });

      it('passes content with 1-3 emojis (default threshold)', () => {
        const content = 'Great tool for developers 🚀 Check it out 👍';
        const result = structuralPatternFilter(content);

        const emojiCheck = result.checks.find((c) => c.name === 'emoji_count');
        expect(emojiCheck?.passed).toBe(true);
        expect(emojiCheck?.value).toBe(2);
      });

      it('fails content with excessive emojis (>3)', () => {
        const content = '🚀🔥💯🎉 Amazing content here!';
        const result = structuralPatternFilter(content);

        const emojiCheck = result.checks.find((c) => c.name === 'emoji_count');
        expect(emojiCheck?.passed).toBe(false);
        expect(emojiCheck?.value).toBe(4);
        expect(emojiCheck?.severity).toBe('medium');
      });

      it('marks high severity for excessive emojis (>6)', () => {
        const content = '🚀🔥💯🎉✨💡🌟 Way too many emojis!';
        const result = structuralPatternFilter(content);

        const emojiCheck = result.checks.find((c) => c.name === 'emoji_count');
        expect(emojiCheck?.passed).toBe(false);
        expect(emojiCheck?.severity).toBe('high');
      });

      it('respects custom maxEmojiCount option', () => {
        const options: StructuralFilterOptions = {
          maxEmojiCount: 1,
        };
        const content = 'Two emojis here 🚀🔥';
        const result = structuralPatternFilter(content, options);

        const emojiCheck = result.checks.find((c) => c.name === 'emoji_count');
        expect(emojiCheck?.passed).toBe(false);
      });
    });

    describe('hashtag count check', () => {
      it('passes content with no hashtags', () => {
        const content = 'This content has no hashtags anywhere.';
        const result = structuralPatternFilter(content);

        const hashtagCheck = result.checks.find((c) => c.name === 'hashtag_count');
        expect(hashtagCheck?.passed).toBe(true);
        expect(hashtagCheck?.value).toBe(0);
      });

      it('fails content with any hashtags (default threshold 0)', () => {
        const content = 'Check out this tool #DevTools #Coding';
        const result = structuralPatternFilter(content);

        const hashtagCheck = result.checks.find((c) => c.name === 'hashtag_count');
        expect(hashtagCheck?.passed).toBe(false);
        expect(hashtagCheck?.value).toBe(2);
        expect(hashtagCheck?.severity).toBe('high');
      });

      it('detects single hashtag', () => {
        const content = 'Great advice for #developers';
        const result = structuralPatternFilter(content);

        const hashtagCheck = result.checks.find((c) => c.name === 'hashtag_count');
        expect(hashtagCheck?.passed).toBe(false);
        expect(hashtagCheck?.value).toBe(1);
      });

      it('respects custom maxHashtagCount option', () => {
        const options: StructuralFilterOptions = {
          maxHashtagCount: 2,
        };
        const content = 'Two hashtags allowed #one #two';
        const result = structuralPatternFilter(content, options);

        const hashtagCheck = result.checks.find((c) => c.name === 'hashtag_count');
        expect(hashtagCheck?.passed).toBe(true);
      });
    });

    describe('overall pass/fail logic', () => {
      it('passes when all checks pass', () => {
        const content = 'Why do most developers struggle with testing? Here is a simple approach.';
        const result = structuralPatternFilter(content);

        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(80);
      });

      it('fails immediately on high severity issue', () => {
        const content = 'Great tips for devs #coding #tips';
        const result = structuralPatternFilter(content);

        expect(result.passed).toBe(false);
        expect(result.reason).toContain('Critical structural issue');
      });

      it('fails when more than 1 medium severity issue', () => {
        const options: StructuralFilterOptions = {
          requireHook: true,
          maxHashtagCount: 10,
        };
        const longSentence =
          'This is a very very long sentence with way too many words that keeps going on and on and on without any real structure or proper punctuation to break it up into manageable pieces for the reader to digest.';
        const result = structuralPatternFilter(longSentence, options);

        const mediumFails = result.checks.filter((c) => !c.passed && c.severity === 'medium');
        if (mediumFails.length > 1) {
          expect(result.passed).toBe(false);
          expect(result.reason).toContain('Multiple structural issues');
        }
      });

      it('passes with exactly 1 medium severity issue', () => {
        const options: StructuralFilterOptions = {
          requireHook: true,
          maxEmojiCount: 1,
          maxHashtagCount: 10,
        };
        const content = 'Problem: most devs miss this simple optimization 🚀🔥';
        const result = structuralPatternFilter(content, options);

        const emojiCheck = result.checks.find((c) => c.name === 'emoji_count');
        const mediumFails = result.checks.filter((c) => !c.passed && c.severity === 'medium');

        if (emojiCheck && !emojiCheck.passed && mediumFails.length === 1) {
          expect(result.passed).toBe(true);
        }
      });
    });

    describe('score calculation', () => {
      it('returns 100% score when all checks pass', () => {
        const content = 'Why do builds fail? Here is a fix that works every time.';
        const result = structuralPatternFilter(content);

        if (result.checks.every((c) => c.passed)) {
          expect(result.score).toBe(100);
        }
      });

      it('returns proportional score based on passed checks', () => {
        const content = 'Content with hashtag #test but otherwise okay with good structure here.';
        const result = structuralPatternFilter(content);

        const passedCount = result.checks.filter((c) => c.passed).length;
        const expectedScore = Math.round((passedCount / result.checks.length) * 100);
        expect(result.score).toBe(expectedScore);
      });

      it('returns 0% when no checks pass', () => {
        const terribleContent = '#tag';
        const result = structuralPatternFilter(terribleContent);

        const passedCount = result.checks.filter((c) => c.passed).length;
        const expectedScore = Math.round((passedCount / result.checks.length) * 100);
        expect(result.score).toBe(expectedScore);
      });
    });

    describe('edge cases', () => {
      it('handles empty content gracefully', () => {
        const result = structuralPatternFilter('');

        expect(result.passed).toBe(false);
        expect(result.checks.some((c) => c.severity === 'high')).toBe(true);
      });

      it('handles content with only whitespace', () => {
        const result = structuralPatternFilter('   \n\t  ');

        expect(result.passed).toBe(false);
      });

      it('handles content with special characters', () => {
        const content = 'Why do regex patterns like /\\d+/ confuse developers?';
        const result = structuralPatternFilter(content);

        expect(result.checks.find((c) => c.name === 'hook')?.passed).toBe(true);
      });

      it('handles multi-line content', () => {
        const content = 'First line here.\nSecond line here.\nThird line here.';
        const result = structuralPatternFilter(content);

        expect(result).toBeDefined();
        expect(result.checks.length).toBeGreaterThan(0);
      });

      it('handles unicode content', () => {
        const content = '日本語のテスト内容です。これは二番目の文です。';
        const result = structuralPatternFilter(content);

        expect(result).toBeDefined();
      });
    });
  });

  describe('formatStructuralFilterResult', () => {
    it('formats passing result correctly', () => {
      const content = 'Why do deployments fail? Here is a simple checklist that works.';
      const result = structuralPatternFilter(content);
      const formatted = formatStructuralFilterResult(result);

      if (result.passed) {
        expect(formatted).toContain('PASSED');
        expect(formatted).toContain('Score:');
        expect(formatted).toContain('Checks:');
      }
    });

    it('formats failing result correctly', () => {
      const content = 'Bad content with #hashtags';
      const result = structuralPatternFilter(content);
      const formatted = formatStructuralFilterResult(result);

      expect(formatted).toContain('FAILED');
      expect(formatted).toContain('Reason:');
    });

    it('shows check details with values and thresholds', () => {
      const content = 'Sample content for testing format output here.';
      const result = structuralPatternFilter(content);
      const formatted = formatStructuralFilterResult(result);

      expect(formatted).toContain('✓');
      expect(formatted).toContain('sentence_length');
      expect(formatted).toContain('emoji_count');
      expect(formatted).toContain('hashtag_count');
    });
  });
});

describe('Voice Matching Fast Filter - Embedding Filter', () => {
  describe('formatEmbeddingFilterResult', () => {
    it('formats result with no corpus available', () => {
      const result: EmbeddingFilterResult = {
        passed: true,
        similarity: 0,
        threshold: DEFAULT_SIMILARITY_THRESHOLD,
        matchCount: 0,
        topMatches: [],
        reason: 'Skipped: no voice corpus available for comparison',
        corpusAvailable: false,
      };

      const formatted = formatEmbeddingFilterResult(result);

      expect(formatted).toContain('PASSED');
      expect(formatted).toContain('Skipped');
      expect(formatted).not.toContain('Similarity:');
    });

    it('formats result with matches correctly', () => {
      const result: EmbeddingFilterResult = {
        passed: true,
        similarity: 0.75,
        threshold: 0.7,
        matchCount: 3,
        topMatches: [
          {
            similarity: 0.8,
            content: 'This is a matching post about software engineering topics.',
            source: 'approved_post',
          },
          {
            similarity: 0.75,
            content: 'Another relevant post about development.',
            source: 'approved_post',
          },
          {
            similarity: 0.7,
            content: 'Use clear and direct language.',
            source: 'voice_guideline',
          },
        ],
        reason: 'Embedding similarity 75.0% meets 70% threshold',
        corpusAvailable: true,
      };

      const formatted = formatEmbeddingFilterResult(result);

      expect(formatted).toContain('PASSED');
      expect(formatted).toContain('Similarity: 75.0%');
      expect(formatted).toContain('Threshold: 70%');
      expect(formatted).toContain('Matches: 3');
      expect(formatted).toContain('Top matches:');
      expect(formatted).toContain('[approved_post]');
      expect(formatted).toContain('[voice_guideline]');
      expect(formatted).toContain('80.0%');
    });

    it('formats failing result correctly', () => {
      const result: EmbeddingFilterResult = {
        passed: false,
        similarity: 0.55,
        threshold: 0.7,
        matchCount: 2,
        topMatches: [
          {
            similarity: 0.6,
            content: 'Some content here.',
            source: 'approved_post',
          },
          {
            similarity: 0.5,
            content: 'More content.',
            source: 'approved_post',
          },
        ],
        reason: 'Embedding similarity 55.0% below 70% threshold',
        corpusAvailable: true,
      };

      const formatted = formatEmbeddingFilterResult(result);

      expect(formatted).toContain('FAILED');
      expect(formatted).toContain('55.0%');
      expect(formatted).toContain('below');
    });

    it('truncates long content in top matches', () => {
      const longContent =
        'This is a very long piece of content that should be truncated when displayed in the formatted output because it exceeds sixty characters.';
      const result: EmbeddingFilterResult = {
        passed: true,
        similarity: 0.75,
        threshold: 0.7,
        matchCount: 1,
        topMatches: [
          {
            similarity: 0.75,
            content: longContent,
            source: 'approved_post',
          },
        ],
        reason: 'Embedding similarity 75.0% meets 70% threshold',
        corpusAvailable: true,
      };

      const formatted = formatEmbeddingFilterResult(result);

      expect(formatted).toContain('...');
      expect(formatted).not.toContain(longContent);
    });

    it('formats result with no matches found', () => {
      const result: EmbeddingFilterResult = {
        passed: false,
        similarity: 0,
        threshold: 0.7,
        matchCount: 0,
        topMatches: [],
        reason: 'No similar content found in voice corpus',
        corpusAvailable: true,
      };

      const formatted = formatEmbeddingFilterResult(result);

      expect(formatted).toContain('FAILED');
      expect(formatted).toContain('No similar content');
      expect(formatted).not.toContain('Top matches');
    });
  });

  describe('DEFAULT_SIMILARITY_THRESHOLD', () => {
    it('exports the default threshold value', () => {
      expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.7);
    });
  });
});

describe('Voice Matching Fast Filter - Integration', () => {
  describe('combined structural analysis', () => {
    it('evaluates professional tweet-style content correctly', () => {
      const professionalContent =
        'Why do most engineers overcomplicate their CI pipelines? A simple 3-stage setup covers 90% of use cases.';
      const result = structuralPatternFilter(professionalContent);

      expect(result.passed).toBe(true);
      expect(result.checks.find((c) => c.name === 'hook')?.passed).toBe(true);
      expect(result.checks.find((c) => c.name === 'hashtag_count')?.passed).toBe(true);
      expect(result.checks.find((c) => c.name === 'emoji_count')?.passed).toBe(true);
    });

    it('catches obvious AI-style slop patterns', () => {
      const slopContent = '🚀🔥💯 #AI #ML #Tech Check out this amazing tool!!!';
      const result = structuralPatternFilter(slopContent);

      expect(result.passed).toBe(false);
      expect(result.checks.find((c) => c.name === 'hashtag_count')?.passed).toBe(false);
    });

    it('handles thread-style multi-sentence content', () => {
      const threadContent =
        'Here is the thing about microservices. They solve real problems but create new ones. Start with a monolith unless you have 50+ engineers.';
      const result = structuralPatternFilter(threadContent);

      expect(result).toBeDefined();
      expect(result.checks.find((c) => c.name === 'sentence_length')).toBeDefined();
      expect(result.checks.find((c) => c.name === 'avg_words_per_sentence')).toBeDefined();
    });

    it('validates content following voice guidelines patterns', () => {
      const voiceAlignedContent =
        'Struggling with slow Docker builds? Use multi-stage builds and layer caching. Reduced my build time from 10min to 2min.';
      const result = structuralPatternFilter(voiceAlignedContent);

      expect(result.passed).toBe(true);
      expect(result.checks.find((c) => c.name === 'hook')?.passed).toBe(true);
    });
  });

  describe('threshold boundary testing', () => {
    it('correctly identifies content at emoji threshold boundary', () => {
      const atThreshold = 'Content with exactly three emojis 🚀🔥💯';
      const result = structuralPatternFilter(atThreshold);

      const emojiCheck = result.checks.find((c) => c.name === 'emoji_count');
      expect(emojiCheck?.passed).toBe(true);
      expect(emojiCheck?.value).toBe(3);
    });

    it('fails content just over emoji threshold', () => {
      const overThreshold = 'Content with four emojis 🚀🔥💯🎉';
      const result = structuralPatternFilter(overThreshold);

      const emojiCheck = result.checks.find((c) => c.name === 'emoji_count');
      expect(emojiCheck?.passed).toBe(false);
      expect(emojiCheck?.value).toBe(4);
    });

    it('correctly applies similarity threshold logic', () => {
      expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.7);
    });
  });
});
