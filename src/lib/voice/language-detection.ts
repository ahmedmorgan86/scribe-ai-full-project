/**
 * Simple heuristic-based language detection for stylometric analysis.
 * Uses character patterns, function words, and stopwords to identify language.
 * Supports: English, German, Spanish, French, Italian, Portuguese, Dutch
 */

export type SupportedLanguage = 'en' | 'de' | 'es' | 'fr' | 'it' | 'pt' | 'nl' | 'unknown';

export interface LanguageDetectionResult {
  language: SupportedLanguage;
  confidence: number;
  scores: Record<SupportedLanguage, number>;
}

const LANGUAGE_STOPWORDS: Record<Exclude<SupportedLanguage, 'unknown'>, string[]> = {
  en: [
    'the',
    'be',
    'to',
    'of',
    'and',
    'a',
    'in',
    'that',
    'have',
    'i',
    'it',
    'for',
    'not',
    'on',
    'with',
    'he',
    'as',
    'you',
    'do',
    'at',
    'this',
    'but',
    'his',
    'by',
    'from',
    'they',
    'we',
    'say',
    'her',
    'she',
    'or',
    'an',
    'will',
    'my',
    'one',
    'all',
    'would',
    'there',
    'their',
    'what',
  ],
  de: [
    'der',
    'die',
    'und',
    'in',
    'den',
    'von',
    'zu',
    'das',
    'mit',
    'sich',
    'des',
    'auf',
    'für',
    'ist',
    'im',
    'dem',
    'nicht',
    'ein',
    'eine',
    'als',
    'auch',
    'es',
    'an',
    'werden',
    'aus',
    'er',
    'hat',
    'dass',
    'sie',
    'nach',
    'wird',
    'bei',
    'einer',
    'um',
    'am',
    'sind',
    'noch',
    'wie',
    'einem',
    'über',
  ],
  es: [
    'de',
    'la',
    'que',
    'el',
    'en',
    'y',
    'a',
    'los',
    'del',
    'se',
    'las',
    'por',
    'un',
    'para',
    'con',
    'no',
    'una',
    'su',
    'al',
    'lo',
    'como',
    'más',
    'pero',
    'sus',
    'le',
    'ya',
    'o',
    'este',
    'sí',
    'porque',
    'esta',
    'entre',
    'cuando',
    'muy',
    'sin',
    'sobre',
    'también',
    'me',
    'hasta',
    'hay',
  ],
  fr: [
    'de',
    'la',
    'le',
    'et',
    'les',
    'des',
    'en',
    'un',
    'du',
    'une',
    'que',
    'est',
    'pour',
    'qui',
    'dans',
    'ce',
    'il',
    'pas',
    'plus',
    'par',
    'sur',
    'se',
    'au',
    'avec',
    'sont',
    'son',
    'elle',
    'ont',
    'mais',
    'comme',
    'ou',
    'leur',
    'nous',
    'cette',
    'aux',
    'tout',
    'ces',
    'deux',
    'été',
    'aussi',
  ],
  it: [
    'di',
    'che',
    'e',
    'la',
    'il',
    'un',
    'a',
    'per',
    'in',
    'una',
    'non',
    'sono',
    'da',
    'del',
    'si',
    'le',
    'con',
    'i',
    'della',
    'dei',
    'ha',
    'anche',
    'come',
    'ma',
    'più',
    'lo',
    'questo',
    'gli',
    'ne',
    'su',
    'alla',
    'al',
    'se',
    'dalle',
    'cui',
    'era',
    'nella',
    'tutti',
    'essere',
    'stato',
  ],
  pt: [
    'de',
    'a',
    'o',
    'que',
    'e',
    'do',
    'da',
    'em',
    'um',
    'para',
    'é',
    'com',
    'não',
    'uma',
    'os',
    'no',
    'se',
    'na',
    'por',
    'mais',
    'as',
    'dos',
    'como',
    'mas',
    'foi',
    'ao',
    'ele',
    'das',
    'tem',
    'à',
    'seu',
    'sua',
    'ou',
    'ser',
    'quando',
    'muito',
    'há',
    'nos',
    'já',
    'está',
  ],
  nl: [
    'de',
    'van',
    'een',
    'het',
    'en',
    'in',
    'is',
    'dat',
    'op',
    'te',
    'zijn',
    'voor',
    'met',
    'niet',
    'die',
    'aan',
    'er',
    'maar',
    'om',
    'ook',
    'als',
    'bij',
    'of',
    'naar',
    'dan',
    'nog',
    'wel',
    'geen',
    'worden',
    'door',
    'over',
    'tot',
    'uit',
    'heeft',
    'meer',
    'wat',
    'werd',
    'kan',
    'hun',
    'al',
  ],
};

