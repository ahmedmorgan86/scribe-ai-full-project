import type { AnthropicModel, TokenUsage } from '@/types';
import {
  createCostEntry,
  isBudgetExceeded,
  checkBudgetLimit,
  BudgetLimits,
  BudgetStatus,
} from '@/db/models/costs';
import {
  calculateCost,
  MODEL_INPUT_COST_PER_MILLION,
  MODEL_OUTPUT_COST_PER_MILLION,
} from './models';
import {
  createCompletion,
  createConversationCompletion,
  CompletionOptions,
  CompletionResult,
  ConversationMessage,
} from './client';
import { estimateTokenCount } from './tokens';
import { withRetry, parseAnthropicError, AnthropicApiError, RetryOptions } from './errors';
import { createLogger } from '@/lib/logger';
import { ensureOperationAllowed, haltOperationsForApi } from '@/lib/costs/operations-halt';

const logger = createLogger('anthropic:cost-tracking');

export {
  AnthropicApiError,
  RateLimitError,
  OverloadedError,
  isRetryableError,
  formatErrorForDisplay,
} from './errors';
export type { AnthropicErrorType, RetryOptions } from './errors';

export { OperationHaltedError } from '@/lib/costs/operations-halt';

export class BudgetExceededError extends Error {
  public readonly apiName: string;
  public readonly period: 'daily' | 'monthly';
  public readonly used: number;
  public readonly limit: number;
  public readonly estimatedCost: number;

  constructor(
    apiName: string,
    period: 'daily' | 'monthly',
    used: number,
    limit: number,
    estimatedCost: number
  ) {
    super(
      `Budget exceeded: ${apiName} ${period} limit. Used: $${used.toFixed(4)}, Limit: $${limit.toFixed(2)}, Estimated cost: $${estimatedCost.toFixed(4)}`
    );
    this.name = 'BudgetExceededError';
    this.apiName = apiName;
    this.period = period;
    this.used = used;
    this.limit = limit;
    this.estimatedCost = estimatedCost;
  }
}

export interface TrackedCompletionResult extends CompletionResult {
  costUsd: number;
  costEntryId: number;
}

function getBudgetLimitsFromEnv(): BudgetLimits {
  const dailyLimit = process.env.ANTHROPIC_DAILY_BUDGET_USD;
  const monthlyLimit = process.env.ANTHROPIC_MONTHLY_BUDGET_USD;

  return {
    anthropicDailyUsd: dailyLimit ? parseFloat(dailyLimit) : undefined,
    anthropicMonthlyUsd: monthlyLimit ? parseFloat(monthlyLimit) : undefined,
  };
}

function estimateCost(model: AnthropicModel, inputText: string, maxOutputTokens: number): number {
  const estimatedInputTokens = estimateTokenCount(inputText);
  const inputCost = (estimatedInputTokens / 1_000_000) * MODEL_INPUT_COST_PER_MILLION[model];
  const outputCost = (maxOutputTokens / 1_000_000) * MODEL_OUTPUT_COST_PER_MILLION[model];
  return inputCost + outputCost;
}

function checkBudgetBeforeCall(model: AnthropicModel, inputText: string, maxTokens: number): void {
  ensureOperationAllowed('anthropic');

  const limits = getBudgetLimitsFromEnv();

  if (limits.anthropicDailyUsd === undefined && limits.anthropicMonthlyUsd === undefined) {
    return;
  }

  const estimatedCost = estimateCost(model, inputText, maxTokens);

  if (isBudgetExceeded('anthropic', estimatedCost, limits)) {
    const statuses: BudgetStatus[] = checkBudgetLimit('anthropic', estimatedCost, limits);
    const exceededStatus = statuses.find((s) => s.exceeded);

    if (exceededStatus) {
      haltOperationsForApi(
        'anthropic',
        exceededStatus.period,
        'budget_exhausted',
        exceededStatus.used,
        exceededStatus.limit
      );

      throw new BudgetExceededError(
        'anthropic',
        exceededStatus.period,
        exceededStatus.used,
        exceededStatus.limit,
        estimatedCost
      );
    }
  }
}

function logCostToDatabase(
  model: AnthropicModel,
  usage: TokenUsage
): { costUsd: number; costEntryId: number } {
  const costUsd = calculateCost(model, usage.inputTokens, usage.outputTokens);

  const entry = createCostEntry({
    apiName: 'anthropic',
    tokensUsed: usage.totalTokens,
    costUsd,
  });

  return { costUsd, costEntryId: entry.id };
}

const DEFAULT_MAX_TOKENS = 4096;

const DEFAULT_RETRY_OPTIONS: Partial<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
};

export interface TrackedCompletionOptions {
  retryOptions?: Partial<RetryOptions>;
  skipRetry?: boolean;
}

export async function trackedCompletion(
  prompt: string,
  options: CompletionOptions,
  trackingOptions: TrackedCompletionOptions = {}
): Promise<TrackedCompletionResult> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const fullInput = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;

  checkBudgetBeforeCall(options.model, fullInput, maxTokens);

  const { retryOptions = DEFAULT_RETRY_OPTIONS, skipRetry = false } = trackingOptions;

  logger.debug('Starting API call', {
    model: options.model,
    estimatedInputTokens: estimateTokenCount(fullInput),
    maxOutputTokens: maxTokens,
  });

  try {
    const result = skipRetry
      ? await createCompletion(prompt, options)
      : await withRetry(() => createCompletion(prompt, options), retryOptions);

    const { costUsd, costEntryId } = logCostToDatabase(options.model, result.usage);

    logger.info('API call completed', {
      model: options.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd,
    });

    return {
      ...result,
      costUsd,
      costEntryId,
    };
  } catch (error) {
    const apiError = error instanceof AnthropicApiError ? error : parseAnthropicError(error);

    logger.error('API call failed', apiError, {
      model: options.model,
      errorType: apiError.type,
      statusCode: apiError.statusCode,
      isRetryable: apiError.isRetryable,
    });

    throw apiError;
  }
}

export async function trackedConversationCompletion(
  messages: ConversationMessage[],
  options: CompletionOptions,
  trackingOptions: TrackedCompletionOptions = {}
): Promise<TrackedCompletionResult> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const fullInput = messages.map((m) => m.content).join('\n');
  const inputWithSystem = options.systemPrompt
    ? `${options.systemPrompt}\n\n${fullInput}`
    : fullInput;

  checkBudgetBeforeCall(options.model, inputWithSystem, maxTokens);

  const { retryOptions = DEFAULT_RETRY_OPTIONS, skipRetry = false } = trackingOptions;

  logger.debug('Starting conversation API call', {
    model: options.model,
    messageCount: messages.length,
    estimatedInputTokens: estimateTokenCount(inputWithSystem),
    maxOutputTokens: maxTokens,
  });

  try {
    const result = skipRetry
      ? await createConversationCompletion(messages, options)
      : await withRetry(() => createConversationCompletion(messages, options), retryOptions);

    const { costUsd, costEntryId } = logCostToDatabase(options.model, result.usage);

    logger.info('Conversation API call completed', {
      model: options.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd,
    });

    return {
      ...result,
      costUsd,
      costEntryId,
    };
  } catch (error) {
    const apiError = error instanceof AnthropicApiError ? error : parseAnthropicError(error);

    logger.error('Conversation API call failed', apiError, {
      model: options.model,
      messageCount: messages.length,
      errorType: apiError.type,
      statusCode: apiError.statusCode,
      isRetryable: apiError.isRetryable,
    });

    throw apiError;
  }
}
