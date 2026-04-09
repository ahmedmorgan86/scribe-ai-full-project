import type { AnthropicModel } from '@/types';

export const MODEL_IDS: Record<AnthropicModel, string> = {
  haiku: 'claude-3-5-haiku-20241022',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

export const MODEL_CONTEXT_WINDOWS: Record<AnthropicModel, number> = {
  haiku: 200000,
  sonnet: 200000,
  opus: 200000,
};

export const MODEL_MAX_OUTPUT_TOKENS: Record<AnthropicModel, number> = {
  haiku: 8192,
  sonnet: 16384,
  opus: 32000,
};

export const MODEL_INPUT_COST_PER_MILLION: Record<AnthropicModel, number> = {
  haiku: 0.8,
  sonnet: 3.0,
  opus: 15.0,
};

export const MODEL_OUTPUT_COST_PER_MILLION: Record<AnthropicModel, number> = {
  haiku: 4.0,
  sonnet: 15.0,
  opus: 75.0,
};

export type TaskType =
  | 'parsing'
  | 'classification'
  | 'analysis'
  | 'scoring'
  | 'generation'
  | 'pattern_extraction';

const TASK_MODEL_MAP: Record<TaskType, AnthropicModel> = {
  parsing: 'haiku',
  classification: 'haiku',
  analysis: 'sonnet',
  scoring: 'sonnet',
  generation: 'opus',
  pattern_extraction: 'sonnet',
};

export function selectModelForTask(taskType: TaskType): AnthropicModel {
  return TASK_MODEL_MAP[taskType];
}

export function getModelId(model: AnthropicModel): string {
  return MODEL_IDS[model];
}

export function calculateCost(
  model: AnthropicModel,
  inputTokens: number,
  outputTokens: number
): number {
  const inputCost = (inputTokens / 1_000_000) * MODEL_INPUT_COST_PER_MILLION[model];
  const outputCost = (outputTokens / 1_000_000) * MODEL_OUTPUT_COST_PER_MILLION[model];
  return inputCost + outputCost;
}
