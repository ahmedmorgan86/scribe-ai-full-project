/**
 * Multi-language function word lists for stylometric analysis.
 *
 * Function words (articles, prepositions, pronouns, conjunctions, auxiliary verbs)
 * are key features in Burrows' Delta and other authorship attribution methods.
 * Their usage patterns are highly individual and language-specific.
 */

import { englishConfig, ENGLISH_FUNCTION_WORDS, ENGLISH_SUBORDINATE_MARKERS } from './en';
import { germanConfig } from './de';
import { spanishConfig } from './es';

export { englishConfig, ENGLISH_FUNCTION_WORDS, ENGLISH_SUBORDINATE_MARKERS } from './en';
export { germanConfig, GERMAN_FUNCTION_WORDS, GERMAN_SUBORDINATE_MARKERS } from './de';
export { spanishConfig, SPANISH_FUNCTION_WORDS, SPANISH_SUBORDINATE_MARKERS } from './es';

export interface LanguageFunctionWordConfig {
  languageCode: string;
  functionWords: readonly string[];
  subordinateMarkers: readonly string[];
}

const LANGUAGE_CONFIGS: Record<string, LanguageFunctionWordConfig> = {
  en: englishConfig,
  de: germanConfig,
  es: spanishConfig,
};

/**
 * Gets function words for the specified language.
 * Falls back to English if language is not supported.
 */
export function getFunctionWordsForLanguage(language: string): readonly string[] {
  const config = LANGUAGE_CONFIGS[language];
  if (config !== undefined) {
    return config.functionWords;
  }
  return ENGLISH_FUNCTION_WORDS;
}

/**
 * Gets subordinate clause markers for the specified language.
 * Falls back to English if language is not supported.
 */
export function getSubordinateMarkersForLanguage(language: string): readonly string[] {
  const config = LANGUAGE_CONFIGS[language];
  if (config !== undefined) {
    return config.subordinateMarkers;
  }
  return ENGLISH_SUBORDINATE_MARKERS;
}

/**
 * Gets the full language configuration for the specified language.
 * Falls back to English if language is not supported.
 */
export function getLanguageConfig(language: string): LanguageFunctionWordConfig {
  const config = LANGUAGE_CONFIGS[language];
  if (config !== undefined) {
    return config;
  }
  return englishConfig;
}

/**
 * Checks if a language has dedicated function word support.
 */
export function isLanguageSupported(language: string): boolean {
  return language in LANGUAGE_CONFIGS;
}

/**
 * Returns list of all supported languages for stylometric analysis.
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_CONFIGS);
}
