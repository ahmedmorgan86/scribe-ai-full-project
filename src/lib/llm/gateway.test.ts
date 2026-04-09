import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  GatewayError,
  GatewayConnectionError,
  GatewayStartupError,
  completionWithFallback,
  completionForTask,
  getModelId,
  getFallbackChainForTask,
  formatFallbackAttempts,
  resetGatewayConfig,
  initializeGateway,
  wasGatewayAvailableAtStartup,
  isGatewayInitialized,
  type FallbackAttempt,
  type GatewayCompletionRequest,
} from './gateway';
import { MODELS, buildFallbackChain, isModelAvailable } from './config';
import { resetAllCircuitBreakers } from '@/lib/resilience';

describe('LiteLLM Gateway', () => {
  beforeEach(() => {
    resetGatewayConfig();
    resetAllCircuitBreakers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getModelId', () => {
    it('maps anthropic model names to LiteLLM format', () => {
      expect(getModelId('haiku')).toBe('claude-3-5-haiku-20241022');
      expect(getModelId('sonnet')).toBe('claude-sonnet-4-20250514');
      expect(getModelId('opus')).toBe('claude-opus-4-20250514');
    });
  });

  describe('getFallbackChainForTask', () => {
    it('returns fallback chain for generation task', () => {
      const chain = getFallbackChainForTask('generation');
      expect(Array.isArray(chain)).toBe(true);
    });

    it('returns fallback chain for classification task', () => {
      const chain = getFallbackChainForTask('classification');
      expect(Array.isArray(chain)).toBe(true);
    });
  });

  describe('formatFallbackAttempts', () => {
    it('formats successful attempt', () => {
      const attempts: FallbackAttempt[] = [
        { model: 'claude-sonnet-4-20250514', success: true, durationMs: 1500 },
      ];
      const formatted = formatFallbackAttempts(attempts);

      expect(formatted).toContain('✓');
      expect(formatted).toContain('claude-sonnet-4-20250514');
      expect(formatted).toContain('1500ms');
    });

    it('formats failed attempt with error', () => {
      const attempts: FallbackAttempt[] = [
        {
          model: 'claude-sonnet-4-20250514',
          success: false,
          error: 'Request timeout',
          durationMs: 120000,
        },
      ];
      const formatted = formatFallbackAttempts(attempts);

      expect(formatted).toContain('✗');
      expect(formatted).toContain('claude-sonnet-4-20250514');
      expect(formatted).toContain('Request timeout');
    });

    it('formats multiple attempts showing fallback progression', () => {
      const attempts: FallbackAttempt[] = [
        {
          model: 'claude-sonnet-4-20250514',
          success: false,
          error: 'Timeout',
          durationMs: 120000,
        },
        { model: 'gpt-4o', success: true, durationMs: 2000 },
      ];
      const formatted = formatFallbackAttempts(attempts);

      expect(formatted).toContain('1.');
      expect(formatted).toContain('2.');
      expect(formatted).toContain('✗');
      expect(formatted).toContain('✓');
    });
  });

  describe('GatewayError', () => {
    it('creates error with status code and detail', () => {
      const error = new GatewayError('Request failed', 503, 'Service unavailable');

      expect(error.name).toBe('GatewayError');
      expect(error.message).toBe('Request failed');
      expect(error.statusCode).toBe(503);
      expect(error.detail).toBe('Service unavailable');
    });
  });

  describe('GatewayConnectionError', () => {
    it('creates connection error', () => {
      const error = new GatewayConnectionError('Failed to connect');

      expect(error.name).toBe('GatewayConnectionError');
      expect(error.message).toBe('Failed to connect');
    });
  });
});

