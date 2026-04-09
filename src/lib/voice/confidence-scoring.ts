import type { VoiceScore } from '@/types';
import {
  embeddingSimilarityFilter,
  structuralPatternFilter,
  EmbeddingFilterResult,
  StructuralPatternResult,
} from './fast-filter';
import { evaluateVoiceWithLlm, LlmEvalResult, isVoiceScoreAcceptable } from './llm-eval';

export interface ConfidenceScoreInput {
  draftContent: string;
  skipLlmEval?: boolean;
  embeddingThreshold?: number;
}

export interface DimensionalBreakdown {
  voice: DimensionScore;
  hook: DimensionScore;
  topic: DimensionScore;
  originality: DimensionScore;
}

export interface DimensionScore {
  score: number;
  weight: number;
  contribution: number;
  source: 'fast_filter' | 'llm_eval' | 'combined';
}

export interface ConfidenceScoreResult {
  overallScore: number;
  voiceScore: VoiceScore;
  breakdown: DimensionalBreakdown;
  passed: boolean;
  passedFastFilter: boolean;
  passedLlmEval: boolean | null;
  fastFilterResults: {
    embedding: EmbeddingFilterResult;
    structural: StructuralPatternResult;
  };
  llmEvalResult: LlmEvalResult | null;
  failureReasons: string[];
  strengths: string[];
  suggestions: string[];
  costUsd: number;
}

const DIMENSION_WEIGHTS = {
  voice: 0.35,
  hook: 0.25,
  topic: 0.2,
  originality: 0.2,
} as const;

const PASS_THRESHOLD = 70;
const MIN_DIMENSION_THRESHOLD = 50;

function calculateOverallScore(scores: VoiceScore): number {
  const weighted =
    scores.voice * DIMENSION_WEIGHTS.voice +
    scores.hook * DIMENSION_WEIGHTS.hook +
    scores.topic * DIMENSION_WEIGHTS.topic +
    scores.originality * DIMENSION_WEIGHTS.originality;
  return Math.round(weighted);
}

function estimateVoiceFromFastFilters(
  embedding: EmbeddingFilterResult,
  structural: StructuralPatternResult
): number {
  if (!embedding.corpusAvailable) {
    return structural.passed ? 65 : 40;
  }
  const embeddingScore = Math.round(embedding.similarity * 100);
  const structuralBonus = structural.passed ? 10 : -10;
  return Math.min(100, Math.max(0, embeddingScore + structuralBonus));
}

function estimateHookFromFastFilters(structural: StructuralPatternResult): number {
  const hookCheck = structural.checks.find((c) => c.name === 'hook');
  if (!hookCheck) return 60;
  return hookCheck.passed ? 75 : 45;
}

function estimateTopicFromFastFilters(embedding: EmbeddingFilterResult): number {
  if (!embedding.corpusAvailable || embedding.matchCount === 0) {
    return 60;
  }
  return Math.round(embedding.similarity * 100);
}

function estimateOriginalityFromFastFilters(embedding: EmbeddingFilterResult): number {
  if (!embedding.corpusAvailable || embedding.matchCount === 0) {
    return 70;
  }
  const similarity = embedding.similarity;
  if (similarity > 0.95) return 30;
  if (similarity > 0.9) return 50;
  if (similarity > 0.8) return 65;
  return 75;
}

function buildFastFilterVoiceScore(
  embedding: EmbeddingFilterResult,
  structural: StructuralPatternResult
): VoiceScore {
  const voice = estimateVoiceFromFastFilters(embedding, structural);
  const hook = estimateHookFromFastFilters(structural);
  const topic = estimateTopicFromFastFilters(embedding);
  const originality = estimateOriginalityFromFastFilters(embedding);
  const overall = calculateOverallScore({ voice, hook, topic, originality, overall: 0 });

  return { voice, hook, topic, originality, overall };
}

