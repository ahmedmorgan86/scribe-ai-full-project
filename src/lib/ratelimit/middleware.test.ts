/**
 * Rate Limiting Middleware Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getRateLimitConfig,
  getClientIdentifier,
  isExemptRoute,
  checkRateLimit,
  rateLimitCheck,
  buildRateLimitHeaders,
  buildRateLimitExceededResponse,
  clearRateLimitStore,
  cleanupExpiredEntries,
  getRateLimitStoreSize,
  stopCleanupInterval,
  startCleanupInterval,
} from './middleware';

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  const fullUrl = url.startsWith('http') ? url : `http://localhost:3000${url}`;
  return new NextRequest(fullUrl, {
    headers: new Headers(headers),
  });
}

describe('Rate Limiting Middleware', () => {
  beforeEach(() => {
    clearRateLimitStore();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    stopCleanupInterval();
  });

  describe('getRateLimitConfig', () => {
    it('returns default config when no env vars set', () => {
      const config = getRateLimitConfig();
      expect(config.enabled).toBe(true);
      expect(config.limit).toBe(100);
      expect(config.windowMs).toBe(60000);
    });

    it('respects RATE_LIMIT_ENABLED=false', () => {
      vi.stubEnv('RATE_LIMIT_ENABLED', 'false');
      const config = getRateLimitConfig();
      expect(config.enabled).toBe(false);
    });

    it('respects custom RATE_LIMIT_MAX', () => {
      vi.stubEnv('RATE_LIMIT_MAX', '50');
      const config = getRateLimitConfig();
      expect(config.limit).toBe(50);
    });

    it('respects custom RATE_LIMIT_WINDOW_MS', () => {
      vi.stubEnv('RATE_LIMIT_WINDOW_MS', '30000');
      const config = getRateLimitConfig();
      expect(config.windowMs).toBe(30000);
    });

    it('uses defaults for invalid values', () => {
      vi.stubEnv('RATE_LIMIT_MAX', 'invalid');
      vi.stubEnv('RATE_LIMIT_WINDOW_MS', '-1000');
      const config = getRateLimitConfig();
      expect(config.limit).toBe(100);
      expect(config.windowMs).toBe(60000);
    });
  });

  describe('getClientIdentifier', () => {
    it('uses x-forwarded-for header', () => {
      const request = createMockRequest('/api/test', {
        'x-forwarded-for': '192.168.1.1, 10.0.0.1',
      });
      const id = getClientIdentifier(request);
      expect(id).toBe('ip:192.168.1.1');
    });

    it('uses x-real-ip header as fallback', () => {
      const request = createMockRequest('/api/test', {
        'x-real-ip': '192.168.1.2',
      });
      const id = getClientIdentifier(request);
      expect(id).toBe('ip:192.168.1.2');
    });

    it('uses API key prefix when no IP available', () => {
      const request = createMockRequest('/api/test', {
        'x-api-key': 'sk-test-1234567890',
      });
      const id = getClientIdentifier(request);
      expect(id).toBe('key:sk-test-');
    });

    it('returns unknown when no identifier available', () => {
      const request = createMockRequest('/api/test');
      const id = getClientIdentifier(request);
      expect(id).toBe('unknown');
    });
  });

  describe('isExemptRoute', () => {
    const exemptRoutes = ['/api/health', '/api/status'];

    it('returns true for exact match', () => {
      expect(isExemptRoute('/api/health', exemptRoutes)).toBe(true);
    });

    it('returns true for child routes', () => {
      expect(isExemptRoute('/api/health/detailed', exemptRoutes)).toBe(true);
    });

    it('returns false for non-exempt routes', () => {
      expect(isExemptRoute('/api/posts', exemptRoutes)).toBe(false);
    });

    it('returns false for partial matches', () => {
      expect(isExemptRoute('/api/healthcare', exemptRoutes)).toBe(false);
    });
  });

  describe('checkRateLimit', () => {
    const config = {
      limit: 3,
      windowMs: 1000,
      enabled: true,
      exemptRoutes: [],
    };

    it('allows first request', () => {
      const result = checkRateLimit('client1', config);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(2);
    });

    it('allows requests up to the limit', () => {
      checkRateLimit('client2', config);
      checkRateLimit('client2', config);
      const result = checkRateLimit('client2', config);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(3);
      expect(result.remaining).toBe(0);
    });

    it('rejects requests over the limit', () => {
      checkRateLimit('client3', config);
      checkRateLimit('client3', config);
      checkRateLimit('client3', config);
      const result = checkRateLimit('client3', config);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('tracks different clients separately', () => {
      checkRateLimit('clientA', config);
      checkRateLimit('clientA', config);
      checkRateLimit('clientA', config);
      const result = checkRateLimit('clientB', config);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
    });

    it('resets after window expires', async () => {
      const shortConfig = { ...config, windowMs: 50 };
      checkRateLimit('client4', shortConfig);
      checkRateLimit('client4', shortConfig);
      checkRateLimit('client4', shortConfig);
      checkRateLimit('client4', shortConfig); // Over limit

      await new Promise((resolve) => setTimeout(resolve, 60));

      const result = checkRateLimit('client4', shortConfig);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
    });
  });

  describe('rateLimitCheck', () => {
    beforeEach(() => {
      vi.stubEnv('RATE_LIMIT_MAX', '2');
      vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    });

    it('returns null when rate limiting is disabled', () => {
      vi.stubEnv('RATE_LIMIT_ENABLED', 'false');
      const request = createMockRequest('/api/posts', {
        'x-forwarded-for': '192.168.1.1',
      });
      const result = rateLimitCheck(request);
      expect(result).toBeNull();
    });

    it('returns null for exempt routes', () => {
      const request = createMockRequest('/api/llm/health', {
        'x-forwarded-for': '192.168.1.1',
      });
      const result = rateLimitCheck(request);
      expect(result).toBeNull();
    });

    it('returns null when under limit', () => {
      const request = createMockRequest('/api/posts', {
        'x-forwarded-for': '192.168.1.100',
      });
      const result = rateLimitCheck(request);
      expect(result).toBeNull();
    });

    it('returns 429 response when over limit', () => {
      const request = createMockRequest('/api/posts', {
        'x-forwarded-for': '192.168.1.101',
      });

      rateLimitCheck(request);
      rateLimitCheck(request);
      const result = rateLimitCheck(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(429);
    });
  });

  describe('buildRateLimitHeaders', () => {
    it('returns correct headers', () => {
      const info = {
        allowed: true,
        current: 5,
        limit: 100,
        remaining: 95,
        resetMs: 30000,
        retryAfter: 0,
      };
      const headers = buildRateLimitHeaders(info);
      expect(headers['X-RateLimit-Limit']).toBe('100');
      expect(headers['X-RateLimit-Remaining']).toBe('95');
      expect(headers['X-RateLimit-Reset']).toBe('30');
    });
  });

  describe('buildRateLimitExceededResponse', () => {
    it('returns 429 with correct body', async () => {
      const info = {
        allowed: false,
        current: 100,
        limit: 100,
        remaining: 0,
        resetMs: 30000,
        retryAfter: 30,
      };
      const response = buildRateLimitExceededResponse(info);
      expect(response.status).toBe(429);

      const body = (await response.json()) as {
        error: string;
        code: string;
        retryAfter: number;
      };
      expect(body.error).toBe('Too many requests. Please try again later.');
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.retryAfter).toBe(30);
    });

    it('includes Retry-After header', () => {
      const info = {
        allowed: false,
        current: 100,
        limit: 100,
        remaining: 0,
        resetMs: 30000,
        retryAfter: 30,
      };
      const response = buildRateLimitExceededResponse(info);
      expect(response.headers.get('Retry-After')).toBe('30');
    });
  });

  describe('cleanupExpiredEntries', () => {
    it('removes expired entries', async () => {
      const shortWindow = 50;
      const config = {
        limit: 10,
        windowMs: shortWindow,
        enabled: true,
        exemptRoutes: [],
      };

      // Add some entries
      checkRateLimit('expired1', config);
      checkRateLimit('expired2', config);

      expect(getRateLimitStoreSize()).toBe(2);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      const cleaned = cleanupExpiredEntries(shortWindow);
      expect(cleaned).toBe(2);
      expect(getRateLimitStoreSize()).toBe(0);
    });

    it('keeps non-expired entries', () => {
      const config = {
        limit: 10,
        windowMs: 60000, // Long window
        enabled: true,
        exemptRoutes: [],
      };

      checkRateLimit('notExpired', config);
      expect(getRateLimitStoreSize()).toBe(1);

      const cleaned = cleanupExpiredEntries(60000);
      expect(cleaned).toBe(0);
      expect(getRateLimitStoreSize()).toBe(1);
    });
  });

  describe('store management', () => {
    it('clearRateLimitStore removes all entries', () => {
      const config = {
        limit: 10,
        windowMs: 60000,
        enabled: true,
        exemptRoutes: [],
      };

      checkRateLimit('a', config);
      checkRateLimit('b', config);
      checkRateLimit('c', config);

      expect(getRateLimitStoreSize()).toBe(3);
      clearRateLimitStore();
      expect(getRateLimitStoreSize()).toBe(0);
    });

    it('startCleanupInterval and stopCleanupInterval work', () => {
      // Should not throw
      startCleanupInterval(1000);
      startCleanupInterval(1000); // Second call should be no-op
      stopCleanupInterval();
      stopCleanupInterval(); // Second call should be no-op
    });
  });
});
