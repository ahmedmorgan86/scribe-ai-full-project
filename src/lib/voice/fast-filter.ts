import {
  checkVoiceSimilarity,
  VoiceSimilarityResult,
  VoiceEmbeddingMatch,
  getVoiceCorpusStatus,
  DEFAULT_SIMILARITY_THRESHOLD,
} from '@/lib/voice/embeddings';

export interface EmbeddingFilterResult {
  passed: boolean;
  similarity: number;
  threshold: number;
  matchCount: number;
  topMatches: VoiceEmbeddingMatch[];
  reason: string;
  corpusAvailable: boolean;
}

export interface StructuralPatternResult {
  passed: boolean;
  score: number;
  checks: StructuralCheck[];
  reason: string;
}

export interface StructuralCheck {
  name: string;
  passed: boolean;
  value: number | string;
  threshold?: number | string;
  severity: 'low' | 'medium' | 'high';
}

export interface StructuralFilterOptions {
  minSentenceLength?: number;
  maxSentenceLength?: number;
  maxAvgWordsPerSentence?: number;
  requireHook?: boolean;
  maxEmojiCount?: number;
  maxHashtagCount?: number;
}

const DEFAULT_STRUCTURAL_OPTIONS: Required<StructuralFilterOptions> = {
  minSentenceLength: 3,
  maxSentenceLength: 280,
  maxAvgWordsPerSentence: 25,
  requireHook: true,
  maxEmojiCount: 3,
  maxHashtagCount: 0,
};

