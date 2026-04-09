import type { VoiceScore } from '@/types';
import { trackedCompletion, TrackedCompletionResult } from '@/lib/anthropic/cost-tracking';
import {
  buildVoiceEvaluationSystemPrompt,
  buildVoiceEvaluationUserPrompt,
  parseVoiceEvaluationResponse,
  VoiceEvaluationContext,
  VoiceEvaluationResponse,
} from '@/lib/anthropic/prompts/voice-evaluation';
import { getVoiceGuidelinesFromQdrant, formatGuidelinesForPrompt } from './guidelines';
import { getApprovedPostsForComparison } from './embeddings';
import { listPatterns } from '@/db/models/patterns';

export interface LlmEvalOptions {
  nApprovedExamples?: number;
  nVoicePatterns?: number;
}

export interface LlmEvalResult {
  passed: boolean;
  score: VoiceScore;
  failureReasons: string[];
  strengths: string[];
  suggestions: string[];
  costUsd: number;
  costEntryId: number;
}

function getLearnedVoicePatterns(limit: number): string[] {
  const patterns = listPatterns({
    patternType: 'voice',
    limit,
    orderBy: 'evidence_count',
    orderDir: 'desc',
  });

  return patterns.map((p) => p.description);
}

async function getRecentApprovedExamples(draftContent: string, count: number): Promise<string[]> {
  const posts = await getApprovedPostsForComparison(draftContent, count);
  return posts.map((p) => p.content);
}

export async function evaluateVoiceWithLlm(
  draftContent: string,
  options: LlmEvalOptions = {}
): Promise<LlmEvalResult> {
  const { nApprovedExamples = 5, nVoicePatterns = 10 } = options;

  const [guidelines, approvedExamples, voicePatterns] = await Promise.all([
    getVoiceGuidelinesFromQdrant(),
    getRecentApprovedExamples(draftContent, nApprovedExamples),
    getLearnedVoicePatterns(nVoicePatterns),
  ]);

  const voiceGuidelinesText = formatGuidelinesForPrompt(guidelines);

  const context: VoiceEvaluationContext = {
    voiceGuidelines: voiceGuidelinesText || 'No voice guidelines loaded.',
    draftContent,
    recentApprovedExamples: approvedExamples,
    learnedVoicePatterns: voicePatterns,
  };

  const systemPrompt = buildVoiceEvaluationSystemPrompt();
  const userPrompt = buildVoiceEvaluationUserPrompt(context);

  const result: TrackedCompletionResult = await trackedCompletion(userPrompt, {
    model: 'sonnet',
    systemPrompt,
    maxTokens: 1024,
    temperature: 0.2,
  });

  const evaluation: VoiceEvaluationResponse = parseVoiceEvaluationResponse(result.content);

  return {
    passed: evaluation.passed,
    score: evaluation.score,
    failureReasons: evaluation.failureReasons,
    strengths: evaluation.strengths,
    suggestions: evaluation.suggestions,
    costUsd: result.costUsd,
    costEntryId: result.costEntryId,
  };
}

export function formatLlmEvalResult(result: LlmEvalResult): string {
  const lines: string[] = [];

  lines.push(`LLM Voice Evaluation: ${result.passed ? 'PASSED' : 'FAILED'}`);
  lines.push('');
  lines.push('Scores:');
  lines.push(`  Voice:       ${result.score.voice}/100`);
  lines.push(`  Hook:        ${result.score.hook}/100`);
  lines.push(`  Topic:       ${result.score.topic}/100`);
  lines.push(`  Originality: ${result.score.originality}/100`);
  lines.push(`  Overall:     ${result.score.overall}/100`);

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

  lines.push('');
  lines.push(`API Cost: $${result.costUsd.toFixed(4)}`);

  return lines.join('\n');
}

export function isVoiceScoreAcceptable(score: VoiceScore): boolean {
  const PASS_THRESHOLD = 70;
  const MIN_DIMENSION_THRESHOLD = 50;

  if (score.overall < PASS_THRESHOLD) {
    return false;
  }

  if (score.voice < MIN_DIMENSION_THRESHOLD) {
    return false;
  }
  if (score.hook < MIN_DIMENSION_THRESHOLD) {
    return false;
  }
  if (score.topic < MIN_DIMENSION_THRESHOLD) {
    return false;
  }
  if (score.originality < MIN_DIMENSION_THRESHOLD) {
    return false;
  }

  return true;
}

export function getWeakestDimension(score: VoiceScore): {
  dimension: keyof Omit<VoiceScore, 'overall'>;
  value: number;
} {
  const dimensions: Array<{ dimension: keyof Omit<VoiceScore, 'overall'>; value: number }> = [
    { dimension: 'voice', value: score.voice },
    { dimension: 'hook', value: score.hook },
    { dimension: 'topic', value: score.topic },
    { dimension: 'originality', value: score.originality },
  ];

  return dimensions.reduce((min, curr) => (curr.value < min.value ? curr : min));
}
