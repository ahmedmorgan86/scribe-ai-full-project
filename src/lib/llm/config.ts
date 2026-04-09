/**
 * LiteLLM Model Routing Configuration
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR MODEL CONFIGURATION          ║
 * ║                                                                            ║
 * ║  Python workers/langgraph/config.py MUST mirror these exact values.       ║
 * ║  Run `npm run validate:llm-config` to verify consistency.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Configures model selection based on task type:
 * - Fast/Cheap: gpt-4o-mini for classification, parsing, quick decisions
 * - Quality: claude-sonnet-4-20250514 for content generation (primary)
 * - Fallback: gpt-4o when Claude fails or times out
 */

// Model identifiers used by LiteLLM
export const MODELS = {
  // Fast/Cheap tier - quick tasks where cost matters more than quality
  GPT_4O_MINI: 'gpt-4o-mini',

  // Quality tier - content generation where quality is paramount
  CLAUDE_SONNET: 'claude-sonnet-4-20250514',
  CLAUDE_OPUS: 'claude-opus-4-20250514',
  CLAUDE_HAIKU: 'claude-3-5-haiku-20241022',

  // Fallback tier - reliable alternative when primary fails
  GPT_4O: 'gpt-4o',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

// Task types that determine model selection
export type TaskType =
  | 'classification' // Quick categorization tasks
  | 'parsing' // Extracting structured data
  | 'evaluation' // Scoring, quick assessments
  | 'generation' // Content creation (quality matters)
  | 'analysis' // Deep analysis requiring reasoning
  | 'rewrite'; // Content improvement

// Model tier configuration
export interface ModelTier {
  primary: ModelId;
  fallbacks: ModelId[];
  maxTokens: number;
  temperature: number;
}

// Model routing configuration per task type
export const MODEL_ROUTING: Record<TaskType, ModelTier> = {
  classification: {
    primary: MODELS.GPT_4O_MINI,
    fallbacks: [MODELS.CLAUDE_HAIKU],
    maxTokens: 256,
    temperature: 0.1,
  },
  parsing: {
    primary: MODELS.GPT_4O_MINI,
    fallbacks: [MODELS.CLAUDE_HAIKU],
    maxTokens: 1024,
    temperature: 0.0,
  },
  evaluation: {
    primary: MODELS.GPT_4O_MINI,
    fallbacks: [MODELS.CLAUDE_HAIKU, MODELS.GPT_4O],
    maxTokens: 512,
    temperature: 0.2,
  },
  generation: {
    primary: MODELS.CLAUDE_SONNET,
    fallbacks: [MODELS.GPT_4O, MODELS.CLAUDE_OPUS],
    maxTokens: 4096,
    temperature: 0.7,
  },
  analysis: {
    primary: MODELS.CLAUDE_SONNET,
    fallbacks: [MODELS.GPT_4O],
    maxTokens: 2048,
    temperature: 0.3,
  },
  rewrite: {
    primary: MODELS.CLAUDE_SONNET,
    fallbacks: [MODELS.GPT_4O],
    maxTokens: 4096,
    temperature: 0.5,
  },
};

// Cost per million tokens (approximate, for budget estimation)
export const MODEL_COSTS: Record<ModelId, { input: number; output: number }> = {
  [MODELS.GPT_4O_MINI]: { input: 0.15, output: 0.6 },
  [MODELS.GPT_4O]: { input: 2.5, output: 10.0 },
  [MODELS.CLAUDE_HAIKU]: { input: 0.25, output: 1.25 },
  [MODELS.CLAUDE_SONNET]: { input: 3.0, output: 15.0 },
  [MODELS.CLAUDE_OPUS]: { input: 15.0, output: 75.0 },
};

/**
 * Get the model configuration for a given task type.
 */
export function getModelForTask(taskType: TaskType): ModelTier {
  return MODEL_ROUTING[taskType];
}

/**
 * Get the primary model ID for a task type.
 */
export function getPrimaryModel(taskType: TaskType): ModelId {
  return MODEL_ROUTING[taskType].primary;
}

/**
 * Get fallback models for a task type.
 */
export function getFallbackModels(taskType: TaskType): ModelId[] {
  return MODEL_ROUTING[taskType].fallbacks;
}

/**
 * Estimate cost for a completion based on model and token counts.
 */
export function estimateCost(model: ModelId, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model];
  return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;
}

/**
 * Check if a model is available (based on environment configuration).
 */
export function isModelAvailable(model: ModelId): boolean {
  // Claude models require ANTHROPIC_API_KEY
  if (model.startsWith('claude')) {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }
  // OpenAI models require OPENAI_API_KEY
  if (model.startsWith('gpt')) {
    return Boolean(process.env.OPENAI_API_KEY);
  }
  return false;
}

/**
 * Get all available models based on configured API keys.
 */
export function getAvailableModels(): ModelId[] {
  return Object.values(MODELS).filter(isModelAvailable);
}

/**
 * Get the best available model for a task, considering API key availability.
 */
export function getBestAvailableModel(taskType: TaskType): ModelId | null {
  const config = MODEL_ROUTING[taskType];

  // Try primary first
  if (isModelAvailable(config.primary)) {
    return config.primary;
  }

  // Try fallbacks in order
  for (const fallback of config.fallbacks) {
    if (isModelAvailable(fallback)) {
      return fallback;
    }
  }

  return null;
}

/**
 * Build a fallback chain for a task type, filtering by availability.
 */
export function buildFallbackChain(taskType: TaskType): ModelId[] {
  const config = MODEL_ROUTING[taskType];
  const chain: ModelId[] = [];

  if (isModelAvailable(config.primary)) {
    chain.push(config.primary);
  }

  for (const fallback of config.fallbacks) {
    if (isModelAvailable(fallback)) {
      chain.push(fallback);
    }
  }

  return chain;
}

/**
 * Export the complete LLM configuration as a JSON-serializable object.
 * Used by validation scripts to ensure Python config mirrors TypeScript.
 */
export function getConfigAsJson(): {
  models: Record<string, string>;
  routing: Record<
    string,
    { primary: string; fallbacks: string[]; maxTokens: number; temperature: number }
  >;
  costs: Record<string, { input: number; output: number }>;
} {
  return {
    models: MODELS,
    routing: Object.fromEntries(
      Object.entries(MODEL_ROUTING).map(([key, tier]) => [
        key,
        {
          primary: tier.primary,
          fallbacks: [...tier.fallbacks],
          maxTokens: tier.maxTokens,
          temperature: tier.temperature,
        },
      ])
    ),
    costs: MODEL_COSTS,
  };
}
