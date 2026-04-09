import type { NotificationType, NotificationVerbosity, NotificationPreferences } from '@/types';

export interface DiscordConfig {
  webhookUrl: string;
  verbosity: NotificationVerbosity;
  enabledTypes: NotificationPreferences['enabledTypes'];
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
}

export interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

export interface SendResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export class DiscordWebhookError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'DiscordWebhookError';
  }
}

const EMBED_COLORS = {
  content_ready: 0x00ff00, // Green
  time_sensitive: 0xff9900, // Orange
  agent_stuck: 0xff0000, // Red
  budget_warning: 0xffff00, // Yellow
  info: 0x0099ff, // Blue
} as const;

const URGENCY_INDICATORS = {
  low: '',
  medium: '⚠️ ',
  high: '🚨 ',
} as const;

let discordConfig: DiscordConfig | null = null;

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

export function getDiscordConfig(): DiscordConfig {
  if (discordConfig) {
    return discordConfig;
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('DISCORD_WEBHOOK_URL environment variable is not set');
  }

  const verbosityEnv = process.env.DISCORD_NOTIFICATION_VERBOSITY ?? 'summary';
  const validVerbosities: NotificationVerbosity[] = ['minimal', 'summary', 'rich'];
  const verbosity: NotificationVerbosity = validVerbosities.includes(
    verbosityEnv as NotificationVerbosity
  )
    ? (verbosityEnv as NotificationVerbosity)
    : 'summary';

  const enabledTypes: NotificationPreferences['enabledTypes'] = {
    content_ready: getEnvBoolean('DISCORD_NOTIFY_CONTENT_READY', true),
    time_sensitive: getEnvBoolean('DISCORD_NOTIFY_TIME_SENSITIVE', true),
    agent_stuck: getEnvBoolean('DISCORD_NOTIFY_AGENT_STUCK', true),
    budget_warning: getEnvBoolean('DISCORD_NOTIFY_BUDGET_WARNING', true),
  };

  discordConfig = {
    webhookUrl,
    verbosity,
    enabledTypes,
  };

  return discordConfig;
}

export function isNotificationTypeEnabled(type: NotificationType): boolean {
  const config = getDiscordConfig();
  return config.enabledTypes[type];
}

export function resetDiscordConfig(): void {
  discordConfig = null;
}

export function setDiscordConfig(config: DiscordConfig): void {
  discordConfig = config;
}

export function isDiscordConfigured(): boolean {
  try {
    getDiscordConfig();
    return true;
  } catch {
    return false;
  }
}

export function getEmbedColor(type: NotificationType | 'info'): number {
  return EMBED_COLORS[type];
}

export function getUrgencyIndicator(urgency: 'low' | 'medium' | 'high'): string {
  return URGENCY_INDICATORS[urgency];
}

export async function sendWebhook(message: DiscordMessage): Promise<SendResult> {
  const config = getDiscordConfig();

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...message,
        username: message.username ?? 'AI Social Engine',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new DiscordWebhookError(
        `Discord webhook failed: ${response.status}`,
        response.status,
        body
      );
    }

    return {
      success: true,
      statusCode: response.status,
    };
  } catch (error) {
    if (error instanceof DiscordWebhookError) {
      return {
        success: false,
        statusCode: error.statusCode,
        error: error.message,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function sendSimpleMessage(content: string): Promise<SendResult> {
  return sendWebhook({ content });
}

export async function sendEmbed(embed: DiscordEmbed): Promise<SendResult> {
  return sendWebhook({ embeds: [embed] });
}

export async function sendNotification(
  type: NotificationType,
  title: string,
  message: string,
  urgency: 'low' | 'medium' | 'high' = 'medium',
  additionalFields?: Array<{ name: string; value: string; inline?: boolean }>
): Promise<SendResult> {
  const config = getDiscordConfig();
  const indicator = getUrgencyIndicator(urgency);

  if (config.verbosity === 'minimal') {
    return sendSimpleMessage(`${indicator}**${title}**: ${message}`);
  }

  const embed: DiscordEmbed = {
    title: `${indicator}${title}`,
    description: message,
    color: getEmbedColor(type),
    timestamp: new Date().toISOString(),
  };

  if (config.verbosity === 'rich' && additionalFields && additionalFields.length > 0) {
    embed.fields = additionalFields;
  }

  return sendEmbed(embed);
}

export function healthCheck(): boolean {
  try {
    const config = getDiscordConfig();
    const url = new URL(config.webhookUrl);
    return url.hostname === 'discord.com' || url.hostname === 'discordapp.com';
  } catch {
    return false;
  }
}

export { sendTypedNotification } from './send';
export type {
  ContentReadyPayload,
  TimeSensitivePayload,
  AgentStuckPayload,
  BudgetWarningPayload,
} from './templates';