function buildDimensionalBreakdown(
  voiceScore: VoiceScore,
  source: 'fast_filter' | 'llm_eval' | 'combined'
): DimensionalBreakdown {
  return {
    voice: {
      score: voiceScore.voice,
      weight: DIMENSION_WEIGHTS.voice,
      contribution: Math.round(voiceScore.voice * DIMENSION_WEIGHTS.voice),
      source,
    },
    hook: {
      score: voiceScore.hook,
      weight: DIMENSION_WEIGHTS.hook,
      contribution: Math.round(voiceScore.hook * DIMENSION_WEIGHTS.hook),
      source,
    },
    topic: {
      score: voiceScore.topic,
      weight: DIMENSION_WEIGHTS.topic,
      contribution: Math.round(voiceScore.topic * DIMENSION_WEIGHTS.topic),
      source,
    },
    originality: {
      score: voiceScore.originality,
      weight: DIMENSION_WEIGHTS.originality,
      contribution: Math.round(voiceScore.originality * DIMENSION_WEIGHTS.originality),
      source,
    },
  };
}

function checkPassing(voiceScore: VoiceScore): boolean {
  if (voiceScore.overall < PASS_THRESHOLD) return false;
  if (voiceScore.voice < MIN_DIMENSION_THRESHOLD) return false;
  if (voiceScore.hook < MIN_DIMENSION_THRESHOLD) return false;
  if (voiceScore.topic < MIN_DIMENSION_THRESHOLD) return false;
  if (voiceScore.originality < MIN_DIMENSION_THRESHOLD) return false;
  return true;
}

function collectFastFilterIssues(
  embedding: EmbeddingFilterResult,
  structural: StructuralPatternResult
): string[] {
  const issues: string[] = [];

  if (!embedding.passed && embedding.corpusAvailable) {
    issues.push(`Voice similarity below threshold: ${(embedding.similarity * 100).toFixed(1)}%`);
  }

  const failedStructuralChecks = structural.checks.filter((c) => !c.passed);
  for (const check of failedStructuralChecks) {
    switch (check.name) {
      case 'hashtag_count':
        issues.push('Contains hashtags (not allowed)');
        break;
      case 'emoji_count':
        issues.push(`Too many emojis: ${check.value}`);
        break;
      case 'hook':
        issues.push('Missing attention-grabbing hook');
        break;
      case 'avg_words_per_sentence':
        issues.push(`Sentences too long (avg ${check.value} words)`);
        break;
      default:
        issues.push(`Structural issue: ${check.name}`);
    }
  }

  return issues;
}

function collectFastFilterStrengths(
  embedding: EmbeddingFilterResult,
  structural: StructuralPatternResult
): string[] {
  const strengths: string[] = [];

  if (embedding.passed && embedding.corpusAvailable) {
    strengths.push(`Voice consistency: ${(embedding.similarity * 100).toFixed(1)}% match`);
  }

  const hookCheck = structural.checks.find((c) => c.name === 'hook');
  if (hookCheck?.passed === true) {
    strengths.push('Strong opening hook');
  }

  const emojiCheck = structural.checks.find((c) => c.name === 'emoji_count');
  const hashtagCheck = structural.checks.find((c) => c.name === 'hashtag_count');
  if (emojiCheck?.passed === true && hashtagCheck?.passed === true) {
    strengths.push('Clean formatting');
  }

  return strengths;
}

