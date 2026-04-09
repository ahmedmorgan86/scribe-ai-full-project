import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth:middleware');

export interface AuthConfig {
  /** Comma-separated list of valid API keys */
  apiKeys: string[];
  /** Routes that don't require authentication */
  publicRoutes: string[];
  /** Whether auth is enabled at all */
  enabled: boolean;
}

export interface AuthResult {
  authenticated: boolean;
  reason?: string;
  apiKeyPrefix?: string;
}

export interface UnauthorizedResponse {
  error: string;
  code: 'UNAUTHORIZED' | 'FORBIDDEN';
}

/**
 * Get auth configuration from environment
 */
export function getAuthConfig(): AuthConfig {
  const apiKeysEnv = process.env.API_KEYS ?? '';
  const authEnabled = process.env.AUTH_ENABLED !== 'false';

  // Parse comma-separated API keys, filter empty strings
  const apiKeys = apiKeysEnv
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  // Public routes that don't require authentication
  // Health endpoints and bootstrap status should be accessible
  const publicRoutes = [
    '/api/llm/health',
    '/api/langgraph/health',
    '/api/workers/health',
    '/api/bootstrap/status',
  ];

  return {
    apiKeys,
    publicRoutes,
    enabled: authEnabled && apiKeys.length > 0,
  };
}

/**
 * Extract API key from request headers
 * Supports:
 * - Authorization: Bearer <token>
 * - x-api-key: <token>
 */
export function extractApiKey(request: NextRequest): string | null {
  // Check Authorization header first
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ') === true) {
    return authHeader.slice(7);
  }

  // Fall back to x-api-key header
  const apiKeyHeader = request.headers.get('x-api-key');
  if (apiKeyHeader !== null) {
    return apiKeyHeader;
  }

  return null;
}

/**
 * Check if a route is public (doesn't require auth)
 */
export function isPublicRoute(pathname: string, publicRoutes: string[]): boolean {
  return publicRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'));
}

/**
 * Validate API key against configured keys
 */
export function validateApiKey(apiKey: string, validKeys: string[]): boolean {
  return validKeys.includes(apiKey);
}

/**
 * Get a safe prefix of the API key for logging
 */
function getApiKeyPrefix(apiKey: string): string {
  if (apiKey.length < 8) {
    return '***';
  }
  return apiKey.slice(0, 4) + '...' + apiKey.slice(-4);
}

/**
 * Authenticate a request
 */
export function authenticateRequest(request: NextRequest, config?: AuthConfig): AuthResult {
  const authConfig = config ?? getAuthConfig();
  const pathname = request.nextUrl.pathname;

  // If auth is disabled, allow everything
  if (!authConfig.enabled) {
    return { authenticated: true, reason: 'auth_disabled' };
  }

  // Check if route is public
  if (isPublicRoute(pathname, authConfig.publicRoutes)) {
    return { authenticated: true, reason: 'public_route' };
  }

  // Extract and validate API key
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    logger.warn('Authentication failed: no API key provided', {
      path: pathname,
      method: request.method,
    });
    return { authenticated: false, reason: 'no_api_key' };
  }

  if (!validateApiKey(apiKey, authConfig.apiKeys)) {
    logger.warn('Authentication failed: invalid API key', {
      path: pathname,
      method: request.method,
      keyPrefix: getApiKeyPrefix(apiKey),
    });
    return {
      authenticated: false,
      reason: 'invalid_api_key',
      apiKeyPrefix: getApiKeyPrefix(apiKey),
    };
  }

  logger.debug('Request authenticated', {
    path: pathname,
    method: request.method,
    keyPrefix: getApiKeyPrefix(apiKey),
  });

  return { authenticated: true, apiKeyPrefix: getApiKeyPrefix(apiKey) };
}

/**
 * Build unauthorized response
 */
export function buildUnauthorizedResponse(reason: string): NextResponse<UnauthorizedResponse> {
  const isNoKey = reason === 'no_api_key';

  return NextResponse.json(
    {
      error: isNoKey
        ? 'Authentication required. Provide API key via Authorization header (Bearer token) or x-api-key header.'
        : 'Invalid API key.',
      code: isNoKey ? 'UNAUTHORIZED' : 'FORBIDDEN',
    },
    { status: isNoKey ? 401 : 403 }
  );
}

/**
 * Middleware function to check authentication
 * Returns null if authenticated, NextResponse if not
 */
export function authCheckMiddleware(request: NextRequest): NextResponse | null {
  const result = authenticateRequest(request);

  if (!result.authenticated) {
    return buildUnauthorizedResponse(result.reason ?? 'unknown');
  }

  return null;
}

/**
 * Higher-order function to wrap route handlers with authentication
 */
export function withAuth<T extends Record<string, unknown>>(
  handler: (
    request: NextRequest,
    context?: { params?: Record<string, string> }
  ) => Promise<NextResponse<T>>
): (
  request: NextRequest,
  context?: { params?: Record<string, string> }
) => Promise<NextResponse<T | UnauthorizedResponse>> {
  return async (request, context) => {
    const authResult = authenticateRequest(request);

    if (!authResult.authenticated) {
      return buildUnauthorizedResponse(authResult.reason ?? 'unknown');
    }

    return handler(request, context);
  };
}
