import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/connection';
import { getBudgetSummary, BudgetLimits, BudgetStatus } from '@/db/models/costs';
import {
  getHumanizerSettings,
  setHumanizerSettings,
  HumanizerSettings,
} from '@/lib/config/settings';
import { countDocuments } from '@/db/qdrant/embeddings';
import { QDRANT_COLLECTION_NAMES, collectionExists } from '@/db/qdrant/connection';
import type { NotificationVerbosity, NotificationPreferences } from '@/types';

interface VoiceExampleRow {
  id: string;
  content: string;
  created_at: string;
}

interface VoiceExampleResponse {
  id: string;
  content: string;
  createdAt: string;
}

interface DataSourceConfig {
  smaugEnabled: boolean;
  smaugPollIntervalMinutes: number;
  apifyEnabled: boolean;
  apifyTier1IntervalMinutes: number;
  apifyTier2IntervalMinutes: number;
}

interface BudgetLimitsResponse {
  anthropicDailyUsd: number;
  anthropicMonthlyUsd: number;
  apifyMonthlyUsd: number;
}

interface SettingsResponse {
  notificationVerbosity: NotificationVerbosity;
  notificationPreferences: NotificationPreferences;
  budgetLimits: BudgetLimitsResponse;
  budgetStatus: BudgetStatus[];
  voiceExamples: VoiceExampleResponse[];
  goldExamplesCount: number;
  dataSourceConfig: DataSourceConfig;
  humanizerSettings: HumanizerSettings;
}

interface ErrorResponse {
  error: string;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

function getBudgetLimitsConfig(): BudgetLimits {
  return {
    anthropicDailyUsd: getEnvNumber('ANTHROPIC_DAILY_BUDGET_USD', 10),
    anthropicMonthlyUsd: getEnvNumber('ANTHROPIC_MONTHLY_BUDGET_USD', 100),
    apifyMonthlyUsd: getEnvNumber('APIFY_MONTHLY_BUDGET_USD', 50),
  };
}

function getDataSourceConfig(): DataSourceConfig {
  return {
    smaugEnabled: getEnvBoolean('SMAUG_ENABLED', true),
    smaugPollIntervalMinutes: getEnvNumber('SMAUG_POLL_INTERVAL_MINUTES', 5),
    apifyEnabled: getEnvBoolean('APIFY_ENABLED', true),
    apifyTier1IntervalMinutes: getEnvNumber('APIFY_TIER1_INTERVAL_MINUTES', 30),
    apifyTier2IntervalMinutes: getEnvNumber('APIFY_TIER2_INTERVAL_MINUTES', 120),
  };
}

function getNotificationVerbosity(): NotificationVerbosity {
  const value = process.env.DISCORD_NOTIFICATION_VERBOSITY;
  if (value === 'minimal' || value === 'summary' || value === 'rich') {
    return value;
  }
  return 'summary';
}

function getNotificationPreferences(): NotificationPreferences {
  return {
    verbosity: getNotificationVerbosity(),
    enabledTypes: {
      content_ready: getEnvBoolean('DISCORD_NOTIFY_CONTENT_READY', true),
      time_sensitive: getEnvBoolean('DISCORD_NOTIFY_TIME_SENSITIVE', true),
      agent_stuck: getEnvBoolean('DISCORD_NOTIFY_AGENT_STUCK', true),
      budget_warning: getEnvBoolean('DISCORD_NOTIFY_BUDGET_WARNING', true),
    },
  };
}

function getVoiceExamples(): VoiceExampleResponse[] {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, content, created_at FROM approved_voice_examples
      ORDER BY created_at DESC
      LIMIT 100
    `);
    const rows = stmt.all() as VoiceExampleRow[];
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

export async function GET(): Promise<NextResponse<SettingsResponse | ErrorResponse>> {
  try {
    const budgetLimitsConfig = getBudgetLimitsConfig();
    const budgetStatus = getBudgetSummary(budgetLimitsConfig);
    const voiceExamples = getVoiceExamples();
    const dataSourceConfig = getDataSourceConfig();
    const notificationVerbosity = getNotificationVerbosity();
    const notificationPreferences = getNotificationPreferences();
    const humanizerSettings = getHumanizerSettings();

    // Get gold examples count from Qdrant (same source as Dashboard)
    let goldExamplesCount = 0;
    try {
      const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
      if (exists) {
        goldExamplesCount = await countDocuments(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, {
          must: [{ key: 'content_type', match: { value: 'gold_example' } }],
        });
      }
    } catch {
      // Silent fail - gold examples count is informational
    }

    const response: SettingsResponse = {
      notificationVerbosity,
      notificationPreferences,
      budgetLimits: {
        anthropicDailyUsd: budgetLimitsConfig.anthropicDailyUsd ?? 10,
        anthropicMonthlyUsd: budgetLimitsConfig.anthropicMonthlyUsd ?? 100,
        apifyMonthlyUsd: budgetLimitsConfig.apifyMonthlyUsd ?? 50,
      },
      budgetStatus,
      voiceExamples,
      goldExamplesCount,
      dataSourceConfig,
      humanizerSettings,
    };

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to fetch settings: ${errorMessage}` },
      { status: 500 }
    );
  }
}

