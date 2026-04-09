/**
 * English function words for stylometric analysis.
 * Based on Burrows' Delta methodology for authorship attribution.
 *
 * Function words are high-frequency grammatical words that carry
 * structural meaning rather than content meaning. Their usage patterns
 * are highly individual and difficult to consciously control.
 */

export const ENGLISH_FUNCTION_WORDS = [
  // Articles
  'the',
  'a',
  'an',

  // Conjunctions
  'and',
  'but',
  'or',
  'nor',
  'yet',
  'so',
  'for',

  // Prepositions
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'into',
  'about',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'under',
  'against',
  'without',

  // Pronouns
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'its',
  'our',
  'their',
  'mine',
  'yours',
  'hers',
  'ours',
  'theirs',
  'this',
  'that',
  'these',
  'those',
  'who',
  'whom',
  'whose',
  'which',
  'what',

  // Auxiliary verbs
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'can',
  'could',

  // Adverbs
  'not',
  'as',
  'just',
  'also',
  'only',
  'then',
  'now',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'very',
  'too',
  'more',
  'most',
  'some',
  'any',
  'no',
  'all',
  'both',
  'each',
  'few',
  'many',
  'much',
  'other',
  'such',

  // Other function words
  'if',
  'than',
  'because',
  'while',
  'although',
  'though',
  'unless',
  'until',
  'since',
  'whether',
] as const;

export type EnglishFunctionWord = (typeof ENGLISH_FUNCTION_WORDS)[number];

export const ENGLISH_LANGUAGE_CODE = 'en';

export interface EnglishFunctionWordConfig {
  languageCode: typeof ENGLISH_LANGUAGE_CODE;
  functionWords: readonly string[];
  subordinateMarkers: readonly string[];
}

export const ENGLISH_SUBORDINATE_MARKERS = [
  'although',
  'because',
  'since',
  'unless',
  'whereas',
  'while',
  'when',
  'where',
  'if',
  'that',
  'which',
  'who',
  'whom',
  'whose',
  'after',
  'before',
  'until',
  'whenever',
  'wherever',
] as const;

export const englishConfig: EnglishFunctionWordConfig = {
  languageCode: ENGLISH_LANGUAGE_CODE,
  functionWords: ENGLISH_FUNCTION_WORDS,
  subordinateMarkers: ENGLISH_SUBORDINATE_MARKERS,
};
