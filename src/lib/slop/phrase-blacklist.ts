import type { SlopDetector } from '@/types';

export interface PhraseMatch {
  phrase: string;
  position: number;
  matched: string;
}

export interface PhraseCheckResult {
  hasBannedPhrases: boolean;
  matches: PhraseMatch[];
  detector: SlopDetector;
}

export const BANNED_PHRASES = [
  // AI conversation starters
  "let's dive in",
  "let's dive into",
  "let's explore",
  "let's break this down",
  "let's unpack",
  "let's talk about",
  'let me explain',

  // Generic openers
  "here's the thing",
  "here's why",
  "here's what",
  "here's how",
  'the thing is',

  // Hype words
  'game changer',
  'game-changer',
  'revolutionary',
  'groundbreaking',
  'mind-blowing',
  'mind blowing',
  'incredible',
  'amazing',
  'insane',

  // Thread announcements
  'in this thread',
  'thread:',
  'a thread',
  '🧵',

  // Clickbait
  'hot take:',
  'unpopular opinion:',
  'buckle up',
  "you won't believe",
  'wait until you see',

  // Filler phrases
  "and that's the key",
  "that's the secret",
  'the truth is',
  'the reality is',
  'the fact is',
  'bottom line',
  'at the end of the day',
  'it goes without saying',
  'needless to say',
  'to be honest',
  'honestly speaking',
  "i'll be honest",
  'not gonna lie',
  'real talk',

  // Pseudo-insider knowledge
  "here's a secret",
  'little known fact',
  "most people don't know",
  'what nobody tells you',
  'the hidden truth',
  'insider tip',
  'pro tip:',
  'life hack',

  // Corporate/marketing speak
  'secret sauce',
  'unlock',
  'unleash',
  'leverage',
  'optimize',
  'synergy',
  'paradigm shift',
  'deep dive',
  'level up',
  'scale',
  'disrupt',
  'empower',
  'ecosystem',

  // Filler transitional
  'that being said',
  'having said that',
  'with that said',
  'all that said',
  'that said',
  'moving on',
  'on that note',

  // Performative
  'i firmly believe',
  'i truly believe',
  'i strongly believe',
  'in my humble opinion',
  'if i may',
  'allow me to',

  // Generic conclusions
  'food for thought',
  'just my two cents',
  'take it or leave it',
  'make of that what you will',
  'think about it',
  'let that sink in',
] as const;

export type BannedPhrase = (typeof BANNED_PHRASES)[number];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/['']/g, "'").replace(/[""]/g, '"').replace(/\s+/g, ' ').trim();
}

function findPhrasePosition(normalizedContent: string, phrase: string): number {
  return normalizedContent.indexOf(phrase);
}

export function checkForBannedPhrases(content: string): PhraseCheckResult {
  const normalized = normalizeText(content);
  const matches: PhraseMatch[] = [];

  for (const phrase of BANNED_PHRASES) {
    const position = findPhrasePosition(normalized, phrase);
    if (position !== -1) {
      const startInOriginal = findApproximateOriginalPosition(content, normalized, position);
      const matchedText = content.substring(startInOriginal, startInOriginal + phrase.length + 10);

      matches.push({
        phrase,
        position: startInOriginal,
        matched: matchedText.trim(),
      });
    }
  }

  return {
    hasBannedPhrases: matches.length > 0,
    matches,
    detector: 'phrase',
  };
}

function findApproximateOriginalPosition(
  original: string,
  normalized: string,
  normalizedPosition: number
): number {
  const ratio = original.length / normalized.length;
  return Math.floor(normalizedPosition * ratio);
}

export function isBannedPhrase(text: string): boolean {
  const normalized = normalizeText(text);
  return BANNED_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function getBannedPhrasesList(): readonly string[] {
  return BANNED_PHRASES;
}

export function formatPhraseCheckResult(result: PhraseCheckResult): string {
  if (!result.hasBannedPhrases) {
    return 'No banned phrases detected.';
  }

  const lines = ['Banned phrases detected:'];
  for (const match of result.matches) {
    lines.push(`  - "${match.phrase}" at position ${match.position}`);
    lines.push(`    Context: "...${match.matched}..."`);
  }
  return lines.join('\n');
}
