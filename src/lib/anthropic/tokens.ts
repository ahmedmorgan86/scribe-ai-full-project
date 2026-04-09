import type { AnthropicModel } from '@/types';
import { getAnthropicClient } from './client';
import { MODEL_IDS } from './models';

export interface TokenCountResult {
  inputTokens: number;
}

export interface MessageForCounting {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Count tokens for a single text string using the Anthropic API.
 * Uses the beta countTokens endpoint for accurate model-specific counts.
 */
export async function countTokens(
  text: string,
  model: AnthropicModel = 'sonnet'
): Promise<TokenCountResult> {
  const client = getAnthropicClient();

  const response = await client.beta.messages.countTokens({
    model: MODEL_IDS[model],
    messages: [{ role: 'user', content: text }],
  });

  return {
    inputTokens: response.input_tokens,
  };
}

/**
 * Count tokens for a conversation (multiple messages) using the Anthropic API.
 */
export async function countConversationTokens(
  messages: MessageForCounting[],
  model: AnthropicModel = 'sonnet',
  systemPrompt?: string
): Promise<TokenCountResult> {
  const client = getAnthropicClient();

  const response = await client.beta.messages.countTokens({
    model: MODEL_IDS[model],
    messages,
    system: systemPrompt,
  });

  return {
    inputTokens: response.input_tokens,
  };
}

/**
 * Count tokens for a system prompt separately.
 * Useful for budgeting context window usage.
 */
export async function countSystemPromptTokens(
  systemPrompt: string,
  model: AnthropicModel = 'sonnet'
): Promise<TokenCountResult> {
  const client = getAnthropicClient();

  const response = await client.beta.messages.countTokens({
    model: MODEL_IDS[model],
    messages: [{ role: 'user', content: 'x' }],
    system: systemPrompt,
  });

  const responseWithoutSystem = await client.beta.messages.countTokens({
    model: MODEL_IDS[model],
    messages: [{ role: 'user', content: 'x' }],
  });

  return {
    inputTokens: response.input_tokens - responseWithoutSystem.input_tokens,
  };
}

/**
 * Estimate token count locally without API call.
 * Uses rough approximation: ~4 characters per token for English text.
 * Less accurate than API but free and instant.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if content fits within a model's context window.
 * Returns remaining tokens available.
 */
export async function checkContextFit(
  messages: MessageForCounting[],
  model: AnthropicModel,
  systemPrompt?: string,
  reserveOutputTokens: number = 4096
): Promise<{ fits: boolean; inputTokens: number; remainingTokens: number }> {
  const { inputTokens } = await countConversationTokens(messages, model, systemPrompt);

  const contextWindow = getContextWindow(model);
  const availableForInput = contextWindow - reserveOutputTokens;
  const remainingTokens = availableForInput - inputTokens;

  return {
    fits: remainingTokens >= 0,
    inputTokens,
    remainingTokens: Math.max(0, remainingTokens),
  };
}

function getContextWindow(model: AnthropicModel): number {
  const windows: Record<AnthropicModel, number> = {
    haiku: 200000,
    sonnet: 200000,
    opus: 200000,
  };
  return windows[model];
}
