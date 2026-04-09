/**
 * LiteLLM Gateway Client
 *
 * TypeScript client for the Python LiteLLM sidecar service.
 * Provides multi-provider LLM access with automatic fallback support.
 *
 * Features:
 * - Circuit breaker per provider (Anthropic, OpenAI)
 * - Exponential backoff with jitter for retries
 * - Task-based routing with automatic fallback chains
 */

import { createLogger } from '@/lib/logger';
import type { AnthropicModel } from '@/types';
import { buildFallbackChain, getModelForTask, type ModelId, type TaskType } from './config';
import {
  getProviderCircuitBreaker,
  isProviderAvailable,
  CircuitBreakerOpenError,
  type ProviderName,
} from '@/lib/resilience';
import { withRetry, type RetryConfig } from '@/lib/resilience';

const logger = createLogger('llm-gateway');

// Gateway configuration
interface GatewayConfig {
  baseUrl: string;
  timeout: number;
  requireGateway: boolean;
}

let gatewayConfig: GatewayConfig | null = null;
let gatewayInitialized = false;
let gatewayAvailableAtStartup = false;

function getGatewayConfig(): GatewayConfig {
  if (!gatewayConfig) {
    const baseUrl = process.env.LITELLM_GATEWAY_URL ?? 'http://localhost:8001';
    const timeout = parseInt(process.env.LITELLM_TIMEOUT ?? '120000', 10);
    const requireGateway = process.env.REQUIRE_LITELLM_GATEWAY === 'true';
    gatewayConfig = { baseUrl, timeout, requireGateway };
  }
  return gatewayConfig;
}

export function resetGatewayConfig(): void {
  gatewayConfig = null;
  gatewayInitialized = false;
  gatewayAvailableAtStartup = false;
}

/**
 * Error thrown when gateway is required but not available at startup.
 */
export class GatewayStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayStartupError';
  }
}

/**
 * Initialize the gateway and verify connectivity.
 *
 * This should be called during app startup. If REQUIRE_LITELLM_GATEWAY=true
 * and the gateway is unreachable, this will throw a GatewayStartupError.
 *
 * @throws {GatewayStartupError} If gateway is required but unreachable
 */
export async function initializeGateway(): Promise<{
  available: boolean;
  url: string;
  providers?: string[];
}> {
  const config = getGatewayConfig();

  logger.info(`Initializing LiteLLM gateway at ${config.baseUrl}...`);

  try {
    const health = await checkGatewayHealth();
    const providers = Object.entries(health.providers)
      .filter(([, available]) => available)
      .map(([provider]) => provider);

    gatewayInitialized = true;
    gatewayAvailableAtStartup = true;

    logger.info(
      `LiteLLM gateway connected. Available providers: ${providers.join(', ') || 'none'}`
    );

    return {
      available: true,
      url: config.baseUrl,
      providers,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    gatewayInitialized = true;
    gatewayAvailableAtStartup = false;

    if (config.requireGateway) {
      const message = `LiteLLM gateway is required but unreachable at ${config.baseUrl}: ${errorMsg}`;
      logger.error(message);
      throw new GatewayStartupError(message);
    }

    logger.warn(
      `LiteLLM gateway not available at ${config.baseUrl}: ${errorMsg}. Will use direct API calls.`
    );

    return {
      available: false,
      url: config.baseUrl,
    };
  }
}

/**
 * Check if the gateway was available at startup.
 * Call initializeGateway() first during app startup.
 */
export function wasGatewayAvailableAtStartup(): boolean {
  return gatewayAvailableAtStartup;
}

/**
 * Check if the gateway has been initialized.
 */
export function isGatewayInitialized(): boolean {
  return gatewayInitialized;
}

/**
 * Ensure gateway is initialized. Throws if not.
 * Use this as a guard in functions that require gateway initialization.
 */
export function requireGatewayInitialized(): void {
  if (!gatewayInitialized) {
    throw new GatewayStartupError(
      'LiteLLM gateway has not been initialized. Call initializeGateway() during app startup.'
    );
  }
}

// Request/Response types matching Python server
export interface GatewayCompletionRequest {
  model: string;
  messages: GatewayMessage[];
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GatewayCompletionResponse {
  content: string;
  model: string;
  usage: GatewayUsage;
  stop_reason: string | null;
}

export interface GatewayUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface GatewayHealthResponse {
  status: string;
  providers: Record<string, boolean>;
}

// Error types
export class GatewayError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public detail?: string
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export class GatewayConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayConnectionError';
  }
}

