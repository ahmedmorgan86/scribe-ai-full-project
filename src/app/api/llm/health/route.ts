import { NextResponse } from 'next/server';
import { checkGatewayHealth, isGatewayAvailable, GatewayConnectionError } from '@/lib/llm/gateway';
import { MODELS, isModelAvailable, getAvailableModels, type ModelId } from '@/lib/llm/config';
import {
  getProviderCircuitStatuses,
  type CircuitBreakerStatus,
  type ProviderName,
} from '@/lib/resilience';

export interface ProviderStatus {
  name: string;
  available: boolean;
  models: string[];
  configuredViaEnv: boolean;
  circuitBreaker?: CircuitBreakerStatus;
}

export interface LLMHealthResponse {
  status: 'healthy' | 'degraded' | 'unavailable';
  gatewayEnabled: boolean;
  gatewayReachable: boolean;
  gatewayUrl: string;
  providers: ProviderStatus[];
  availableModels: ModelId[];
  circuitBreakers: Record<ProviderName, CircuitBreakerStatus>;
  timestamp: string;
}

const PROVIDER_MODELS: Record<string, ModelId[]> = {
  anthropic: [MODELS.CLAUDE_HAIKU, MODELS.CLAUDE_SONNET, MODELS.CLAUDE_OPUS],
  openai: [MODELS.GPT_4O_MINI, MODELS.GPT_4O],
};

/**
 * Determine if LiteLLM gateway is enabled.
 * Respects LLM_ROUTING_MODE (preferred) or USE_LITELLM_GATEWAY (deprecated).
 */
function isGatewayEnabled(): boolean {
  const routingMode = process.env.LLM_ROUTING_MODE?.toLowerCase();
  if (routingMode === 'gateway') return true;
  if (routingMode === 'direct') return false;
  return process.env.USE_LITELLM_GATEWAY === 'true';
}

export async function GET(): Promise<NextResponse<LLMHealthResponse | { error: string }>> {
  try {
    const gatewayEnabled = isGatewayEnabled();
    const gatewayUrl = process.env.LITELLM_GATEWAY_URL ?? 'http://localhost:8001';

    const availableModels = getAvailableModels();
    const circuitBreakers = getProviderCircuitStatuses();

    const providers: ProviderStatus[] = [];

    // Anthropic provider
    const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
    const anthropicModels = PROVIDER_MODELS.anthropic.filter(isModelAvailable);
    const anthropicCircuitOpen = circuitBreakers.anthropic.state === 'OPEN';
    providers.push({
      name: 'anthropic',
      available: anthropicConfigured && anthropicModels.length > 0 && !anthropicCircuitOpen,
      models: anthropicModels,
      configuredViaEnv: anthropicConfigured,
      circuitBreaker: circuitBreakers.anthropic,
    });

    // OpenAI provider
    const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
    const openaiModels = PROVIDER_MODELS.openai.filter(isModelAvailable);
    const openaiCircuitOpen = circuitBreakers.openai.state === 'OPEN';
    providers.push({
      name: 'openai',
      available: openaiConfigured && openaiModels.length > 0 && !openaiCircuitOpen,
      models: openaiModels,
      configuredViaEnv: openaiConfigured,
      circuitBreaker: circuitBreakers.openai,
    });

    let gatewayReachable = false;

    if (gatewayEnabled) {
      try {
        gatewayReachable = await isGatewayAvailable();

        if (gatewayReachable) {
          const health = await checkGatewayHealth();
          // Merge gateway provider status with our local config
          for (const provider of providers) {
            if (provider.name in health.providers) {
              // Gateway overrides local availability if it reports the provider as unavailable
              if (!health.providers[provider.name]) {
                provider.available = false;
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof GatewayConnectionError) {
          gatewayReachable = false;
        }
      }
    }

    // Determine overall status
    const availableProviderCount = providers.filter((p) => p.available).length;
    let status: LLMHealthResponse['status'];

    if (availableProviderCount === 0) {
      status = 'unavailable';
    } else if (availableProviderCount < providers.length) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    // If gateway is enabled but not reachable, mark as degraded
    if (gatewayEnabled && !gatewayReachable && status === 'healthy') {
      status = 'degraded';
    }

    // Check if any circuit is open - degrade status
    const anyCircuitOpen = Object.values(circuitBreakers).some((cb) => cb.state === 'OPEN');
    if (anyCircuitOpen && status === 'healthy') {
      status = 'degraded';
    }

    const response: LLMHealthResponse = {
      status,
      gatewayEnabled,
      gatewayReachable,
      gatewayUrl,
      providers,
      availableModels,
      circuitBreakers,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to check LLM health: ${errorMessage}` },
      { status: 500 }
    );
  }
}
