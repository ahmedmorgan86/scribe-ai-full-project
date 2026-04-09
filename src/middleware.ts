import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Edge Middleware for API authentication and rate limiting
 *
 * Note: This runs on the Edge runtime, so we can't import Node.js modules
 * or use createLogger. We keep the logic inline and simple.
 */

// ============================================================================
// Configuration
// ============================================================================

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/api/llm/health',
  '/api/langgraph/health',
  '/api/workers/health',
  '/api/bootstrap/status',
];

// Routes exempt from rate limiting (health checks need to be always accessible)
const RATE_LIMIT_EXEMPT_ROUTES = [
  '/api/llm/health',
  '/api/langgraph/health',
  '/api/workers/health',
];

// ============================================================================
// Rate Limiting (In-Memory, Edge-Compatible)
// ============================================================================

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-memory store for rate limiting
// Note: This resets on server restart and is per-instance
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 60 seconds)
let lastCleanup = Date.now();

function getRateLimitConfig(): { enabled: boolean; limit: number; windowMs: number } {
  const enabled = process.env.RATE_LIMIT_ENABLED !== 'false';
  const limit = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);

  return {
    enabled,
    limit: isNaN(limit) || limit <= 0 ? 100 : limit,
    windowMs: isNaN(windowMs) || windowMs <= 0 ? 60000 : windowMs,
  };
}

function getClientIdentifier(request: NextRequest): string {
  // Try x-forwarded-for first (common for proxies/load balancers)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
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

  // Try API key for more granular limiting
  const apiKey = request.headers.get('x-api-key') ?? request.headers.get('authorization');
  if (apiKey) {
    return `key:${apiKey.slice(0, 8)}`;
  }

  return 'unknown';
}

function cleanupExpiredEntries(windowMs: number): void {
  const now = Date.now();

  // Only cleanup every 60 seconds to avoid overhead
  if (now - lastCleanup < 60000) {
    return;
  }

  lastCleanup = now;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart >= windowMs) {
      rateLimitStore.delete(key);
    }
  }
}

function checkRateLimit(
  clientId: string,
  config: { limit: number; windowMs: number }
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(clientId);

  // Cleanup old entries periodically
  cleanupExpiredEntries(config.windowMs);

  // No existing entry or window has expired
  if (!entry || now - entry.windowStart >= config.windowMs) {
    rateLimitStore.set(clientId, { count: 1, windowStart: now });
    return { allowed: true, remaining: config.limit - 1, retryAfter: 0 };
  }

  // Within existing window
  const timeInWindow = now - entry.windowStart;
  const timeRemaining = config.windowMs - timeInWindow;
  const newCount = entry.count + 1;

  if (newCount > config.limit) {
    const retryAfter = Math.ceil(timeRemaining / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  // Update count
  rateLimitStore.set(clientId, { count: newCount, windowStart: entry.windowStart });

  return { allowed: true, remaining: config.limit - newCount, retryAfter: 0 };
}

function isRateLimitExemptRoute(pathname: string): boolean {
  return RATE_LIMIT_EXEMPT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  );
}

// ============================================================================
// Authentication
// ============================================================================

function getAuthConfig(): { enabled: boolean; apiKeys: string[] } {
  const apiKeysEnv = process.env.API_KEYS ?? '';
  const authEnabled = process.env.AUTH_ENABLED !== 'false';

  const apiKeys = apiKeysEnv
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  return {
    enabled: authEnabled && apiKeys.length > 0,
    apiKeys,
  };
}

function extractApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ') === true) {
    return authHeader.slice(7);
  }

  return request.headers.get('x-api-key');
}

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'));
}

// ============================================================================
// Main Middleware
// ============================================================================

export function middleware(request: NextRequest): NextResponse | undefined {
  const pathname = request.nextUrl.pathname;

  // Only apply to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // -------------------------------------------------------------------------
  // Rate Limiting (applied before authentication)
  // -------------------------------------------------------------------------
  const rateLimitConfig = getRateLimitConfig();

  if (rateLimitConfig.enabled && !isRateLimitExemptRoute(pathname)) {
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(clientId, rateLimitConfig);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfter),
            'X-RateLimit-Limit': String(rateLimitConfig.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateLimitResult.retryAfter),
          },
        }
      );
    }
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------
  const authConfig = getAuthConfig();

  // If auth is disabled, allow all requests
  if (!authConfig.enabled) {
    return NextResponse.next();
  }

  // Allow public routes without authentication
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Extract and validate API key
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'Authentication required. Provide API key via Authorization header (Bearer token) or x-api-key header.',
        code: 'UNAUTHORIZED',
      },
      { status: 401 }
    );
  }

  if (!authConfig.apiKeys.includes(apiKey)) {
    return NextResponse.json(
      {
        error: 'Invalid API key.',
        code: 'FORBIDDEN',
      },
      { status: 403 }
    );
  }

  // -------------------------------------------------------------------------
  // Authenticated - proceed to route handler
  // -------------------------------------------------------------------------
  return NextResponse.next();
}

// Configure which routes the middleware runs on
export const config = {
  matcher: '/api/:path*',
};