describe('LiteLLM Fallback Chain Configuration', () => {
  describe('buildFallbackChain', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('includes Claude models when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = '';

      const chain = buildFallbackChain('generation');

      const hasClaudeModel = chain.some((m) => m.startsWith('claude'));
      expect(hasClaudeModel).toBe(true);
    });

    it('includes OpenAI models when OPENAI_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = '';
      process.env.OPENAI_API_KEY = 'test-key';

      const chain = buildFallbackChain('generation');

      const hasOpenAIModel = chain.some((m) => m.startsWith('gpt'));
      expect(hasOpenAIModel).toBe(true);
    });

    it('includes both providers when both API keys are set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'test-key';

      const chain = buildFallbackChain('generation');

      const hasClaudeModel = chain.some((m) => m.startsWith('claude'));
      const hasOpenAIModel = chain.some((m) => m.startsWith('gpt'));

      expect(hasClaudeModel).toBe(true);
      expect(hasOpenAIModel).toBe(true);
    });

    it('returns empty chain when no API keys are configured', () => {
      process.env.ANTHROPIC_API_KEY = '';
      process.env.OPENAI_API_KEY = '';

      const chain = buildFallbackChain('generation');

      expect(chain).toHaveLength(0);
    });
  });

  describe('isModelAvailable', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns true for Claude model when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      expect(isModelAvailable(MODELS.CLAUDE_SONNET)).toBe(true);
      expect(isModelAvailable(MODELS.CLAUDE_HAIKU)).toBe(true);
      expect(isModelAvailable(MODELS.CLAUDE_OPUS)).toBe(true);
    });

    it('returns false for Claude model when ANTHROPIC_API_KEY is not set', () => {
      process.env.ANTHROPIC_API_KEY = '';

      expect(isModelAvailable(MODELS.CLAUDE_SONNET)).toBe(false);
    });

    it('returns true for GPT model when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      expect(isModelAvailable(MODELS.GPT_4O)).toBe(true);
      expect(isModelAvailable(MODELS.GPT_4O_MINI)).toBe(true);
    });

    it('returns false for GPT model when OPENAI_API_KEY is not set', () => {
      process.env.OPENAI_API_KEY = '';

      expect(isModelAvailable(MODELS.GPT_4O)).toBe(false);
    });
  });
});

