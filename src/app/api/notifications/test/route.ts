import { NextRequest, NextResponse } from 'next/server';
import type { NotificationType } from '@/types';
import {
  isDiscordConfigured,
  sendTypedNotification,
  type ContentReadyPayload,
  type TimeSensitivePayload,
  type AgentStuckPayload,
  type BudgetWarningPayload,
} from '@/lib/notifications/discord';

interface TestRequestBody {
  type: NotificationType;
  payload?: Partial<
    ContentReadyPayload | TimeSensitivePayload | AgentStuckPayload | BudgetWarningPayload
  >;
}

interface TestSuccessResponse {
  success: boolean;
  type: NotificationType;
  message: string;
}

interface ErrorResponse {
  error: string;
  code?: string;
}

const VALID_NOTIFICATION_TYPES: NotificationType[] = [
  'content_ready',
  'time_sensitive',
  'agent_stuck',
  'budget_warning',
];

function getDefaultContentReadyPayload(): ContentReadyPayload {
  return {
    queueCount: 5,
    highConfidenceCount: 3,
    posts: [
      {
        id: 'test-1',
        content: 'This is a test post with high confidence.',
        confidenceScore: 85,
      },
      {
        id: 'test-2',
        content: 'Another test post awaiting review.',
        confidenceScore: 72,
      },
    ],
  };
}

function getDefaultTimeSensitivePayload(): TimeSensitivePayload {
  return {
    post: {
      id: 999,
      content:
        'Breaking: Major tech company just announced a game-changing AI feature. This is your chance to comment before the conversation moves on.',
      confidenceScore: 88,
      reasoning: {
        source: 'Test source',
        whyItWorks: 'Timely content about trending topic with unique angle.',
        voiceMatch: 85,
        timing: 'Post within 2 hours for maximum relevance.',
        concerns: [],
      },
    },
    expiresIn: '2 hours',
    sourceUrl: 'https://example.com/test-source',
  };
}

function getDefaultAgentStuckPayload(): AgentStuckPayload {
  return {
    reason: 'repeated_rejection',
    details:
      'The agent has been stuck trying to generate content that passes voice validation. Multiple attempts have failed on the same pattern.',
    rejectionCount: 5,
    patternDescription: 'Opening sentences with technical jargon instead of problem-first framing.',
  };
}

function getDefaultBudgetWarningPayload(): BudgetWarningPayload {
  return {
    apiName: 'anthropic',
    period: 'daily',
    usedUsd: 8.5,
    limitUsd: 10,
    percentUsed: 85,
  };
}

function buildPayload(
  type: NotificationType,
  partialPayload?: Partial<
    ContentReadyPayload | TimeSensitivePayload | AgentStuckPayload | BudgetWarningPayload
  >
): ContentReadyPayload | TimeSensitivePayload | AgentStuckPayload | BudgetWarningPayload {
  switch (type) {
    case 'content_ready': {
      const defaultPayload = getDefaultContentReadyPayload();
      return { ...defaultPayload, ...(partialPayload as Partial<ContentReadyPayload>) };
    }
    case 'time_sensitive': {
      const defaultPayload = getDefaultTimeSensitivePayload();
      return { ...defaultPayload, ...(partialPayload as Partial<TimeSensitivePayload>) };
    }
    case 'agent_stuck': {
      const defaultPayload = getDefaultAgentStuckPayload();
      return { ...defaultPayload, ...(partialPayload as Partial<AgentStuckPayload>) };
    }
    case 'budget_warning': {
      const defaultPayload = getDefaultBudgetWarningPayload();
      return { ...defaultPayload, ...(partialPayload as Partial<BudgetWarningPayload>) };
    }
  }
}

function validateRequestBody(body: unknown): body is TestRequestBody {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const obj = body as Record<string, unknown>;

  if (
    typeof obj.type !== 'string' ||
    !VALID_NOTIFICATION_TYPES.includes(obj.type as NotificationType)
  ) {
    return false;
  }

  if (obj.payload !== undefined && typeof obj.payload !== 'object') {
    return false;
  }

  return true;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<TestSuccessResponse | ErrorResponse>> {
  if (!isDiscordConfigured()) {
    return NextResponse.json(
      {
        error: 'Discord webhook is not configured. Set DISCORD_WEBHOOK_URL environment variable.',
        code: 'DISCORD_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as unknown;

    if (!validateRequestBody(body)) {
      return NextResponse.json(
        {
          error: `Invalid request body. Required: type (one of: ${VALID_NOTIFICATION_TYPES.join(', ')}). Optional: payload object.`,
          code: 'INVALID_REQUEST',
        },
        { status: 400 }
      );
    }

    const payload = buildPayload(body.type, body.payload);
    const result = await sendTypedNotification(body.type, payload as never);

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error ?? 'Failed to send notification',
          code: 'SEND_FAILED',
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      type: body.type,
      message: `Test ${body.type} notification sent successfully`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: `Failed to send test notification: ${errorMessage}`,
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    );
  }
}

export function GET(): NextResponse<{ configured: boolean; types: string[] }> {
  return NextResponse.json({
    configured: isDiscordConfigured(),
    types: VALID_NOTIFICATION_TYPES,
  });
}