const LANGUAGE_UNIQUE_PATTERNS: Record<Exclude<SupportedLanguage, 'unknown'>, RegExp[]> = {
  en: [/\bthe\b/gi, /\band\b/gi, /\bwith\b/gi, /\bthat\b/gi, /\bhave\b/gi],
  de: [/ß/g, /\bund\b/gi, /\bder\b/gi, /\bdie\b/gi, /\bdas\b/gi, /ü|ö|ä/gi],
  es: [/ñ/g, /¿/g, /¡/g, /\bque\b/gi, /\bdel\b/gi, /\bpara\b/gi],
  fr: [/ç/g, /œ/g, /\bqu'/gi, /\bl'/gi, /\bd'/gi, /\best\b/gi, /\bpour\b/gi],
  it: [/\bche\b/gi, /\bdella\b/gi, /\bdei\b/gi, /\bperché\b/gi, /\bnon\b/gi],
  pt: [/ã|õ/g, /ç/g, /\bque\b/gi, /\bnão\b/gi, /\bpara\b/gi, /\buma\b/gi],
  nl: [/ij/gi, /\bhet\b/gi, /\been\b/gi, /\bvan\b/gi, /\bworden\b/gi],
};

const LANGUAGE_CHAR_FREQUENCIES: Record<Exclude<SupportedLanguage, 'unknown'>, string> = {
  en: 'etaoinshrdlcumwfgypbvkjxqz',
  de: 'enisratdhulcgmobwfkzpvjyxq',
  es: 'eaosrnidltcumpbgyqhfvjzxwk',
  fr: 'esaitnrulodcmpévqfbghjàxèyêzç',
  it: 'eaionlrtscdupmvghfbqzàòùèìé',
  pt: 'aeosrindmutclphvgqbfzjxywk',
  nl: 'enatirodslghvkmubpwjczfxy',
};

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function extractWords(text: string): string[] {
  const normalized = normalizeText(text);
  const matches = normalized.match(/\b[\p{L}']+\b/gu);
  return matches ?? [];
}

function countStopwordMatches(words: string[], stopwords: string[]): number {
  const stopwordSet = new Set(stopwords.map((w) => w.toLowerCase()));
  let count = 0;
  for (const word of words) {
    if (stopwordSet.has(word.toLowerCase())) {
      count++;
    }
  }
  return count;
}

function countPatternMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function getCharacterFrequencyScore(text: string, expectedFreq: string): number {
  const normalized = normalizeText(text).replace(/[^a-zàáâãäåæçèéêëìíîïñòóôõöùúûüýÿœß]/gi, '');
  if (normalized.length === 0) return 0;

  const charCounts = new Map<string, number>();
  for (const char of normalized) {
    charCounts.set(char, (charCounts.get(char) ?? 0) + 1);
  }

  const sortedChars = [...charCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([char]) => char)
    .slice(0, 10)
    .join('');

  let matchScore = 0;
  for (let i = 0; i < sortedChars.length; i++) {
    const char = sortedChars[i];
    const expectedIndex = expectedFreq.indexOf(char);
    if (expectedIndex !== -1) {
      matchScore += Math.max(0, 10 - Math.abs(i - expectedIndex));
    }
  }

  return matchScore / 100;
}

/**
 * Detects the language of the given text using heuristics.
 * Returns language code, confidence (0-1), and scores for each language.
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  const words = extractWords(text);
  const wordCount = words.length;

  if (wordCount < 3) {
    return {
      language: 'unknown',
      confidence: 0,
      scores: { en: 0, de: 0, es: 0, fr: 0, it: 0, pt: 0, nl: 0, unknown: 1 },
    };
  }

  const scores: Record<SupportedLanguage, number> = {
    en: 0,
    de: 0,
    es: 0,
    fr: 0,
    it: 0,
    pt: 0,
    nl: 0,
    unknown: 0,
  };

  const languages: Exclude<SupportedLanguage, 'unknown'>[] = [
    'en',
    'de',
    'es',
    'fr',
    'it',
    'pt',
    'nl',
  ];

  for (const lang of languages) {
    const stopwordScore = countStopwordMatches(words, LANGUAGE_STOPWORDS[lang]) / wordCount;
    const patternScore = countPatternMatches(text, LANGUAGE_UNIQUE_PATTERNS[lang]) / wordCount;
    const charFreqScore = getCharacterFrequencyScore(text, LANGUAGE_CHAR_FREQUENCIES[lang]);

    scores[lang] = stopwordScore * 0.5 + patternScore * 0.3 + charFreqScore * 0.2;
  }

  let maxLang: SupportedLanguage = 'unknown';
  let maxScore = 0;

  for (const lang of languages) {
    if (scores[lang] > maxScore) {
      maxScore = scores[lang];
      maxLang = lang;
    }
  }

  const confidence = Math.min(1, maxScore * 5);

  if (confidence < 0.1) {
    return {
      language: 'unknown',
      confidence: 0,
      scores: { ...scores, unknown: 1 },
    };
  }

  return {
    language: maxLang,
    confidence: Math.round(confidence * 100) / 100,
    scores,
  };
}

/**
 * Quick check if text is likely English.
 * Optimized for the common case.
 */
export function isLikelyEnglish(text: string): boolean {
  const result = detectLanguage(text);
  return result.language === 'en' && result.confidence >= 0.3;
}

/**
 * Get the stopwords for a detected or specified language.
 */
export function getStopwordsForLanguage(language: SupportedLanguage): string[] {
  if (language === 'unknown') {
    return LANGUAGE_STOPWORDS.en;
  }
  return LANGUAGE_STOPWORDS[language];
}

/**
 * Get the full language name for display.
 */
export function getLanguageName(code: SupportedLanguage): string {
  const names: Record<SupportedLanguage, string> = {
    en: 'English',
    de: 'German',
    es: 'Spanish',
    fr: 'French',
    it: 'Italian',
    pt: 'Portuguese',
    nl: 'Dutch',
    unknown: 'Unknown',
  };
  return names[code];
}