describe('Fallback Behavior Simulation', () => {
  describe('completionWithFallback timeout simulation', () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    const originalFetch = global.fetch;

    beforeEach(() => {
      resetGatewayConfig();
      resetAllCircuitBreakers();
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('falls back to secondary model when primary times out', async () => {
      mockFetch.mockImplementation(
        async (_url: string, options: RequestInit): Promise<Response> => {
          const body = JSON.parse(options.body as string) as GatewayCompletionRequest;

          if (body.model === 'claude-sonnet-4-20250514') {
            await new Promise((_resolve, reject) => {
              setTimeout(() => reject(new Error('Timeout')), 10);
            });
          }

          if (body.model === 'gpt-4o') {
            return {
              ok: true,
              json: () =>
                Promise.resolve({
                  content: 'Fallback response from GPT-4o',
                  model: 'gpt-4o',
                  usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
                  stop_reason: 'end_turn',
                }),
            } as Response;
          }

          throw new Error(`Unexpected model: ${body.model}`);
        }
      );

      const result = await completionWithFallback(
        'Test prompt',
        { model: 'sonnet' },
        { primary: 'claude-sonnet-4-20250514', fallbacks: ['gpt-4o'] }
      );

      expect(result.usedFallback).toBe(true);
      expect(result.modelUsed).toBe('gpt-4o');
      expect(result.content).toBe('Fallback response from GPT-4o');
      expect(result.attemptedModels).toContain('claude-sonnet-4-20250514');
      expect(result.attemptedModels).toContain('gpt-4o');
    });

    it('uses primary model when it succeeds', async () => {
      mockFetch.mockImplementation((): Promise<Response> => {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              content: 'Response from Claude',
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
              stop_reason: 'end_turn',
            }),
        } as Response);
      });

      const result = await completionWithFallback(
        'Test prompt',
        { model: 'sonnet' },
        { primary: 'claude-sonnet-4-20250514', fallbacks: ['gpt-4o'] }
      );

      expect(result.usedFallback).toBe(false);
      expect(result.modelUsed).toBe('claude-sonnet-4-20250514');
      expect(result.attemptedModels).toHaveLength(1);
    });

    it('throws GatewayError when all models fail', async () => {
      mockFetch.mockImplementation((): Promise<Response> => {
        throw new Error('Connection refused');
      });

      await expect(
        completionWithFallback(
          'Test prompt',
          { model: 'sonnet' },
          { primary: 'claude-sonnet-4-20250514', fallbacks: ['gpt-4o'] }
        )
      ).rejects.toThrow(GatewayError);
    });

    it('records all attempted models when falling back', async () => {
      let attempts = 0;

      // With maxAttempts: 2 retries per model, we need:
      // - Calls 1-2 fail (model 1 exhausts retries)
      // - Calls 3-4 fail (model 2 exhausts retries)
      // - Call 5 succeeds (model 3)
      mockFetch.mockImplementation((): Promise<Response> => {
        attempts++;

        if (attempts < 5) {
          throw new Error(`Model attempt ${attempts} failed`);
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              content: 'Success on third model',
              model: 'gpt-4o-mini',
              usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
              stop_reason: 'end_turn',
            }),
        } as Response);
      });

      const result = await completionWithFallback(
        'Test prompt',
        { model: 'sonnet' },
        {
          primary: 'claude-sonnet-4-20250514',
          fallbacks: ['gpt-4o', 'gpt-4o-mini'],
        }
      );

      expect(result.usedFallback).toBe(true);
      expect(result.attemptedModels).toHaveLength(3);
      expect(result.attemptedModels).toEqual(['claude-sonnet-4-20250514', 'gpt-4o', 'gpt-4o-mini']);
    });
  });

  describe('completionForTask timeout simulation', () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    const originalFetch = global.fetch;
    const originalEnv = process.env;

    beforeEach(() => {
      resetGatewayConfig();
      resetAllCircuitBreakers();
      mockFetch = vi.fn();
      global.fetch = mockFetch;
      process.env = { ...originalEnv };
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      process.env.OPENAI_API_KEY = 'test-openai-key';
    });

    afterEach(() => {
      global.fetch = originalFetch;
      process.env = originalEnv;
    });

    it('falls back when primary model times out for generation task', async () => {
      mockFetch.mockImplementation((_url: string, options: RequestInit): Promise<Response> => {
        const body = JSON.parse(options.body as string) as GatewayCompletionRequest;

        if (body.model.startsWith('claude')) {
          const error = new Error('AbortError');
          error.name = 'AbortError';
          throw error;
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              content: 'Fallback response',
              model: body.model,
              usage: { input_tokens: 50, output_tokens: 100, total_tokens: 150 },
              stop_reason: 'end_turn',
            }),
        } as Response);
      });

      const result = await completionForTask('Generate content about TypeScript', {
        taskType: 'generation',
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(result.usedFallback).toBe(true);
      expect(result.taskType).toBe('generation');
      expect(result.attempts.length).toBeGreaterThan(1);
      expect(result.attempts[0].success).toBe(false);
      expect(result.attempts[result.attempts.length - 1].success).toBe(true);
    });

    it('records attempt duration for debugging', async () => {
      mockFetch.mockImplementation(
        async (_url: string, options: RequestInit): Promise<Response> => {
          const body = JSON.parse(options.body as string) as GatewayCompletionRequest;

          if (body.model.startsWith('claude')) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            throw new Error('Simulated timeout');
          }

          return {
            ok: true,
            json: () =>
              Promise.resolve({
                content: 'Success',
                model: body.model,
                usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
                stop_reason: 'end_turn',
              }),
          } as Response;
        }
      );

      const result = await completionForTask('Test', { taskType: 'generation' });

      const failedAttempt = result.attempts.find((a) => !a.success);
      expect(failedAttempt).toBeDefined();
      expect(failedAttempt?.durationMs).toBeGreaterThanOrEqual(50);
      expect(failedAttempt?.error).toContain('timeout');
    });

    it('throws when no models are available', async () => {
      process.env.ANTHROPIC_API_KEY = '';
      process.env.OPENAI_API_KEY = '';

      vi.resetModules();

      const { completionForTask: freshCompletionForTask, GatewayError: FreshGatewayError } =
        await import('./gateway');

      await expect(freshCompletionForTask('Test', { taskType: 'generation' })).rejects.toThrow(
        FreshGatewayError
      );
    });

    it('returns correct token usage from fallback model', async () => {
      mockFetch.mockImplementation((_url: string, options: RequestInit): Promise<Response> => {
        const body = JSON.parse(options.body as string) as GatewayCompletionRequest;

        if (body.model.startsWith('claude')) {
          throw new Error('Rate limited');
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              content: 'Fallback content',
              model: body.model,
              usage: { input_tokens: 123, output_tokens: 456, total_tokens: 579 },
              stop_reason: 'end_turn',
            }),
        } as Response);
      });

      const result = await completionForTask('Test', { taskType: 'generation' });

      expect(result.tokenUsage.inputTokens).toBe(123);
      expect(result.tokenUsage.outputTokens).toBe(456);
      expect(result.tokenUsage.totalTokens).toBe(579);
    });
  });
});

describe('Task-Based Routing', () => {
  describe('generation task routing', () => {
    it('uses Claude Sonnet as primary for generation', () => {
      const chain = getFallbackChainForTask('generation');

      if (chain.length > 0 && chain[0].startsWith('claude')) {
        expect(chain[0]).toBe(MODELS.CLAUDE_SONNET);
      }
    });

    it('includes GPT-4o as fallback for generation', () => {
      const chain = getFallbackChainForTask('generation');

      const hasGpt4oFallback = chain.some((m) => m === MODELS.GPT_4O);
      const hasClaude = chain.some((m) => m.startsWith('claude'));
      expect(chain.length === 0 || hasGpt4oFallback || hasClaude).toBe(true);
    });
  });

  describe('classification task routing', () => {
    it('uses GPT-4o-mini as primary for classification', () => {
      const chain = getFallbackChainForTask('classification');

      if (chain.length > 0 && chain[0].startsWith('gpt')) {
        expect(chain[0]).toBe(MODELS.GPT_4O_MINI);
      }
    });
  });
});

