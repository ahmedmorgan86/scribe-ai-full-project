/**
 * LLM Gateway Module
 *
 * Exports for the LiteLLM gateway integration.
 */

export {
  // Client functions
  checkGatewayHealth,
  isGatewayAvailable,
  createGatewayCompletion,
  completion,
  conversationCompletion,
  completionWithFallback,
  getAvailableProviders,
  getModelId,
  resetGatewayConfig,
  // Types
  type GatewayCompletionRequest,
  type GatewayCompletionResponse,
  type GatewayCompletionOptions,
  type GatewayCompletionResult,
  type GatewayHealthResponse,
  type GatewayMessage,
  type GatewayUsage,
  type FallbackConfig,
  // Errors
  GatewayError,
  GatewayConnectionError,
} from './gateway';

// Model routing configuration
export {
  MODELS,
  MODEL_ROUTING,
  MODEL_COSTS,
  getModelForTask,
  getPrimaryModel,
  getFallbackModels,
  estimateCost,
  isModelAvailable,
  getAvailableModels,
  getBestAvailableModel,
  buildFallbackChain,
  type ModelId,
  type TaskType,
  type ModelTier,
} from './config';