interface PatchSettingsBody {
  notificationVerbosity?: NotificationVerbosity;
  notifyContentReady?: boolean;
  notifyTimeSensitive?: boolean;
  notifyAgentStuck?: boolean;
  notifyBudgetWarning?: boolean;
  anthropicDailyUsd?: number;
  anthropicMonthlyUsd?: number;
  apifyMonthlyUsd?: number;
  smaugEnabled?: boolean;
  smaugPollIntervalMinutes?: number;
  apifyEnabled?: boolean;
  apifyTier1IntervalMinutes?: number;
  apifyTier2IntervalMinutes?: number;
  autoHumanize?: boolean;
}

const VALID_VERBOSITY: NotificationVerbosity[] = ['minimal', 'summary', 'rich'];

export async function PATCH(
  request: NextRequest
): Promise<NextResponse<{ success: boolean; message: string } | ErrorResponse>> {
  try {
    const body = (await request.json()) as PatchSettingsBody;

    if (body.notificationVerbosity !== undefined) {
      if (!VALID_VERBOSITY.includes(body.notificationVerbosity)) {
        return NextResponse.json(
          { error: `notificationVerbosity must be one of: ${VALID_VERBOSITY.join(', ')}` },
          { status: 400 }
        );
      }
    }

    if (body.anthropicDailyUsd !== undefined) {
      if (typeof body.anthropicDailyUsd !== 'number' || body.anthropicDailyUsd < 0) {
        return NextResponse.json(
          { error: 'anthropicDailyUsd must be a non-negative number' },
          { status: 400 }
        );
      }
    }

    if (body.anthropicMonthlyUsd !== undefined) {
      if (typeof body.anthropicMonthlyUsd !== 'number' || body.anthropicMonthlyUsd < 0) {
        return NextResponse.json(
          { error: 'anthropicMonthlyUsd must be a non-negative number' },
          { status: 400 }
        );
      }
    }

    if (body.apifyMonthlyUsd !== undefined) {
      if (typeof body.apifyMonthlyUsd !== 'number' || body.apifyMonthlyUsd < 0) {
        return NextResponse.json(
          { error: 'apifyMonthlyUsd must be a non-negative number' },
          { status: 400 }
        );
      }
    }

    if (body.smaugPollIntervalMinutes !== undefined) {
      if (
        typeof body.smaugPollIntervalMinutes !== 'number' ||
        body.smaugPollIntervalMinutes < 1 ||
        body.smaugPollIntervalMinutes > 60
      ) {
        return NextResponse.json(
          { error: 'smaugPollIntervalMinutes must be between 1 and 60' },
          { status: 400 }
        );
      }
    }

    if (body.apifyTier1IntervalMinutes !== undefined) {
      if (
        typeof body.apifyTier1IntervalMinutes !== 'number' ||
        body.apifyTier1IntervalMinutes < 15 ||
        body.apifyTier1IntervalMinutes > 180
      ) {
        return NextResponse.json(
          { error: 'apifyTier1IntervalMinutes must be between 15 and 180' },
          { status: 400 }
        );
      }
    }

    if (body.apifyTier2IntervalMinutes !== undefined) {
      if (
        typeof body.apifyTier2IntervalMinutes !== 'number' ||
        body.apifyTier2IntervalMinutes < 60 ||
        body.apifyTier2IntervalMinutes > 480
      ) {
        return NextResponse.json(
          { error: 'apifyTier2IntervalMinutes must be between 60 and 480' },
          { status: 400 }
        );
      }
    }

    // Persist autoHumanize setting to database
    if (body.autoHumanize !== undefined) {
      if (typeof body.autoHumanize !== 'boolean') {
        return NextResponse.json({ error: 'autoHumanize must be a boolean' }, { status: 400 });
      }
      setHumanizerSettings({ autoHumanize: body.autoHumanize });
    }

    return NextResponse.json({
      success: true,
      message: 'Settings saved successfully.',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to update settings: ${errorMessage}` },
      { status: 500 }
    );
  }
}