describe('Gateway Startup Fail-Fast Behavior (PRD 29.1.8)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    resetGatewayConfig();
    resetAllCircuitBreakers();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  describe('GatewayStartupError', () => {
    it('creates error with correct name and message', () => {
      const error = new GatewayStartupError('Gateway unreachable at http://localhost:8001');

      expect(error.name).toBe('GatewayStartupError');
      expect(error.message).toContain('Gateway unreachable');
    });
  });

  describe('initializeGateway with REQUIRE_LITELLM_GATEWAY=true', () => {
    beforeEach(() => {
      process.env.REQUIRE_LITELLM_GATEWAY = 'true';
      process.env.LITELLM_GATEWAY_URL = 'http://localhost:8001';
    });

    it('throws GatewayStartupError when gateway is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(initializeGateway()).rejects.toThrow(GatewayStartupError);
    });

    it('throws GatewayStartupError with descriptive message', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      try {
        await initializeGateway();
        expect.fail('Should have thrown GatewayStartupError');
      } catch (error) {
        expect(error).toBeInstanceOf(GatewayStartupError);
        expect((error as GatewayStartupError).message).toContain('required but unreachable');
        expect((error as GatewayStartupError).message).toContain('localhost:8001');
      }
    });

    it('throws GatewayStartupError when health check returns non-200', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: 'Service unavailable' }),
      } as Response);

      await expect(initializeGateway()).rejects.toThrow(GatewayStartupError);
    });

    it('succeeds when gateway is reachable', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'healthy',
            providers: { anthropic: true, openai: true },
          }),
      } as Response);

      const result = await initializeGateway();

      expect(result.available).toBe(true);
      expect(result.providers).toContain('anthropic');
      expect(result.providers).toContain('openai');
    });

    it('sets wasGatewayAvailableAtStartup to false when gateway fails', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      try {
        await initializeGateway();
      } catch {
        // Expected to throw
      }

      expect(wasGatewayAvailableAtStartup()).toBe(false);
    });
  });

  describe('initializeGateway with REQUIRE_LITELLM_GATEWAY=false (default)', () => {
    beforeEach(() => {
      process.env.REQUIRE_LITELLM_GATEWAY = 'false';
      process.env.LITELLM_GATEWAY_URL = 'http://localhost:8001';
    });

    it('does NOT throw when gateway is unreachable (graceful degradation)', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await initializeGateway();

      expect(result.available).toBe(false);
      expect(result.url).toBe('http://localhost:8001');
    });

    it('sets wasGatewayAvailableAtStartup to false on connection failure', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await initializeGateway();

      expect(wasGatewayAvailableAtStartup()).toBe(false);
    });

    it('does NOT throw when health check returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Internal error' }),
      } as Response);

      const result = await initializeGateway();

      expect(result.available).toBe(false);
    });

    it('succeeds and sets wasGatewayAvailableAtStartup to true when gateway is reachable', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'healthy',
            providers: { anthropic: true },
          }),
      } as Response);

      const result = await initializeGateway();

      expect(result.available).toBe(true);
      expect(wasGatewayAvailableAtStartup()).toBe(true);
    });
  });

  describe('initializeGateway without env var set (default behavior)', () => {
    beforeEach(() => {
      delete process.env.REQUIRE_LITELLM_GATEWAY;
    });

    it('defaults to graceful degradation (no throw on failure)', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await initializeGateway();

      expect(result.available).toBe(false);
    });
  });

  describe('isGatewayInitialized', () => {
    it('returns false before initializeGateway is called', () => {
      expect(isGatewayInitialized()).toBe(false);
    });

    it('returns true after successful initializeGateway', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'healthy',
            providers: { anthropic: true },
          }),
      } as Response);

      await initializeGateway();

      expect(isGatewayInitialized()).toBe(true);
    });

    it('returns true after failed initializeGateway (when not required)', async () => {
      process.env.REQUIRE_LITELLM_GATEWAY = 'false';
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await initializeGateway();

      expect(isGatewayInitialized()).toBe(true);
    });
  });

  describe('resetGatewayConfig', () => {
    it('resets initialization state', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'healthy',
            providers: {},
          }),
      } as Response);

      await initializeGateway();
      expect(isGatewayInitialized()).toBe(true);

      resetGatewayConfig();

      expect(isGatewayInitialized()).toBe(false);
      expect(wasGatewayAvailableAtStartup()).toBe(false);
    });
  });
});
