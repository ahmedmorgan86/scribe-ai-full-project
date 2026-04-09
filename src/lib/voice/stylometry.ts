/**
 * Stylometric analysis for voice authenticity verification.
 * Quantifies writing style patterns: sentence structure, punctuation, vocabulary.
 */

import { STYLOMETRY_THRESHOLDS } from '@/lib/config/thresholds';
import { detectLanguage } from './language-detection';
import { getFunctionWordsForLanguage, getSubordinateMarkersForLanguage } from './languages';

export interface SentenceLengthStats {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
  distribution: number[]; // word counts per sentence
}

export interface PunctuationFingerprint {
  period: number;
  comma: number;
  exclamation: number;
  question: number;
  hyphen: number;
  emDash: number;
  ellipsis: number;
  semicolon: number;
  colon: number;
  total: number;
}

export interface VocabularyRichnessStats {
  typeTokenRatio: number; // unique words / total words
  hapaxLegomena: number; // words appearing exactly once
  hapaxRatio: number; // hapax / total unique words
  totalWords: number;
  uniqueWords: number;
}

export interface FunctionWordDistribution {
  /** Word frequencies keyed by word */
  frequencies: Record<string, number>;
  /** Total word count in the analyzed text */
  total: number;
  /** Language used for analysis */
  language: string;
}

export interface SyntacticComplexityStats {
  avgClauseDepth: number;
  avgWordsPerClause: number;
  subordinateClauseRatio: number;
}

