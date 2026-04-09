/**
 * Rate Limiting Middleware
 *
 * Provides configurable rate limiting for API endpoints using a sliding window algorithm.
 * Uses in-memory storage suitable for single-instance deployments.
 * For distributed deployments, replace with Redis-backed implementation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ratelimit:middleware');

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Whether rate limiting is enabled */
  enabled: boolean;
  /** Routes exempt from rate limiting */
  exemptRoutes: string[];
}

export interface RateLimitInfo {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current request count in the window */
  current: number;
  /** Maximum requests allowed */
  limit: number;
  /** Remaining requests in the window */
  remaining: number;
  /** Time until the window resets (ms) */
  resetMs: number;
  /** Retry-After header value (seconds) */
  retryAfter: number;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

// In-memory storage for rate limit tracking
// Key: client identifier, Value: window entry
const rateLimitStore = new Map<string, WindowEntry>();

// Cleanup interval ID for memory management
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  limit: 100,
  windowMs: 60 * 1000, // 1 minute
  enabled: true,
  exemptRoutes: ['/api/llm/health', '/api/langgraph/health', '/api/workers/health'],
};

/**
 * Get rate limit configuration from environment
 */
export function getRateLimitConfig(): RateLimitConfig {
  const enabled = process.env.RATE_LIMIT_ENABLED !== 'false';
  const limit = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);

  return {
    enabled,
    limit: isNaN(limit) || limit <= 0 ? DEFAULT_RATE_LIMIT_CONFIG.limit : limit,
    windowMs: isNaN(windowMs) || windowMs <= 0 ? DEFAULT_RATE_LIMIT_CONFIG.windowMs : windowMs,
    exemptRoutes: DEFAULT_RATE_LIMIT_CONFIG.exemptRoutes,
  };
}

/**
 * Extract client identifier from request
 * Uses IP address or API key for identification
 */
export function getClientIdentifier(request: NextRequest): string {
  // Try x-forwarded-for first (common for proxies/load balancers)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Get the first IP (original client)
    const clientIp = forwardedFor.split(',')[0].trim();
    if (clientIp) {
      return `ip:${clientIp}`;
    }
  }

  // Try x-real-ip
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return `ip:${realIp}`;
  }

  // Try to get API key for more granular limiting
  const apiKey = request.headers.get('x-api-key') ?? request.headers.get('authorization');
  if (apiKey) {
    // Use a hash-like prefix to avoid storing full keys
    const keyId = apiKey.slice(0, 8);
    return `key:${keyId}`;
  }

  // Fallback: use a generic identifier (less ideal)
  return 'unknown';
}

/**
 * Check if a route is exempt from rate limiting
 */
export function isExemptRoute(pathname: string, exemptRoutes: string[]): boolean {
  return exemptRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'));
}

/**
 * Check rate limit for a client
 */
export function checkRateLimit(
  clientId: string,
  config: RateLimitConfig = getRateLimitConfig()
): RateLimitInfo {
  const now = Date.now();
  const entry = rateLimitStore.get(clientId);

  // No existing entry or window has expired
  if (!entry || now - entry.windowStart >= config.windowMs) {
    rateLimitStore.set(clientId, { count: 1, windowStart: now });
    return {
      allowed: true,
      current: 1,
      limit: config.limit,
      remaining: config.limit - 1,
      resetMs: config.windowMs,
      retryAfter: 0,
    };
  }

  // Within existing window
  const timeInWindow = now - entry.windowStart;
  const timeRemaining = config.windowMs - timeInWindow;
  const newCount = entry.count + 1;

  if (newCount > config.limit) {
    const retryAfter = Math.ceil(timeRemaining / 1000);
    return {
      allowed: false,
      current: entry.count,
      limit: config.limit,
      remaining: 0,
      resetMs: timeRemaining,
      retryAfter,
    };
  }

  // Update count
  rateLimitStore.set(clientId, { count: newCount, windowStart: entry.windowStart });

  return {
    allowed: true,
    current: newCount,
    limit: config.limit,
    remaining: config.limit - newCount,
    resetMs: timeRemaining,
    retryAfter: 0,
  };
}

/**
 * Clean up expired entries from the rate limit store
 */
