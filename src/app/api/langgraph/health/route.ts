import { NextResponse } from 'next/server';
import { checkHealth, type HealthResponse } from '@/lib/generation/langgraph-client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:langgraph:health');

export async function GET(): Promise<NextResponse<HealthResponse | { error: string }>> {
  try {
    const health = await checkHealth();
    return NextResponse.json(health);
  } catch (error) {
    logger.warn('LangGraph health check failed', { error });
    return NextResponse.json(
      {
        status: 'unavailable' as const,
        qdrant_connected: false,
        litellm_available: false,
        anthropic_configured: false,
        openai_configured: false,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}