const HOOK_PATTERNS = [
  /^(problem|issue|struggle|frustrat|pain|stuck|hard|difficult|tired of|waste|broken|why|how)/i,
  /\?$/,
  /^(you|your)\b/i,
  /^(stop|don't|never|avoid)\b/i,
  /^(here's|this is) (the|a|why|how|what)/i,
  /^(most|many|few) (people|devs|engineers|developers)/i,
  /^(I|we) (spent|wasted|tried|failed|discovered|found|learned)/i,
  /^(the|a) (secret|trick|hack|way|method|approach)/i,
  /^\d+ (things?|ways?|tips?|mistakes?|reasons?)/i,
];

const EMOJI_PATTERN =
  /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
const HASHTAG_PATTERN = /#[a-zA-Z]\w*/g;

export interface EmbeddingFilterOptions {
  threshold?: number;
  nResults?: number;
  includeGuidelines?: boolean;
  requireCorpus?: boolean;
}

export async function embeddingSimilarityFilter(
  draftContent: string,
  options: EmbeddingFilterOptions = {}
): Promise<EmbeddingFilterResult> {
  const {
    threshold = DEFAULT_SIMILARITY_THRESHOLD,
    nResults = 5,
    includeGuidelines = true,
    requireCorpus = false,
  } = options;

  const corpusStatus = await getVoiceCorpusStatus();
  const corpusAvailable = corpusStatus.hasMinimumCorpus || corpusStatus.guidelinesLoaded;

  if (!corpusAvailable) {
    if (requireCorpus) {
      return {
        passed: false,
        similarity: 0,
        threshold,
        matchCount: 0,
        topMatches: [],
        reason: 'Voice corpus not available (minimum 50 approved posts or guidelines required)',
        corpusAvailable: false,
      };
    }
    return {
      passed: true,
      similarity: 0,
      threshold,
      matchCount: 0,
      topMatches: [],
      reason: 'Skipped: no voice corpus available for comparison',
      corpusAvailable: false,
    };
  }

  const result: VoiceSimilarityResult = await checkVoiceSimilarity(draftContent, {
    threshold,
    nResults,
    includeGuidelines: includeGuidelines && corpusStatus.guidelinesLoaded,
  });

  if (result.matchCount === 0) {
    return {
      passed: false,
      similarity: 0,
      threshold,
      matchCount: 0,
      topMatches: [],
      reason: 'No similar content found in voice corpus',
      corpusAvailable: true,
    };
  }

  const percentSimilarity = (result.averageSimilarity * 100).toFixed(1);
  const percentThreshold = (threshold * 100).toFixed(0);

  if (result.passesThreshold) {
    return {
      passed: true,
      similarity: result.averageSimilarity,
      threshold,
      matchCount: result.matchCount,
      topMatches: result.matches,
      reason: `Embedding similarity ${percentSimilarity}% meets ${percentThreshold}% threshold`,
      corpusAvailable: true,
    };
  }

  return {
    passed: false,
    similarity: result.averageSimilarity,
    threshold,
    matchCount: result.matchCount,
    topMatches: result.matches,
    reason: `Embedding similarity ${percentSimilarity}% below ${percentThreshold}% threshold`,
    corpusAvailable: true,
  };
}

export function formatEmbeddingFilterResult(result: EmbeddingFilterResult): string {
  const lines: string[] = [];

  lines.push(`Embedding Similarity Filter: ${result.passed ? 'PASSED' : 'FAILED'}`);
  lines.push(`  Reason: ${result.reason}`);

  if (result.corpusAvailable && result.matchCount > 0) {
    lines.push(`  Similarity: ${(result.similarity * 100).toFixed(1)}%`);
    lines.push(`  Threshold: ${(result.threshold * 100).toFixed(0)}%`);
    lines.push(`  Matches: ${result.matchCount}`);

    if (result.topMatches.length > 0) {
      lines.push('  Top matches:');
      for (const match of result.topMatches.slice(0, 3)) {
        const preview =
          match.content.length > 60 ? match.content.substring(0, 60) + '...' : match.content;
        const simPercent = (match.similarity * 100).toFixed(1);
        lines.push(`    - [${match.source}] ${simPercent}%: "${preview}"`);
      }
    }
  }

  return lines.join('\n');
}

function getSentences(content: string): string[] {
  return content
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function checkSentenceLength(
  content: string,
  options: Required<StructuralFilterOptions>
): StructuralCheck {
  const sentences = getSentences(content);
  if (sentences.length === 0) {
    return {
      name: 'sentence_length',
      passed: false,
      value: 0,
      severity: 'high',
    };
  }

  const lengths = sentences.map((s) => s.length);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);

  const tooShort = minLen < options.minSentenceLength;
  const tooLong = maxLen > options.maxSentenceLength;
  const passed = !tooShort && !tooLong;

  return {
    name: 'sentence_length',
    passed,
    value: `${minLen}-${maxLen} chars`,
    threshold: `${options.minSentenceLength}-${options.maxSentenceLength}`,
    severity: passed ? 'low' : tooLong ? 'medium' : 'low',
  };
}

function checkAvgWordsPerSentence(
  content: string,
  options: Required<StructuralFilterOptions>
): StructuralCheck {
  const sentences = getSentences(content);
  if (sentences.length === 0) {
    return {
      name: 'avg_words_per_sentence',
      passed: false,
      value: 0,
      severity: 'high',
    };
  }

  const totalWords = sentences.reduce((sum, s) => sum + countWords(s), 0);
  const avg = Math.round(totalWords / sentences.length);
  const passed = avg <= options.maxAvgWordsPerSentence;

  return {
    name: 'avg_words_per_sentence',
    passed,
    value: avg,
    threshold: options.maxAvgWordsPerSentence,
    severity: passed ? 'low' : 'medium',
  };
}

function getFirstSentenceWithPunctuation(content: string): string {
  const match = content.match(/^[^.!?]*[.!?]?/);
  return match ? match[0].trim() : content.trim();
}

function checkHook(content: string, options: Required<StructuralFilterOptions>): StructuralCheck {
  if (!options.requireHook) {
    return {
      name: 'hook',
      passed: true,
      value: 'not required',
      severity: 'low',
    };
  }

  const firstSentence = getFirstSentenceWithPunctuation(content);
  const hasHook = HOOK_PATTERNS.some((p) => p.test(firstSentence));

  return {
    name: 'hook',
    passed: hasHook,
    value: hasHook ? 'detected' : 'missing',
    severity: hasHook ? 'low' : 'medium',
  };
}

function checkEmojiCount(
  content: string,
  options: Required<StructuralFilterOptions>
): StructuralCheck {
  const matches = content.match(EMOJI_PATTERN) ?? [];
  const count = matches.length;
  const passed = count <= options.maxEmojiCount;

  return {
    name: 'emoji_count',
    passed,
    value: count,
    threshold: options.maxEmojiCount,
    severity: passed ? 'low' : count > options.maxEmojiCount * 2 ? 'high' : 'medium',
  };
}

function checkHashtagCount(
  content: string,
  options: Required<StructuralFilterOptions>
): StructuralCheck {
  const matches = content.match(HASHTAG_PATTERN) ?? [];
  const count = matches.length;
  const passed = count <= options.maxHashtagCount;

  return {
    name: 'hashtag_count',
    passed,
    value: count,
    threshold: options.maxHashtagCount,
    severity: passed ? 'low' : 'high',
  };
}

export function structuralPatternFilter(
  content: string,
  options: StructuralFilterOptions = {}
): StructuralPatternResult {
  const opts: Required<StructuralFilterOptions> = {
    ...DEFAULT_STRUCTURAL_OPTIONS,
    ...options,
  };

  const checks: StructuralCheck[] = [
    checkSentenceLength(content, opts),
    checkAvgWordsPerSentence(content, opts),
    checkHook(content, opts),
    checkEmojiCount(content, opts),
    checkHashtagCount(content, opts),
  ];

  const failedChecks = checks.filter((c) => !c.passed);
  const highSeverityFail = failedChecks.some((c) => c.severity === 'high');
  const mediumSeverityFailCount = failedChecks.filter((c) => c.severity === 'medium').length;

  const passed = !highSeverityFail && mediumSeverityFailCount <= 1;
  const passedCount = checks.filter((c) => c.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);

  let reason: string;
  if (passed) {
    reason = `Structural checks passed (${passedCount}/${checks.length})`;
  } else if (highSeverityFail) {
    const highFail = failedChecks.find((c) => c.severity === 'high');
    reason = `Critical structural issue: ${highFail?.name}`;
  } else {
    reason = `Multiple structural issues: ${failedChecks.map((c) => c.name).join(', ')}`;
  }

  return {
    passed,
    score,
    checks,
    reason,
  };
}

export function formatStructuralFilterResult(result: StructuralPatternResult): string {
  const lines: string[] = [];

  lines.push(`Structural Pattern Filter: ${result.passed ? 'PASSED' : 'FAILED'}`);
  lines.push(`  Reason: ${result.reason}`);
  lines.push(`  Score: ${result.score}%`);
  lines.push('  Checks:');

  for (const check of result.checks) {
    const icon = check.passed ? '✓' : '✗';
    const thresholdStr = check.threshold !== undefined ? ` (threshold: ${check.threshold})` : '';
    lines.push(`    ${icon} ${check.name}: ${check.value}${thresholdStr}`);
  }

  return lines.join('\n');
}

export { DEFAULT_SIMILARITY_THRESHOLD };
