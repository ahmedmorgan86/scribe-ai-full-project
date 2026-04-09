import { NextResponse } from 'next/server';
import { testTwitterConnection, isTwitterConfigured } from '@/lib/twitter/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:twitter:test');

export const dynamic = 'force-dynamic';

interface TestResponse {
  success: boolean;
  configured: boolean;
  user?: {
    id: string;
    username: string;
    name: string;
  };
  error?: string;
}

/**
 * POST /api/twitter/test
 *
 * Test the Twitter API connection with stored credentials.
 */
export async function POST(): Promise<NextResponse<TestResponse>> {
  try {
    const configured = isTwitterConfigured();

    if (!configured) {
      return NextResponse.json({
        success: false,
        configured: false,
        error: 'Twitter credentials not configured',
      });
    }

    const result = await testTwitterConnection();

    if (result.success) {
      logger.info('Twitter connection test successful', { user: result.user });
    } else {
      logger.warn('Twitter connection test failed', { error: result.error });
    }

    return NextResponse.json({
      success: result.success,
      configured: true,
      user: result.user,
      error: result.error,
    });
  } catch (error) {
    logger.error('Twitter connection test error', { error });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      configured: isTwitterConfigured(),
      error: message,
    });
  }
}
