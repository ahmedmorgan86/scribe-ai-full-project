import type { VoiceScore, StoredVoiceEvaluation } from '@/types';
import {
  embeddingSimilarityFilter,
  structuralPatternFilter,
  EmbeddingFilterResult,
  StructuralPatternResult,
  EmbeddingFilterOptions,
  StructuralFilterOptions,
} from './fast-filter';
import { evaluateVoiceWithLlm, LlmEvalResult, LlmEvalOptions } from './llm-eval';

export type ValidationStage = 'fast_filter' | 'llm_eval';

export interface FastFilterResult {
  passed: boolean;
  embedding: EmbeddingFilterResult;
  structural: StructuralPatternResult;
  failureReasons: string[];
}

export interface ValidationPipelineOptions {
  embeddingOptions?: EmbeddingFilterOptions;
  structuralOptions?: StructuralFilterOptions;
  llmEvalOptions?: LlmEvalOptions;
  skipLlmEval?: boolean;
  requireFastFilterPass?: boolean;
}

export interface ValidationPipelineResult {
  passed: boolean;
  stoppedAt: ValidationStage;
  fastFilter: FastFilterResult;
  llmEval: LlmEvalResult | null;
  voiceScore: VoiceScore | null;
  failureReasons: string[];
  strengths: string[];
  suggestions: string[];
  costUsd: number;
}

async function runFastFilters(
  content: string,
  embeddingOptions?: EmbeddingFilterOptions,
  structuralOptions?: StructuralFilterOptions
): Promise<FastFilterResult> {
  const [embedding, structural] = await Promise.all([
    embeddingSimilarityFilter(content, embeddingOptions),
    Promise.resolve(structuralPatternFilter(content, structuralOptions)),
  ]);

  const failureReasons: string[] = [];

  if (!embedding.passed && embedding.corpusAvailable) {
    failureReasons.push(
      `Voice similarity ${(embedding.similarity * 100).toFixed(1)}% below ${(embedding.threshold * 100).toFixed(0)}% threshold`
    );
  }

  const failedStructural = structural.checks.filter((c) => !c.passed);
  for (const check of failedStructural) {
    switch (check.name) {
      case 'hashtag_count':
        failureReasons.push('Contains hashtags (prohibited)');
        break;
      case 'emoji_count':
        failureReasons.push(`Excessive emoji usage (${check.value})`);
        break;
      case 'hook':
        failureReasons.push('Missing problem-first hook');
        break;
      case 'avg_words_per_sentence':
        failureReasons.push(`Average sentence length too high (${check.value} words)`);
        break;
      case 'sentence_length':
        failureReasons.push(`Sentence length out of range: ${check.value}`);
        break;
      default:
        failureReasons.push(`Structural check failed: ${check.name}`);
    }
  }

  return {
    passed: embedding.passed && structural.passed,
    embedding,
    structural,
    failureReasons,
  };
}

function collectStrengths(fastFilter: FastFilterResult, llmEval: LlmEvalResult | null): string[] {
  const strengths: string[] = [];

  if (fastFilter.embedding.passed && fastFilter.embedding.corpusAvailable) {
    strengths.push(
      `Voice consistency: ${(fastFilter.embedding.similarity * 100).toFixed(1)}% similarity`
    );
  }

  const hookCheck = fastFilter.structural.checks.find((c) => c.name === 'hook');
  if (hookCheck?.passed === true) {
    strengths.push('Strong opening hook');
  }

  if (fastFilter.structural.passed) {
    strengths.push('Clean structure and formatting');
  }

  if (llmEval) {
    strengths.push(...llmEval.strengths);
  }

  return strengths;
}

