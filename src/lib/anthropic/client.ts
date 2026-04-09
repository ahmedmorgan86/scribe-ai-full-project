import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicModel, TokenUsage } from '@/types';
import { MODEL_IDS } from './models';
import {
  completion as gatewayCompletion,
  conversationCompletion as gatewayConversationCompletion,
  isGatewayAvailable,
  type GatewayMessage,
} from '@/lib/llm/gateway';

let client: Anthropic | null = null;
let gatewayAvailable: boolean | null = null;

/**
 * Check if the LiteLLM gateway should be used.
 * Respects LLM_ROUTING_MODE (preferred) or USE_LITELLM_GATEWAY (deprecated).
 * - LLM_ROUTING_MODE=gateway → use gateway
 * - LLM_ROUTING_MODE=direct → use direct API
 * - USE_LITELLM_GATEWAY=true → use gateway (deprecated)
 */
function shouldUseGateway(): boolean {
  const routingMode = process.env.LLM_ROUTING_MODE?.toLowerCase();
  if (routingMode === 'gateway') return true;
  if (routingMode === 'direct') return false;
  // Fallback to deprecated USE_LITELLM_GATEWAY for backwards compatibility
  return process.env.USE_LITELLM_GATEWAY === 'true';
}

/**
 * Get the Anthropic SDK client for direct API access.
 * Used for token counting (beta API) and direct calls when gateway is disabled.
 */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function resetAnthropicClient(): void {
  client = null;
  gatewayAvailable = null;
}

export interface CompletionOptions {
  model: AnthropicModel;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface CompletionResult {
  content: string;
  usage: TokenUsage;
  stopReason: string | null;
}

async function createCompletionDirect(
  prompt: string,
  options: CompletionOptions
): Promise<CompletionResult> {
  const anthropic = getAnthropicClient();
  const { model, systemPrompt, maxTokens = 4096, temperature = 1, stopSequences } = options;

  const response = await anthropic.messages.create({
    model: MODEL_IDS[model],
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    stop_sequences: stopSequences,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  const content = textContent?.type === 'text' ? textContent.text : '';

  return {
    content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
    stopReason: response.stop_reason,
  };
}

async function createCompletionViaGateway(
  prompt: string,
  options: CompletionOptions
): Promise<CompletionResult> {
  const { model, systemPrompt, maxTokens = 4096, temperature = 1, stopSequences } = options;

  const result = await gatewayCompletion(prompt, {
    model,
    systemPrompt,
    maxTokens,
    temperature,
    stopSequences,
  });

  return {
    content: result.content,
    usage: {
      inputTokens: result.tokenUsage.inputTokens,
      outputTokens: result.tokenUsage.outputTokens,
      totalTokens: result.tokenUsage.totalTokens,
    },
    stopReason: result.stopReason,
  };
}

/**
 * Create a completion with a single prompt.
 * Routes through LiteLLM gateway if enabled, otherwise uses direct Anthropic API.
 */
export async function createCompletion(
  prompt: string,
  options: CompletionOptions
): Promise<CompletionResult> {
  if (!shouldUseGateway()) {
    return createCompletionDirect(prompt, options);
  }

  if (gatewayAvailable === null) {
    gatewayAvailable = await isGatewayAvailable();
  }

  if (gatewayAvailable) {
    return createCompletionViaGateway(prompt, options);
  }

  return createCompletionDirect(prompt, options);
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function createConversationCompletionDirect(
  messages: ConversationMessage[],
  options: CompletionOptions
): Promise<CompletionResult> {
  const anthropic = getAnthropicClient();
  const { model, systemPrompt, maxTokens = 4096, temperature = 1, stopSequences } = options;

  const response = await anthropic.messages.create({
    model: MODEL_IDS[model],
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    stop_sequences: stopSequences,
    messages,
  });

  const textContent = response.content.find((c) => c.type === 'text');
  const content = textContent?.type === 'text' ? textContent.text : '';

  return {
    content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
    stopReason: response.stop_reason,
  };
}

async function createConversationCompletionViaGateway(
  messages: ConversationMessage[],
  options: CompletionOptions
): Promise<CompletionResult> {
  const { model, systemPrompt, maxTokens = 4096, temperature = 1, stopSequences } = options;

  const gatewayMessages: GatewayMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const result = await gatewayConversationCompletion(gatewayMessages, {
    model,
    systemPrompt,
    maxTokens,
    temperature,
    stopSequences,
  });

  return {
    content: result.content,
    usage: {
      inputTokens: result.tokenUsage.inputTokens,
      outputTokens: result.tokenUsage.outputTokens,
      totalTokens: result.tokenUsage.totalTokens,
    },
    stopReason: result.stopReason,
  };
}

/**
 * Create a completion with a conversation (multiple messages).
 * Routes through LiteLLM gateway if enabled, otherwise uses direct Anthropic API.
 */
export async function createConversationCompletion(
  messages: ConversationMessage[],
  options: CompletionOptions
): Promise<CompletionResult> {
  if (!shouldUseGateway()) {
    return createConversationCompletionDirect(messages, options);
  }

  if (gatewayAvailable === null) {
    gatewayAvailable = await isGatewayAvailable();
  }

  if (gatewayAvailable) {
    return createConversationCompletionViaGateway(messages, options);
  }

  return createConversationCompletionDirect(messages, options);
}