export function cleanupExpiredEntries(
  windowMs: number = DEFAULT_RATE_LIMIT_CONFIG.windowMs
): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart >= windowMs) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`Cleaned up ${cleaned} expired rate limit entries`);
  }

  return cleaned;
}

/**
 * Start periodic cleanup of expired entries
 */
export function startCleanupInterval(intervalMs: number = 60000): void {
  if (cleanupIntervalId) {
    return; // Already running
  }

  cleanupIntervalId = setInterval(() => {
    cleanupExpiredEntries();
  }, intervalMs);

  // Prevent keeping the process alive just for cleanup
  if (typeof cleanupIntervalId === 'object' && 'unref' in cleanupIntervalId) {
    cleanupIntervalId.unref();
  }
}

/**
 * Stop the cleanup interval
 */
export function stopCleanupInterval(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

/**
 * Clear all rate limit entries (useful for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Get the current store size (useful for monitoring)
 */
export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

/**
 * Build rate limit headers for the response
 */
export function buildRateLimitHeaders(info: RateLimitInfo): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(info.limit),
    'X-RateLimit-Remaining': String(info.remaining),
    'X-RateLimit-Reset': String(Math.ceil(info.resetMs / 1000)),
  };
}

/**
 * Build 429 Too Many Requests response
 */
export function buildRateLimitExceededResponse(info: RateLimitInfo): NextResponse {
  const headers = {
    ...buildRateLimitHeaders(info),
    'Retry-After': String(info.retryAfter),
  };

  return NextResponse.json(
    {
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: info.retryAfter,
    },
    { status: 429, headers }
  );
}

/**
 * Rate limit middleware check
 * Returns null if allowed, NextResponse if rate limited
 */
export function rateLimitCheck(request: NextRequest): NextResponse | null {
  const config = getRateLimitConfig();

  // If rate limiting is disabled, allow all requests
  if (!config.enabled) {
    return null;
  }

  const pathname = request.nextUrl.pathname;

  // Check if route is exempt
  if (isExemptRoute(pathname, config.exemptRoutes)) {
    return null;
  }

  const clientId = getClientIdentifier(request);
  const rateLimitInfo = checkRateLimit(clientId, config);

  if (!rateLimitInfo.allowed) {
    logger.warn('Rate limit exceeded', {
      clientId,
      path: pathname,
      method: request.method,
      current: rateLimitInfo.current,
      limit: rateLimitInfo.limit,
      retryAfter: rateLimitInfo.retryAfter,
    });
    return buildRateLimitExceededResponse(rateLimitInfo);
  }

  return null;
}

interface RateLimitErrorBody {
  error: string;
  code: string;
  retryAfter: number;
}

/**
 * Higher-order function to wrap route handlers with rate limiting
 */
export function withRateLimit<T extends Record<string, unknown>>(
  handler: (
    request: NextRequest,
    context?: { params?: Record<string, string> }
  ) => Promise<NextResponse<T>>
): (
  request: NextRequest,
  context?: { params?: Record<string, string> }
) => Promise<NextResponse<T | RateLimitErrorBody>> {
  return async (
    request: NextRequest,
    context?: { params?: Record<string, string> }
  ): Promise<NextResponse<T | RateLimitErrorBody>> => {
    const rateLimitResponse = rateLimitCheck(request);

    if (rateLimitResponse) {
      return rateLimitResponse as NextResponse<RateLimitErrorBody>;
    }

    const response = await handler(request, context);

    // Add rate limit headers to successful responses
    const config = getRateLimitConfig();
    if (config.enabled) {
      const clientId = getClientIdentifier(request);
      const entry = rateLimitStore.get(clientId);
      if (entry) {
        const now = Date.now();
        const timeRemaining = Math.max(0, config.windowMs - (now - entry.windowStart));
        const remaining = Math.max(0, config.limit - entry.count);

        response.headers.set('X-RateLimit-Limit', String(config.limit));
        response.headers.set('X-RateLimit-Remaining', String(remaining));
        response.headers.set('X-RateLimit-Reset', String(Math.ceil(timeRemaining / 1000)));
      }
    }

    return response;
  };
}

// Start cleanup on module load
startCleanupInterval();