export async function validateVoice(
  content: string,
  options: ValidationPipelineOptions = {}
): Promise<ValidationPipelineResult> {
  const {
    embeddingOptions,
    structuralOptions,
    llmEvalOptions,
    skipLlmEval = false,
    requireFastFilterPass = true,
  } = options;

  const fastFilter = await runFastFilters(content, embeddingOptions, structuralOptions);

  if (!fastFilter.passed && requireFastFilterPass) {
    return {
      passed: false,
      stoppedAt: 'fast_filter',
      fastFilter,
      llmEval: null,
      voiceScore: null,
      failureReasons: fastFilter.failureReasons,
      strengths: collectStrengths(fastFilter, null),
      suggestions: ['Fix fast filter issues before proceeding to LLM evaluation'],
      costUsd: 0,
    };
  }

  if (skipLlmEval) {
    return {
      passed: fastFilter.passed,
      stoppedAt: 'fast_filter',
      fastFilter,
      llmEval: null,
      voiceScore: null,
      failureReasons: fastFilter.failureReasons,
      strengths: collectStrengths(fastFilter, null),
      suggestions: [],
      costUsd: 0,
    };
  }

  const llmEval = await evaluateVoiceWithLlm(content, llmEvalOptions);

  const allFailureReasons = [...fastFilter.failureReasons, ...llmEval.failureReasons];
  const strengths = collectStrengths(fastFilter, llmEval);

  return {
    passed: fastFilter.passed && llmEval.passed,
    stoppedAt: 'llm_eval',
    fastFilter,
    llmEval,
    voiceScore: llmEval.score,
    failureReasons: allFailureReasons,
    strengths,
    suggestions: llmEval.suggestions,
    costUsd: llmEval.costUsd,
  };
}

export function formatValidationResult(result: ValidationPipelineResult): string {
  const lines: string[] = [];

  lines.push(`Voice Validation: ${result.passed ? '✓ PASSED' : '✗ FAILED'}`);
  lines.push(
    `Stopped at: ${result.stoppedAt === 'fast_filter' ? 'Fast Filter' : 'LLM Evaluation'}`
  );
  lines.push('');

  lines.push('Stage 1 - Fast Filter:');
  lines.push(`  Embedding: ${result.fastFilter.embedding.passed ? '✓' : '✗'}`);
  lines.push(`  Structural: ${result.fastFilter.structural.passed ? '✓' : '✗'}`);
  lines.push(`  Combined: ${result.fastFilter.passed ? '✓ PASSED' : '✗ FAILED'}`);

  if (result.llmEval) {
    lines.push('');
    lines.push('Stage 2 - LLM Evaluation:');
    lines.push(`  Voice:       ${result.llmEval.score.voice}/100`);
    lines.push(`  Hook:        ${result.llmEval.score.hook}/100`);
    lines.push(`  Topic:       ${result.llmEval.score.topic}/100`);
    lines.push(`  Originality: ${result.llmEval.score.originality}/100`);
    lines.push(`  Overall:     ${result.llmEval.score.overall}/100`);
    lines.push(`  Result: ${result.llmEval.passed ? '✓ PASSED' : '✗ FAILED'}`);
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

export function shouldRetryWithRewrite(result: ValidationPipelineResult): boolean {
  if (result.passed) return false;

  const hasStructuralIssues = !result.fastFilter.structural.passed;
  const hasVoiceIssues = !result.fastFilter.embedding.passed;

  if (hasStructuralIssues) {
    const criticalStructural = result.fastFilter.structural.checks.some(
      (c) => !c.passed && c.severity === 'high'
    );
    if (criticalStructural) return true;
  }

  if (result.llmEval && !result.llmEval.passed) {
    return result.llmEval.score.overall >= 50;
  }

  return hasVoiceIssues || hasStructuralIssues;
}

export function getValidationSummary(result: ValidationPipelineResult): {
  status: 'passed' | 'failed_fast_filter' | 'failed_llm_eval';
  summary: string;
} {
  if (result.passed) {
    const scoreStr = result.voiceScore ? ` (score: ${result.voiceScore.overall}/100)` : '';
    return {
      status: 'passed',
      summary: `Voice validation passed${scoreStr}`,
    };
  }

  if (result.stoppedAt === 'fast_filter') {
    const issueCount = result.failureReasons.length;
    return {
      status: 'failed_fast_filter',
      summary: `Failed fast filter with ${issueCount} issue${issueCount === 1 ? '' : 's'}`,
    };
  }

  const score = result.voiceScore?.overall ?? 0;
  return {
    status: 'failed_llm_eval',
    summary: `Failed LLM evaluation (score: ${score}/100)`,
  };
}

export function toStoredVoiceEvaluation(result: ValidationPipelineResult): StoredVoiceEvaluation {
  const defaultScore: VoiceScore = { voice: 0, hook: 0, topic: 0, originality: 0, overall: 0 };

  return {
    passed: result.passed,
    score: result.voiceScore ?? defaultScore,
    failureReasons: result.failureReasons,
    strengths: result.strengths,
    suggestions: result.suggestions,
    stoppedAt: result.stoppedAt,
    costUsd: result.costUsd,
    evaluatedAt: new Date().toISOString(),
  };
}
