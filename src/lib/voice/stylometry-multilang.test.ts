/**
 * Tests for non-English text handling in stylometric analysis.
 *
 * Verifies that:
 * 1. Non-English text doesn't break the analysis
 * 2. Non-English text returns lower confidence when compared to English baseline
 * 3. Language detection and function word matching work correctly
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  sentenceLengthDistribution,
  punctuationFingerprint,
  vocabularyRichness,
  functionWordDistribution,
  syntacticComplexity,
  analyzeStylometry,
} from './stylometry';
import {
  generateSignature,
  compareSignatures,
  compareSignaturesDetailed,
  StyleSignature,
  clearSignatureCache,
} from './signature';
import { detectLanguage, isLikelyEnglish } from './language-detection';

const ENGLISH_SAMPLE = `
The quick brown fox jumps over the lazy dog. This is a simple sentence that demonstrates
English writing patterns. We use common function words like the, and, but, of, and to.
Technology is changing how we communicate. The tools we build shape our thinking.
What makes a great product? It starts with understanding the problem deeply.
`;

const GERMAN_SAMPLE = `
Der schnelle braune Fuchs springt über den faulen Hund. Dies ist ein einfacher Satz,
der deutsche Schreibmuster zeigt. Wir verwenden häufige Funktionswörter wie der, die,
das, und, aber, von und zu. Die Technologie verändert unsere Kommunikation.
Die Werkzeuge, die wir bauen, formen unser Denken.
`;

const SPANISH_SAMPLE = `
El rápido zorro marrón salta sobre el perro perezoso. Esta es una oración simple que
demuestra patrones de escritura en español. Usamos palabras funcionales comunes como
el, la, de, y, pero, en y que. La tecnología está cambiando nuestra comunicación.
Las herramientas que construimos dan forma a nuestro pensamiento.
`;

const FRENCH_SAMPLE = `
Le renard brun rapide saute par-dessus le chien paresseux. C'est une phrase simple qui
démontre les modèles d'écriture française. Nous utilisons des mots fonctionnels courants
comme le, la, de, et, mais, pour et que. La technologie change notre communication.
Les outils que nous construisons façonnent notre pensée.
`;

const JAPANESE_SAMPLE = `
速い茶色の狐が怠惰な犬を飛び越えます。これは日本語の文章パターンを示す簡単な文です。
テクノロジーは私たちのコミュニケーションを変えています。
私たちが作るツールは私たちの思考を形作ります。
`;

const CHINESE_SAMPLE = `
快速的棕色狐狸跳过懒狗。这是一个展示中文写作模式的简单句子。
技术正在改变我们的沟通方式。我们建造的工具塑造了我们的思维。
`;

const MIXED_SAMPLE = `
This is an English sentence. Das ist ein deutscher Satz. Esta es una oración en español.
The technology landscape is evolving rapidly. Die Technologie entwickelt sich schnell.
We build tools that shape how people think and work together.
`;

describe('Language Detection', () => {
  it('detects English text correctly', () => {
    const result = detectLanguage(ENGLISH_SAMPLE);
    expect(result.language).toBe('en');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('detects German text correctly', () => {
    const result = detectLanguage(GERMAN_SAMPLE);
    expect(result.language).toBe('de');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('detects Spanish text correctly', () => {
    const result = detectLanguage(SPANISH_SAMPLE);
    expect(result.language).toBe('es');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('detects French text correctly', () => {
    const result = detectLanguage(FRENCH_SAMPLE);
    expect(result.language).toBe('fr');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('returns unknown for very short text', () => {
    const result = detectLanguage('Hi');
    expect(result.language).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('isLikelyEnglish returns true for English text', () => {
    expect(isLikelyEnglish(ENGLISH_SAMPLE)).toBe(true);
  });

  it('isLikelyEnglish returns false for German text', () => {
    expect(isLikelyEnglish(GERMAN_SAMPLE)).toBe(false);
  });
});

describe('Stylometry Analysis - Non-English Text Does Not Break', () => {
  beforeEach(() => {
    clearSignatureCache();
  });

  describe('sentenceLengthDistribution', () => {
    it('processes English text', () => {
      const result = sentenceLengthDistribution(ENGLISH_SAMPLE);
      expect(result.count).toBeGreaterThan(0);
      expect(result.mean).toBeGreaterThan(0);
      expect(typeof result.stdDev).toBe('number');
    });

    it('processes German text without breaking', () => {
      const result = sentenceLengthDistribution(GERMAN_SAMPLE);
      expect(result.count).toBeGreaterThan(0);
      expect(result.mean).toBeGreaterThan(0);
      expect(typeof result.stdDev).toBe('number');
    });

    it('processes Spanish text without breaking', () => {
      const result = sentenceLengthDistribution(SPANISH_SAMPLE);
      expect(result.count).toBeGreaterThan(0);
      expect(result.mean).toBeGreaterThan(0);
    });

    it('processes Japanese text without breaking', () => {
      const result = sentenceLengthDistribution(JAPANESE_SAMPLE);
      expect(typeof result.mean).toBe('number');
      expect(typeof result.count).toBe('number');
    });

    it('processes Chinese text without breaking', () => {
      const result = sentenceLengthDistribution(CHINESE_SAMPLE);
      expect(typeof result.mean).toBe('number');
      expect(typeof result.count).toBe('number');
    });

    it('returns zeros for empty text', () => {
      const result = sentenceLengthDistribution('');
      expect(result.count).toBe(0);
      expect(result.mean).toBe(0);
    });
  });

  describe('punctuationFingerprint', () => {
    it('processes all languages without breaking', () => {
      const samples = [
        ENGLISH_SAMPLE,
        GERMAN_SAMPLE,
        SPANISH_SAMPLE,
        FRENCH_SAMPLE,
        JAPANESE_SAMPLE,
        CHINESE_SAMPLE,
      ];

      for (const sample of samples) {
        const result = punctuationFingerprint(sample);
        expect(typeof result.period).toBe('number');
        expect(typeof result.comma).toBe('number');
        expect(typeof result.total).toBe('number');
        expect(result.period).toBeGreaterThanOrEqual(0);
        expect(result.comma).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('vocabularyRichness', () => {
    it('processes English text', () => {
      const result = vocabularyRichness(ENGLISH_SAMPLE);
      expect(result.totalWords).toBeGreaterThan(0);
      expect(result.typeTokenRatio).toBeGreaterThan(0);
      expect(result.typeTokenRatio).toBeLessThanOrEqual(1);
    });

    it('processes German text without breaking', () => {
      const result = vocabularyRichness(GERMAN_SAMPLE);
      expect(result.totalWords).toBeGreaterThan(0);
      expect(result.typeTokenRatio).toBeGreaterThan(0);
    });

    it('processes Spanish text without breaking', () => {
      const result = vocabularyRichness(SPANISH_SAMPLE);
      expect(result.totalWords).toBeGreaterThan(0);
      expect(result.typeTokenRatio).toBeGreaterThan(0);
    });

    it('returns zeros for text with no Latin words', () => {
      const result = vocabularyRichness(JAPANESE_SAMPLE);
      expect(typeof result.totalWords).toBe('number');
      expect(typeof result.typeTokenRatio).toBe('number');
    });
  });

  describe('functionWordDistribution', () => {
    it('uses English function words for English text', () => {
      const result = functionWordDistribution(ENGLISH_SAMPLE, 'en');
      expect(result.language).toBe('en');
      expect(result.frequencies.the).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
    });

    it('uses German function words for German text', () => {
      const result = functionWordDistribution(GERMAN_SAMPLE, 'de');
      expect(result.language).toBe('de');
      expect(result.total).toBeGreaterThan(0);
    });

    it('uses Spanish function words for Spanish text', () => {
      const result = functionWordDistribution(SPANISH_SAMPLE, 'es');
      expect(result.language).toBe('es');
      expect(result.total).toBeGreaterThan(0);
    });

    it('auto-detects language when set to auto', () => {
      const germanResult = functionWordDistribution(GERMAN_SAMPLE, 'auto');
      expect(germanResult.language).toBe('de');

      const spanishResult = functionWordDistribution(SPANISH_SAMPLE, 'auto');
      expect(spanishResult.language).toBe('es');
    });

    it('falls back to English for unsupported languages', () => {
      const result = functionWordDistribution(JAPANESE_SAMPLE, 'auto');
      expect(result.language).toBe('en');
    });
  });

  describe('syntacticComplexity', () => {
    it('processes all supported languages', () => {
      const samples = [
        { text: ENGLISH_SAMPLE, lang: 'en' as const },
        { text: GERMAN_SAMPLE, lang: 'de' as const },
        { text: SPANISH_SAMPLE, lang: 'es' as const },
      ];

      for (const { text, lang } of samples) {
        const result = syntacticComplexity(text, lang);
        expect(typeof result.avgClauseDepth).toBe('number');
        expect(typeof result.avgWordsPerClause).toBe('number');
        expect(typeof result.subordinateClauseRatio).toBe('number');
        expect(result.avgClauseDepth).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles Japanese text without throwing', () => {
      expect(() => syntacticComplexity(JAPANESE_SAMPLE, 'auto')).not.toThrow();
    });
  });

  describe('analyzeStylometry (full analysis)', () => {
    it('completes analysis for all sample texts', () => {
      const samples = [
        ENGLISH_SAMPLE,
        GERMAN_SAMPLE,
        SPANISH_SAMPLE,
        FRENCH_SAMPLE,
        JAPANESE_SAMPLE,
        CHINESE_SAMPLE,
        MIXED_SAMPLE,
      ];

      for (const sample of samples) {
        const result = analyzeStylometry(sample);
        expect(result.sentenceLength).toBeDefined();
        expect(result.punctuation).toBeDefined();
        expect(result.vocabulary).toBeDefined();
        expect(result.functionWords).toBeDefined();
        expect(result.syntactic).toBeDefined();
      }
    });
  });
});

describe('Signature Generation - Non-English Text', () => {
  beforeEach(() => {
    clearSignatureCache();
  });

  it('generates valid signature for English text', () => {
    const signature = generateSignature(ENGLISH_SAMPLE);
    expect(signature.sentenceLength.mean).toBeGreaterThan(0);
    expect(signature.vocabulary.typeTokenRatio).toBeGreaterThan(0);
    expect(signature.functionWords.the).toBeGreaterThan(0);
  });

  it('generates valid signature for German text without breaking', () => {
    const signature = generateSignature(GERMAN_SAMPLE);
    expect(signature.sentenceLength).toBeDefined();
    expect(signature.punctuation).toBeDefined();
    expect(signature.vocabulary).toBeDefined();
    expect(signature.functionWords).toBeDefined();
    expect(signature.syntactic).toBeDefined();
  });

  it('generates valid signature for Spanish text without breaking', () => {
    const signature = generateSignature(SPANISH_SAMPLE);
    expect(signature).toBeDefined();
    expect(typeof signature.sentenceLength.mean).toBe('number');
  });

  it('generates valid signature for Japanese text without breaking', () => {
    const signature = generateSignature(JAPANESE_SAMPLE);
    expect(signature).toBeDefined();
  });

  it('generates valid signature for mixed language text', () => {
    const signature = generateSignature(MIXED_SAMPLE);
    expect(signature).toBeDefined();
    expect(signature.sentenceLength.mean).toBeGreaterThan(0);
  });
});

describe('Non-English Text Returns Lower Confidence', () => {
  let englishBaseline: StyleSignature;

  beforeEach(() => {
    clearSignatureCache();
    englishBaseline = generateSignature(ENGLISH_SAMPLE);
  });

  it('English text compared to English baseline has high similarity', () => {
    const anotherEnglish = `
      The technology industry continues to evolve rapidly. We see new tools and frameworks
      emerging every day. The best products solve real problems that people have.
      Understanding the user is key to building something meaningful.
    `;
    const anotherSignature = generateSignature(anotherEnglish);
    const similarity = compareSignatures(anotherSignature, englishBaseline);

    expect(similarity).toBeGreaterThan(0.5);
  });

  it('German text compared to English baseline has lower functionWords score', () => {
    const germanSignature = generateSignature(GERMAN_SAMPLE);
    const comparison = compareSignaturesDetailed(germanSignature, englishBaseline);

    expect(comparison.dimensionScores.functionWords).toBeLessThan(0.5);
  });

  it('Spanish text compared to English baseline has lower functionWords score', () => {
    const spanishSignature = generateSignature(SPANISH_SAMPLE);
    const comparison = compareSignaturesDetailed(spanishSignature, englishBaseline);

    expect(comparison.dimensionScores.functionWords).toBeLessThan(0.5);
  });

  it('Japanese text compared to English baseline has very low functionWords score', () => {
    const japaneseSignature = generateSignature(JAPANESE_SAMPLE);
    const comparison = compareSignaturesDetailed(japaneseSignature, englishBaseline);

    expect(comparison.dimensionScores.functionWords).toBeLessThan(0.3);
  });

  it('non-English text overall similarity to English baseline is lower', () => {
    const germanSignature = generateSignature(GERMAN_SAMPLE);
    const spanishSignature = generateSignature(SPANISH_SAMPLE);

    const germanSimilarity = compareSignatures(germanSignature, englishBaseline);
    const spanishSimilarity = compareSignatures(spanishSignature, englishBaseline);

    const anotherEnglish = `
      Building great software requires patience and understanding. The tools we create
      shape how people work and think. Technology is a powerful force for change.
    `;
    const englishSimilarity = compareSignatures(generateSignature(anotherEnglish), englishBaseline);

    expect(englishSimilarity).toBeGreaterThan(germanSimilarity);
    expect(englishSimilarity).toBeGreaterThan(spanishSimilarity);
  });

  it('provides feedback array for comparison results', () => {
    const germanSignature = generateSignature(GERMAN_SAMPLE);
    const comparison = compareSignaturesDetailed(germanSignature, englishBaseline);

    expect(Array.isArray(comparison.feedback)).toBe(true);
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    clearSignatureCache();
  });

  it('handles empty string', () => {
    const signature = generateSignature('');
    expect(signature).toBeDefined();
    expect(signature.sentenceLength.mean).toBe(0);
    expect(signature.vocabulary.typeTokenRatio).toBe(0);
  });

  it('handles single word', () => {
    const signature = generateSignature('Hello');
    expect(signature).toBeDefined();
  });

  it('handles text with only punctuation', () => {
    const signature = generateSignature('... !!! ???');
    expect(signature).toBeDefined();
    expect(signature.punctuation.ellipsisRate).toBeGreaterThan(0);
  });

  it('handles text with emoji', () => {
    const text = 'This is great! 🎉 We made it work! 🚀 Technology is amazing! ✨';
    const signature = generateSignature(text);
    expect(signature).toBeDefined();
    expect(signature.sentenceLength.mean).toBeGreaterThan(0);
  });

  it('handles text with URLs', () => {
    const text =
      'Check out https://example.com for more information. The website has great resources.';
    const signature = generateSignature(text);
    expect(signature).toBeDefined();
  });

  it('handles text with numbers and special characters', () => {
    const text =
      'In 2024, we saw a 50% increase in productivity. The ROI was $1.5M. Contact us at info@example.com.';
    const signature = generateSignature(text);
    expect(signature).toBeDefined();
    expect(signature.sentenceLength.mean).toBeGreaterThan(0);
  });

  it('handles very long text', () => {
    const longText = ENGLISH_SAMPLE.repeat(10);
    const signature = generateSignature(longText);
    expect(signature).toBeDefined();
    expect(signature.sentenceLength.mean).toBeGreaterThan(5);
  });

  it('handles text with RTL characters (Arabic)', () => {
    const arabicText = 'هذا نص عربي بسيط. يستخدم لاختبار التوافق. شكرا لك.';
    expect(() => generateSignature(arabicText)).not.toThrow();
  });

  it('handles text with Cyrillic characters (Russian)', () => {
    const russianText =
      'Это простой русский текст. Он используется для тестирования совместимости. Спасибо.';
    expect(() => generateSignature(russianText)).not.toThrow();
  });

  it('handles text with Korean characters', () => {
    const koreanText = '이것은 간단한 한국어 텍스트입니다. 호환성 테스트에 사용됩니다. 감사합니다.';
    expect(() => generateSignature(koreanText)).not.toThrow();
  });
});

describe('Signature Caching with Non-English Text', () => {
  beforeEach(() => {
    clearSignatureCache();
  });

  it('caches signatures for non-English text', () => {
    const sig1 = generateSignature(GERMAN_SAMPLE);
    const sig2 = generateSignature(GERMAN_SAMPLE);

    expect(sig1).toEqual(sig2);
  });

  it('skipCache option works for non-English text', () => {
    const sig1 = generateSignature(GERMAN_SAMPLE);
    const sig2 = generateSignature(GERMAN_SAMPLE, { skipCache: true });

    expect(sig1.sentenceLength.mean).toBe(sig2.sentenceLength.mean);
  });
});
