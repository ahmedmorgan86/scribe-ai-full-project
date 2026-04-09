import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getAuthConfig,
  extractApiKey,
  isPublicRoute,
  validateApiKey,
  authenticateRequest,
  authCheckMiddleware,
  withAuth,
} from './middleware';

// Helper to create mock NextRequest
function createMockRequest(
  path: string,
  options: {
    method?: string;
    authorization?: string;
    xApiKey?: string;
  } = {}
): NextRequest {
  const url = `http://localhost:3000${path}`;
  const headers = new Headers();

  if (options.authorization) {
    headers.set('authorization', options.authorization);
  }
  if (options.xApiKey) {
    headers.set('x-api-key', options.xApiKey);
  }

  return new NextRequest(url, {
    method: options.method ?? 'GET',
    headers,
  });
}

describe('Auth Middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getAuthConfig', () => {
    it('should return disabled config when no API_KEYS set', () => {
      delete process.env.API_KEYS;
      const config = getAuthConfig();

      expect(config.enabled).toBe(false);
      expect(config.apiKeys).toHaveLength(0);
    });

    it('should return disabled config when AUTH_ENABLED is false', () => {
      process.env.API_KEYS = 'test-key-1,test-key-2';
      process.env.AUTH_ENABLED = 'false';
      const config = getAuthConfig();

      expect(config.enabled).toBe(false);
    });

    it('should parse comma-separated API keys', () => {
      process.env.API_KEYS = 'key1,key2,key3';
      const config = getAuthConfig();

      expect(config.enabled).toBe(true);
      expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should trim whitespace from API keys', () => {
      process.env.API_KEYS = ' key1 , key2 , key3 ';
      const config = getAuthConfig();

      expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should filter empty API keys', () => {
      process.env.API_KEYS = 'key1,,key2,';
      const config = getAuthConfig();

      expect(config.apiKeys).toEqual(['key1', 'key2']);
    });

    it('should include public routes', () => {
      process.env.API_KEYS = 'test-key';
      const config = getAuthConfig();

      expect(config.publicRoutes).toContain('/api/llm/health');
      expect(config.publicRoutes).toContain('/api/bootstrap/status');
    });
  });

  describe('extractApiKey', () => {
    it('should extract key from Bearer token', () => {
      const request = createMockRequest('/api/test', {
        authorization: 'Bearer my-api-key-123',
      });

      expect(extractApiKey(request)).toBe('my-api-key-123');
    });

    it('should extract key from x-api-key header', () => {
      const request = createMockRequest('/api/test', {
        xApiKey: 'my-api-key-456',
      });

      expect(extractApiKey(request)).toBe('my-api-key-456');
    });

    it('should prefer Authorization header over x-api-key', () => {
      const request = createMockRequest('/api/test', {
        authorization: 'Bearer bearer-key',
        xApiKey: 'header-key',
      });

      expect(extractApiKey(request)).toBe('bearer-key');
    });

    it('should return null when no auth headers present', () => {
      const request = createMockRequest('/api/test');

      expect(extractApiKey(request)).toBeNull();
    });

    it('should return null for non-Bearer authorization', () => {
      const request = createMockRequest('/api/test', {
        authorization: 'Basic somebase64',
      });

      expect(extractApiKey(request)).toBeNull();
    });
  });

  describe('isPublicRoute', () => {
    const publicRoutes = ['/api/health', '/api/public'];

    it('should return true for exact match', () => {
      expect(isPublicRoute('/api/health', publicRoutes)).toBe(true);
    });

    it('should return true for sub-path', () => {
      expect(isPublicRoute('/api/health/check', publicRoutes)).toBe(true);
    });

    it('should return false for non-public routes', () => {
      expect(isPublicRoute('/api/generate', publicRoutes)).toBe(false);
    });

    it('should not match partial route names', () => {
      expect(isPublicRoute('/api/healthy', publicRoutes)).toBe(false);
    });
  });

  describe('validateApiKey', () => {
    const validKeys = ['key1', 'key2', 'key3'];

    it('should return true for valid key', () => {
      expect(validateApiKey('key1', validKeys)).toBe(true);
      expect(validateApiKey('key2', validKeys)).toBe(true);
    });

    it('should return false for invalid key', () => {
      expect(validateApiKey('invalid', validKeys)).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(validateApiKey('KEY1', validKeys)).toBe(false);
    });
  });

  describe('authenticateRequest', () => {
    const config = {
      enabled: true,
      apiKeys: ['valid-key-123'],
      publicRoutes: ['/api/health'],
    };

    it('should allow request when auth is disabled', () => {
      const disabledConfig = { ...config, enabled: false };
      const request = createMockRequest('/api/generate');

      const result = authenticateRequest(request, disabledConfig);

      expect(result.authenticated).toBe(true);
      expect(result.reason).toBe('auth_disabled');
    });

    it('should allow public routes without auth', () => {
      const request = createMockRequest('/api/health');

      const result = authenticateRequest(request, config);

      expect(result.authenticated).toBe(true);
      expect(result.reason).toBe('public_route');
    });

    it('should reject request without API key', () => {
      const request = createMockRequest('/api/generate');

      const result = authenticateRequest(request, config);

      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('no_api_key');
    });

    it('should reject request with invalid API key', () => {
      const request = createMockRequest('/api/generate', {
        authorization: 'Bearer invalid-key',
      });

      const result = authenticateRequest(request, config);

      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('invalid_api_key');
    });

    it('should allow request with valid API key', () => {
      const request = createMockRequest('/api/generate', {
        authorization: 'Bearer valid-key-123',
      });

      const result = authenticateRequest(request, config);

      expect(result.authenticated).toBe(true);
    });
  });

  describe('authCheckMiddleware', () => {
    beforeEach(() => {
      process.env.API_KEYS = 'test-api-key';
    });

    it('should return null for authenticated requests', () => {
      const request = createMockRequest('/api/test', {
        authorization: 'Bearer test-api-key',
      });

      const result = authCheckMiddleware(request);

      expect(result).toBeNull();
    });

    it('should return 401 response for missing API key', async () => {
      const request = createMockRequest('/api/test');

      const result = authCheckMiddleware(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(401);

      const body = (await result?.json()) as { code: string };
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 response for invalid API key', async () => {
      const request = createMockRequest('/api/test', {
        authorization: 'Bearer wrong-key',
      });

      const result = authCheckMiddleware(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);

      const body = (await result?.json()) as { code: string };
      expect(body.code).toBe('FORBIDDEN');
    });
  });

  describe('withAuth', () => {
    beforeEach(() => {
      process.env.API_KEYS = 'test-api-key';
    });

    it('should call handler for authenticated requests', async () => {
      const mockHandler = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ data: 'test' }), { status: 200 }));
      const wrappedHandler = withAuth(mockHandler);

      const request = createMockRequest('/api/test', {
        authorization: 'Bearer test-api-key',
      });

      await wrappedHandler(request);

      expect(mockHandler).toHaveBeenCalledWith(request, undefined);
    });

    it('should not call handler for unauthenticated requests', async () => {
      const mockHandler = vi.fn();
      const wrappedHandler = withAuth(mockHandler);

      const request = createMockRequest('/api/test');

      const result = await wrappedHandler(request);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(result.status).toBe(401);
    });
  });
});