export async function calculateConfidenceScore(
  input: ConfidenceScoreInput
): Promise<ConfidenceScoreResult> {
  const { draftContent, skipLlmEval = false, embeddingThreshold } = input;

  const [embeddingResult, structuralResult] = await Promise.all([
    embeddingSimilarityFilter(draftContent, { threshold: embeddingThreshold }),
    Promise.resolve(structuralPatternFilter(draftContent)),
  ]);

  const passedFastFilter = embeddingResult.passed && structuralResult.passed;

  if (skipLlmEval === true || !passedFastFilter) {
    const voiceScore = buildFastFilterVoiceScore(embeddingResult, structuralResult);
    const breakdown = buildDimensionalBreakdown(voiceScore, 'fast_filter');
    const failureReasons = collectFastFilterIssues(embeddingResult, structuralResult);
    const strengths = collectFastFilterStrengths(embeddingResult, structuralResult);

    return {
      overallScore: voiceScore.overall,
      voiceScore,
      breakdown,
      passed: checkPassing(voiceScore) && passedFastFilter,
      passedFastFilter,
      passedLlmEval: null,
      fastFilterResults: {
        embedding: embeddingResult,
        structural: structuralResult,
      },
      llmEvalResult: null,
      failureReasons,
      strengths,
      suggestions: failureReasons.length > 0 ? ['Address fast filter issues before LLM eval'] : [],
      costUsd: 0,
    };
  }

  const llmResult = await evaluateVoiceWithLlm(draftContent);
  const passedLlmEval = llmResult.passed && isVoiceScoreAcceptable(llmResult.score);

  const voiceScore = llmResult.score;
  const breakdown = buildDimensionalBreakdown(voiceScore, 'llm_eval');
  const passed = passedFastFilter && passedLlmEval;

  const failureReasons = [
    ...collectFastFilterIssues(embeddingResult, structuralResult),
    ...llmResult.failureReasons,
  ];
  const strengths = [
    ...collectFastFilterStrengths(embeddingResult, structuralResult),
    ...llmResult.strengths,
  ];

  return {
    overallScore: voiceScore.overall,
    voiceScore,
    breakdown,
    passed,
    passedFastFilter,
    passedLlmEval,
    fastFilterResults: {
      embedding: embeddingResult,
      structural: structuralResult,
    },
    llmEvalResult: llmResult,
    failureReasons,
    strengths,
    suggestions: llmResult.suggestions,
    costUsd: llmResult.costUsd,
  };
}

export function formatConfidenceScore(result: ConfidenceScoreResult): string {
  const lines: string[] = [];

  const passStatus = result.passed ? '✓ PASSED' : '✗ FAILED';
  lines.push(`Confidence Score: ${result.overallScore}/100 ${passStatus}`);
  lines.push('');

  lines.push('Dimensional Breakdown:');
  const voiceWeight = DIMENSION_WEIGHTS.voice * 100;
  const hookWeight = DIMENSION_WEIGHTS.hook * 100;
  const topicWeight = DIMENSION_WEIGHTS.topic * 100;
  const origWeight = DIMENSION_WEIGHTS.originality * 100;
  lines.push(`  Voice:       ${result.voiceScore.voice}/100 (weight: ${voiceWeight}%)`);
  lines.push(`  Hook:        ${result.voiceScore.hook}/100 (weight: ${hookWeight}%)`);
  lines.push(`  Topic:       ${result.voiceScore.topic}/100 (weight: ${topicWeight}%)`);
  lines.push(`  Originality: ${result.voiceScore.originality}/100 (weight: ${origWeight}%)`);
  lines.push('');

  lines.push('Validation Pipeline:');
  lines.push(`  Fast Filter: ${result.passedFastFilter ? '✓ PASSED' : '✗ FAILED'}`);
  if (result.passedLlmEval !== null) {
    lines.push(`  LLM Eval:    ${result.passedLlmEval ? '✓ PASSED' : '✗ FAILED'}`);
  } else {
    lines.push('  LLM Eval:    SKIPPED');
  }

  if (result.strengths.length > 0) {
    lines.push('');
    lines.push('Strengths:');
    for (const s of result.strengths) {
      lines.push(`  + ${s}`);
    }
  }

  if (result.failureReasons.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const f of result.failureReasons) {
      lines.push(`  - ${f}`);
    }
  }

  if (result.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const s of result.suggestions) {
      lines.push(`  → ${s}`);
    }
  }

  if (result.costUsd > 0) {
    lines.push('');
    lines.push(`API Cost: $${result.costUsd.toFixed(4)}`);
  }

  return lines.join('\n');
}

export function getConfidenceLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

export function getConfidenceBadgeColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

export { DIMENSION_WEIGHTS, PASS_THRESHOLD, MIN_DIMENSION_THRESHOLD };
