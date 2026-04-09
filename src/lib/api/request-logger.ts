/**
 * Request/Response logging utility for Next.js API routes
 *
 * Provides a wrapper function that logs:
 * - Request method, path, query params
 * - Request body (sanitized)
 * - Response status and duration
 * - Errors with stack traces
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger, sanitizeLogData, formatDuration } from '@/lib/logger';

const logger = createLogger('api');

export interface RequestLogData {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: Record<string, unknown>;
  requestId: string;
}

export interface ResponseLogData extends RequestLogData {
  status: number;
  durationMs: number;
  error?: {
    message: string;
    stack?: string;
  };
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function extractQueryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }
  return contentType.includes('application/json');
}

async function extractBody(request: NextRequest): Promise<Record<string, unknown> | undefined> {
  const contentType = request.headers.get('content-type');
  if (!isJsonContentType(contentType)) {
    return undefined;
  }

  try {
    const clonedRequest = request.clone();
    const body: unknown = await clonedRequest.json();
    if (typeof body === 'object' && body !== null) {
      return sanitizeLogData(body as Record<string, unknown>);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function logRequest(data: RequestLogData): void {
  logger.info('Request received', {
    requestId: data.requestId,
    method: data.method,
    path: data.path,
    query: Object.keys(data.query).length > 0 ? data.query : undefined,
    hasBody: !!data.body,
  });

  if (data.body) {
    logger.debug('Request body', {
      requestId: data.requestId,
      body: data.body,
    });
  }
}

function logResponse(data: ResponseLogData): void {
  const isSuccess = data.status >= 200 && data.status < 400;
  const isClientError = data.status >= 400 && data.status < 500;
  const isServerError = data.status >= 500;

  const logData = {
    requestId: data.requestId,
    method: data.method,
    path: data.path,
    status: data.status,
    duration: formatDuration(data.durationMs),
    durationMs: data.durationMs,
  };

  if (isSuccess) {
    logger.info('Request completed', logData);
  } else if (isClientError) {
    logger.warn('Request failed (client error)', {
      ...logData,
      error: data.error?.message,
    });
  } else if (isServerError) {
    logger.error(
      'Request failed (server error)',
      data.error
        ? { message: data.error.message, stack: data.error.stack, name: 'Error' }
        : undefined,
      logData
    );
  }
}

export type RouteHandler<T = unknown> = (
  request: NextRequest,
  context?: { params: Record<string, string> }
) => Promise<NextResponse<T>> | NextResponse<T>;

export function withRequestLogging<T>(handler: RouteHandler<T>): RouteHandler<T> {
  return async (
    request: NextRequest,
    context?: { params: Record<string, string> }
  ): Promise<NextResponse<T>> => {
    const startTime = Date.now();
    const requestId = generateRequestId();
    const url = new URL(request.url);

    const requestData: RequestLogData = {
      method: request.method,
      path: url.pathname,
      query: extractQueryParams(url),
      body: await extractBody(request),
      requestId,
    };

    logRequest(requestData);

    let response: NextResponse<T>;
    let error: { message: string; stack?: string } | undefined;

    try {
      response = await Promise.resolve(handler(request, context));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : undefined;
      error = { message: errorMessage, stack: errorStack };

      response = NextResponse.json({ error: errorMessage } as T, { status: 500 });
    }

    const durationMs = Date.now() - startTime;

    logResponse({
      ...requestData,
      status: response.status,
      durationMs,
      error,
    });

    return response;
  };
}

export function createApiLogger(module: string): {
  logRequest: (request: NextRequest, requestId: string) => Promise<RequestLogData>;
  logResponse: (data: ResponseLogData) => void;
  generateRequestId: () => string;
} {
  const moduleLogger = createLogger(`api:${module}`);

  return {
    generateRequestId,

    logRequest: async (request: NextRequest, requestId: string): Promise<RequestLogData> => {
      const url = new URL(request.url);
      const data: RequestLogData = {
        method: request.method,
        path: url.pathname,
        query: extractQueryParams(url),
        body: await extractBody(request),
        requestId,
      };

      moduleLogger.info('Request received', {
        requestId: data.requestId,
        method: data.method,
        path: data.path,
        query: Object.keys(data.query).length > 0 ? data.query : undefined,
        hasBody: !!data.body,
      });

      if (data.body) {
        moduleLogger.debug('Request body', {
          requestId: data.requestId,
          body: data.body,
        });
      }

      return data;
    },

    logResponse: (data: ResponseLogData): void => {
      const isSuccess = data.status >= 200 && data.status < 400;
      const isClientError = data.status >= 400 && data.status < 500;
      const isServerError = data.status >= 500;

      const logData = {
        requestId: data.requestId,
        method: data.method,
        path: data.path,
        status: data.status,
        duration: formatDuration(data.durationMs),
        durationMs: data.durationMs,
      };

      if (isSuccess) {
        moduleLogger.info('Request completed', logData);
      } else if (isClientError) {
        moduleLogger.warn('Request failed (client error)', {
          ...logData,
          error: data.error?.message,
        });
      } else if (isServerError) {
        moduleLogger.error(
          'Request failed (server error)',
          data.error
            ? { message: data.error.message, stack: data.error.stack, name: 'Error' }
            : undefined,
          logData
        );
      }
    },
  };
}