const SENTENCE_TERMINATORS = /[.!?]+/g;
const WORD_PATTERN = /\b[a-zA-Z']+\b/g;

/** Type for stylometry language setting */
export type StylometryLanguage = 'en' | 'de' | 'es' | 'auto';

/**
 * Resolves the language to use for analysis.
 * If 'auto', detects from text and falls back to 'en'.
 */
function resolveLanguage(text: string, configLanguage: StylometryLanguage): string {
  if (configLanguage !== 'auto') {
    return configLanguage;
  }
  const detected = detectLanguage(text);
  // Fall back to English for unknown or unsupported languages
  if (detected.language === 'unknown' || !['en', 'de', 'es'].includes(detected.language)) {
    return 'en';
  }
  return detected.language;
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const sentences = normalized.split(SENTENCE_TERMINATORS).filter((s) => s.trim().length > 0);
  return sentences.map((s) => s.trim());
}

function extractWords(text: string): string[] {
  const matches = text.toLowerCase().match(WORD_PATTERN);
  return matches ?? [];
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function calculateStdDev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Analyzes sentence length distribution.
 * Returns mean, std dev, min, max word counts.
 */
export function sentenceLengthDistribution(text: string): SentenceLengthStats {
  const sentences = splitIntoSentences(text);
  const wordCounts = sentences.map((s) => extractWords(s).length);

  if (wordCounts.length === 0) {
    return { mean: 0, stdDev: 0, min: 0, max: 0, count: 0, distribution: [] };
  }

  const mean = calculateMean(wordCounts);
  const stdDev = calculateStdDev(wordCounts, mean);
  const min = Math.min(...wordCounts);
  const max = Math.max(...wordCounts);

  return {
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    min,
    max,
    count: wordCounts.length,
    distribution: wordCounts,
  };
}

/**
 * Generates punctuation frequency fingerprint.
 * Tracks: . , ! ? - — ... ; :
 */
export function punctuationFingerprint(text: string): PunctuationFingerprint {
  const countOccurrences = (pattern: RegExp): number => {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  };

  const period = countOccurrences(/(?<!\.\.)\.(?!\.)/g); // single dots only
  const comma = countOccurrences(/,/g);
  const exclamation = countOccurrences(/!/g);
  const question = countOccurrences(/\?/g);
  const hyphen = countOccurrences(/(?<![—-])-(?![—-])/g); // single hyphens only
  const emDash = countOccurrences(/—|--/g);
  const ellipsis = countOccurrences(/\.{3}|…/g);
  const semicolon = countOccurrences(/;/g);
  const colon = countOccurrences(/:/g);

  const total =
    period + comma + exclamation + question + hyphen + emDash + ellipsis + semicolon + colon;

  return {
    period,
    comma,
    exclamation,
    question,
    hyphen,
    emDash,
    ellipsis,
    semicolon,
    colon,
    total,
  };
}

/**
 * Calculates vocabulary richness metrics.
 * Type-token ratio: unique words / total words
 * Hapax legomena: words appearing exactly once
 */
export function vocabularyRichness(text: string): VocabularyRichnessStats {
  const words = extractWords(text);
  const totalWords = words.length;

  if (totalWords === 0) {
    return {
      typeTokenRatio: 0,
      hapaxLegomena: 0,
      hapaxRatio: 0,
      totalWords: 0,
      uniqueWords: 0,
    };
  }

  const wordFrequency = new Map<string, number>();
  for (const word of words) {
    wordFrequency.set(word, (wordFrequency.get(word) ?? 0) + 1);
  }

  const uniqueWords = wordFrequency.size;
  let hapaxCount = 0;
  for (const count of wordFrequency.values()) {
    if (count === 1) hapaxCount++;
  }

  const typeTokenRatio = uniqueWords / totalWords;
  const hapaxRatio = uniqueWords > 0 ? hapaxCount / uniqueWords : 0;

  return {
    typeTokenRatio: Math.round(typeTokenRatio * 1000) / 1000,
    hapaxLegomena: hapaxCount,
    hapaxRatio: Math.round(hapaxRatio * 1000) / 1000,
    totalWords,
    uniqueWords,
  };
}

/**
 * Analyzes function word distribution (Burrows' Delta basis).
 * Tracks frequency of common function words as proportions.
 * Uses language-specific function word lists based on STYLOMETRY_LANGUAGE env var.
 *
 * @param text - The text to analyze
 * @param languageOverride - Optional language override. If not provided, uses STYLOMETRY_LANGUAGE env var.
 */
export function functionWordDistribution(
  text: string,
  languageOverride?: StylometryLanguage
): FunctionWordDistribution {
  const configLanguage = languageOverride ?? STYLOMETRY_THRESHOLDS.language;
  const language = resolveLanguage(text, configLanguage);
  const functionWords = getFunctionWordsForLanguage(language);

  const words = extractWords(text);
  const totalWords = words.length;

  const counts: Record<string, number> = {};
  for (const fw of functionWords) {
    counts[fw] = 0;
  }

  for (const word of words) {
    if (functionWords.includes(word)) {
      counts[word]++;
    }
  }

  const frequencies: Record<string, number> = {};
  for (const fw of functionWords) {
    if (totalWords === 0) {
      frequencies[fw] = 0;
    } else {
      frequencies[fw] = Math.round((counts[fw] / totalWords) * 10000) / 10000;
    }
  }

  return {
    frequencies,
    total: totalWords,
    language,
  };
}

/**
 * Estimates syntactic complexity without full NLP parsing.
 * Uses heuristics: clause markers, sentence structure.
 * Uses language-specific subordinate markers based on STYLOMETRY_LANGUAGE env var.
 *
 * @param text - The text to analyze
 * @param languageOverride - Optional language override. If not provided, uses STYLOMETRY_LANGUAGE env var.
 */
export function syntacticComplexity(
  text: string,
  languageOverride?: StylometryLanguage
): SyntacticComplexityStats {
  const configLanguage = languageOverride ?? STYLOMETRY_THRESHOLDS.language;
  const language = resolveLanguage(text, configLanguage);
  const subordinateMarkers = getSubordinateMarkersForLanguage(language);

  const sentences = splitIntoSentences(text);

  if (sentences.length === 0) {
    return { avgClauseDepth: 0, avgWordsPerClause: 0, subordinateClauseRatio: 0 };
  }

  let totalSubordinateClauses = 0;
  let totalClauses = 0;
  let totalWords = 0;

  for (const sentence of sentences) {
    const words = extractWords(sentence);
    const wordCount = words.length;
    totalWords += wordCount;

    let subordinateCount = 0;
    for (const marker of subordinateMarkers) {
      const regex = new RegExp(`\\b${marker}\\b`, 'gi');
      const matches = sentence.match(regex);
      if (matches) subordinateCount += matches.length;
    }

    const commaMatches = sentence.match(/,/g);
    const commas = commaMatches !== null ? commaMatches.length : 0;
    const estimatedClauses = Math.max(1, subordinateCount + 1 + Math.floor(commas / 2));

    totalSubordinateClauses += subordinateCount;
    totalClauses += estimatedClauses;
  }

  const avgClauseDepth = sentences.length > 0 ? totalSubordinateClauses / sentences.length : 0;
  const avgWordsPerClause = totalClauses > 0 ? totalWords / totalClauses : 0;
  const subordinateClauseRatio = totalClauses > 0 ? totalSubordinateClauses / totalClauses : 0;

  return {
    avgClauseDepth: Math.round(avgClauseDepth * 100) / 100,
    avgWordsPerClause: Math.round(avgWordsPerClause * 100) / 100,
    subordinateClauseRatio: Math.round(subordinateClauseRatio * 1000) / 1000,
  };
}

/**
 * Complete stylometric analysis of text.
 */
export interface StylometricAnalysis {
  sentenceLength: SentenceLengthStats;
  punctuation: PunctuationFingerprint;
  vocabulary: VocabularyRichnessStats;
  functionWords: FunctionWordDistribution;
  syntactic: SyntacticComplexityStats;
}

export function analyzeStylometry(text: string): StylometricAnalysis {
  return {
    sentenceLength: sentenceLengthDistribution(text),
    punctuation: punctuationFingerprint(text),
    vocabulary: vocabularyRichness(text),
    functionWords: functionWordDistribution(text),
    syntactic: syntacticComplexity(text),
  };
}