// Model mapping for LiteLLM format
const MODEL_MAP: Record<AnthropicModel, string> = {
  haiku: 'claude-3-5-haiku-20241022',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

// Fallback chain configuration
export interface FallbackConfig {
  primary: string;
  fallbacks: string[];
}

const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  primary: MODEL_MAP.sonnet,
  fallbacks: ['gpt-4o'],
};

export function getModelId(model: AnthropicModel): string {
  return MODEL_MAP[model];
}

function getProviderFromModel(model: string): ProviderName {
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('gpt')) return 'openai';
  return 'litellm';
}

const DEFAULT_RETRY_CONFIG: Partial<RetryConfig> = {
  maxAttempts: 2,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

async function fetchFromGateway<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const config = getGatewayConfig();
  const url = `${config.baseUrl}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      let detail: string | undefined;
      try {
        const errorBody = (await response.json()) as { detail?: string };
        detail = errorBody.detail;
      } catch {
        // Ignore JSON parse errors
      }
      throw new GatewayError(`Gateway request failed: ${response.status}`, response.status, detail);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof GatewayError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GatewayConnectionError(`Gateway request timed out after ${config.timeout}ms`);
    }
    throw new GatewayConnectionError(
      `Failed to connect to gateway: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check gateway health and provider availability.
 */
export async function checkGatewayHealth(): Promise<GatewayHealthResponse> {
  return fetchFromGateway<GatewayHealthResponse>('/health');
}

/**
 * Check if the gateway is reachable.
 */
export async function isGatewayAvailable(): Promise<boolean> {
  try {
    await checkGatewayHealth();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a chat completion via the gateway with circuit breaker and retry.
 */
export async function createGatewayCompletion(
  request: GatewayCompletionRequest
): Promise<GatewayCompletionResponse> {
  const provider = getProviderFromModel(request.model);
  const circuitBreaker = getProviderCircuitBreaker(provider);

  if (!isProviderAvailable(provider)) {
    circuitBreaker.recordRejected();
    throw new CircuitBreakerOpenError(
      `Circuit breaker for provider "${provider}" is OPEN. Model "${request.model}" unavailable.`,
      `provider:${provider}`
    );
  }

  const operation = async (): Promise<GatewayCompletionResponse> => {
    return fetchFromGateway<GatewayCompletionResponse>('/completion', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  };

  const retryResult = await withRetry(operation, DEFAULT_RETRY_CONFIG, (error) => {
    if (error instanceof GatewayConnectionError) return true;
    if (error instanceof GatewayError && error.statusCode >= 500) return true;
    if (error instanceof GatewayError && error.statusCode === 429) return true;
    return false;
  });

  if (retryResult.success && retryResult.result) {
    circuitBreaker.recordSuccess();
    return retryResult.result;
  }

  circuitBreaker.recordFailure();
  throw retryResult.error ?? new GatewayError('Unknown error after retries', 500);
}

/**
 * Completion options matching existing Anthropic client interface.
 */
export interface GatewayCompletionOptions {
  model: AnthropicModel;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

/**
 * Completion result matching existing Anthropic client interface.
 */
export interface GatewayCompletionResult {
  content: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  stopReason: string | null;
  modelUsed: string;
}

/**
 * Create a completion using the gateway with API matching the Anthropic client.
 *
 * This function provides a drop-in replacement for the existing Anthropic client's
 * createCompletion function, but routes through the LiteLLM gateway.
 */
export async function completion(
  prompt: string,
  options: GatewayCompletionOptions
): Promise<GatewayCompletionResult> {
  const messages: GatewayMessage[] = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }

  messages.push({ role: 'user', content: prompt });

  const response = await createGatewayCompletion({
    model: getModelId(options.model),
    messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stop: options.stopSequences,
  });

  return {
    content: response.content,
    tokenUsage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.total_tokens,
    },
    stopReason: response.stop_reason,
    modelUsed: response.model,
  };
}

/**
 * Create a conversation completion using the gateway.
 */
export async function conversationCompletion(
  messages: GatewayMessage[],
  options: GatewayCompletionOptions
): Promise<GatewayCompletionResult> {
  const allMessages: GatewayMessage[] = [];

  if (options.systemPrompt) {
    allMessages.push({ role: 'system', content: options.systemPrompt });
  }

  allMessages.push(...messages);

  const response = await createGatewayCompletion({
    model: getModelId(options.model),
    messages: allMessages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stop: options.stopSequences,
  });

  return {
    content: response.content,
    tokenUsage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.total_tokens,
    },
    stopReason: response.stop_reason,
    modelUsed: response.model,
  };
}

/**
 * Create a completion with automatic fallback to alternative providers.
 *
 * Tries the primary model first, then falls back to alternatives if it fails.
 */
export async function completionWithFallback(
  prompt: string,
  options: GatewayCompletionOptions,
  fallbackConfig: FallbackConfig = DEFAULT_FALLBACK_CONFIG
): Promise<GatewayCompletionResult & { usedFallback: boolean; attemptedModels: string[] }> {
  const attemptedModels: string[] = [];
  const primaryModel = getModelId(options.model);

  // Try primary model first
  attemptedModels.push(primaryModel);
  try {
    const result = await completion(prompt, options);
    return { ...result, usedFallback: false, attemptedModels };
  } catch (error) {
    // Log the error but continue to fallback
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    // eslint-disable-next-line no-console
    console.warn(`Primary model ${primaryModel} failed: ${errorMsg}. Trying fallbacks...`);
  }

  // Try fallback models
  for (const fallbackModel of fallbackConfig.fallbacks) {
    attemptedModels.push(fallbackModel);
    try {
      const messages: GatewayMessage[] = [];
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await createGatewayCompletion({
        model: fallbackModel,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        stop: options.stopSequences,
      });

      return {
        content: response.content,
        tokenUsage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        },
        stopReason: response.stop_reason,
        modelUsed: response.model,
        usedFallback: true,
        attemptedModels,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      // eslint-disable-next-line no-console
      console.warn(`Fallback model ${fallbackModel} failed: ${errorMsg}`);
    }
  }

  // All models failed
  throw new GatewayError(
    `All models failed. Attempted: ${attemptedModels.join(', ')}`,
    503,
    'No available providers could complete the request'
  );
}

/**
 * Get list of available providers from the gateway.
 */
export async function getAvailableProviders(): Promise<string[]> {
  const health = await checkGatewayHealth();
  return Object.entries(health.providers)
    .filter(([, available]) => available)
    .map(([provider]) => provider);
}

// ============================================================================
// Task-Based Fallback Chain API
// ============================================================================

/**
 * Fallback attempt result for logging and debugging.
 */
export interface FallbackAttempt {
  model: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

/**
 * Extended result from task-based fallback completion.
 */
export interface TaskCompletionResult extends GatewayCompletionResult {
  taskType: TaskType;
  usedFallback: boolean;
  attempts: FallbackAttempt[];
  primaryModel: string;
  finalModel: string;
}

/**
 * Options for task-based completion with fallback.
 */
export interface TaskCompletionOptions {
  taskType: TaskType;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

/**
 * Create a completion using task-based routing with automatic fallback chain.
 *
 * This is the primary API for LLM completions. It:
 * 1. Determines the primary model based on task type (from config.ts)
 * 2. Builds a fallback chain considering API key availability
 * 3. Tries each model in sequence until one succeeds
 * 4. Returns detailed attempt information for logging
 *
 * @example
 * ```ts
 * const result = await completionForTask('What is TypeScript?', {
 *   taskType: 'generation',
 *   systemPrompt: 'You are a helpful assistant.',
 * });
 * console.log(result.content);
 * console.log(`Used: ${result.finalModel}, fallback: ${result.usedFallback}`);
 * ```
 */
export async function completionForTask(
  prompt: string,
  options: TaskCompletionOptions
): Promise<TaskCompletionResult> {
  const { taskType, systemPrompt, maxTokens, temperature, stopSequences } = options;
  const taskConfig = getModelForTask(taskType);
  const fallbackChain = buildFallbackChain(taskType);

  if (fallbackChain.length === 0) {
    throw new GatewayError(
      `No available models for task type "${taskType}". Check API key configuration.`,
      503,
      'No models available in fallback chain'
    );
  }

  const attempts: FallbackAttempt[] = [];
  const primaryModel = taskConfig.primary;

  for (let i = 0; i < fallbackChain.length; i++) {
    const model = fallbackChain[i];
    const startTime = Date.now();

    try {
      const messages: GatewayMessage[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await createGatewayCompletion({
        model,
        messages,
        max_tokens: maxTokens ?? taskConfig.maxTokens,
        temperature: temperature ?? taskConfig.temperature,
        stop: stopSequences,
      });

      attempts.push({
        model,
        success: true,
        durationMs: Date.now() - startTime,
      });

      return {
        content: response.content,
        tokenUsage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        },
        stopReason: response.stop_reason,
        modelUsed: response.model,
        taskType,
        usedFallback: i > 0,
        attempts,
        primaryModel,
        finalModel: model,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      attempts.push({
        model,
        success: false,
        error: errorMsg,
        durationMs: Date.now() - startTime,
      });

      // eslint-disable-next-line no-console
      console.warn(`[LiteLLM] Model ${model} failed for ${taskType}: ${errorMsg}`);

      // Continue to next fallback
    }
  }

  // All models in chain failed
  const attemptedModels = attempts.map((a) => a.model).join(', ');
  throw new GatewayError(
    `All models in fallback chain failed for task "${taskType}". Attempted: ${attemptedModels}`,
    503,
    `Fallback chain exhausted. Errors: ${attempts.map((a) => `${a.model}: ${a.error}`).join('; ')}`
  );
}

/**
 * Create a conversation completion using task-based routing with automatic fallback.
 */
export async function conversationForTask(
  messages: GatewayMessage[],
  options: TaskCompletionOptions
): Promise<TaskCompletionResult> {
  const { taskType, systemPrompt, maxTokens, temperature, stopSequences } = options;
  const taskConfig = getModelForTask(taskType);
  const fallbackChain = buildFallbackChain(taskType);

  if (fallbackChain.length === 0) {
    throw new GatewayError(
      `No available models for task type "${taskType}". Check API key configuration.`,
      503,
      'No models available in fallback chain'
    );
  }

  const attempts: FallbackAttempt[] = [];
  const primaryModel = taskConfig.primary;

  for (let i = 0; i < fallbackChain.length; i++) {
    const model = fallbackChain[i];
    const startTime = Date.now();

    try {
      const allMessages: GatewayMessage[] = [];
      if (systemPrompt) {
        allMessages.push({ role: 'system', content: systemPrompt });
      }
      allMessages.push(...messages);

      const response = await createGatewayCompletion({
        model,
        messages: allMessages,
        max_tokens: maxTokens ?? taskConfig.maxTokens,
        temperature: temperature ?? taskConfig.temperature,
        stop: stopSequences,
      });

      attempts.push({
        model,
        success: true,
        durationMs: Date.now() - startTime,
      });

      return {
        content: response.content,
        tokenUsage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        },
        stopReason: response.stop_reason,
        modelUsed: response.model,
        taskType,
        usedFallback: i > 0,
        attempts,
        primaryModel,
        finalModel: model,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      attempts.push({
        model,
        success: false,
        error: errorMsg,
        durationMs: Date.now() - startTime,
      });

      // eslint-disable-next-line no-console
      console.warn(`[LiteLLM] Model ${model} failed for ${taskType}: ${errorMsg}`);
    }
  }

  const attemptedModels = attempts.map((a) => a.model).join(', ');
  throw new GatewayError(
    `All models in fallback chain failed for task "${taskType}". Attempted: ${attemptedModels}`,
    503,
    `Fallback chain exhausted. Errors: ${attempts.map((a) => `${a.model}: ${a.error}`).join('; ')}`
  );
}

/**
 * Get the configured fallback chain for a task type.
 * Useful for debugging or displaying to users.
 */
export function getFallbackChainForTask(taskType: TaskType): ModelId[] {
  return buildFallbackChain(taskType);
}

/**
 * Format fallback attempts for logging.
 */
export function formatFallbackAttempts(attempts: FallbackAttempt[]): string {
  return attempts
    .map((a, i) => {
      const status = a.success ? '✓' : '✗';
      const error = a.error ? ` (${a.error})` : '';
      return `  ${i + 1}. ${status} ${a.model} [${a.durationMs}ms]${error}`;
    })
    .join('\n');
}
