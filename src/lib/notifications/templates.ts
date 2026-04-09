import type { NotificationType, NotificationVerbosity, Post, VoiceScore } from '@/types';
import type { DiscordEmbed, DiscordMessage } from './discord';
import { getEmbedColor, getUrgencyIndicator } from './discord';

export interface ContentReadyPayload {
  queueCount: number;
  highConfidenceCount: number;
  posts?: Array<{
    id: string;
    content: string;
    confidenceScore: number;
    voiceScore?: VoiceScore;
  }>;
}

export interface TimeSensitivePayload {
  post: Pick<Post, 'id' | 'content' | 'confidenceScore' | 'reasoning'>;
  expiresIn?: string;
  sourceUrl?: string;
}

export interface AgentStuckPayload {
  reason: 'contradiction' | 'repeated_rejection' | 'budget_depleted' | 'api_error' | 'unknown';
  details: string;
  rejectionCount?: number;
  patternDescription?: string;
  errorMessage?: string;
}

export interface BudgetWarningPayload {
  apiName: 'anthropic' | 'apify' | 'smaug';
  period: 'daily' | 'monthly';
  usedUsd: number;
  limitUsd: number;
  percentUsed: number;
}

export type NotificationPayload = {
  content_ready: ContentReadyPayload;
  time_sensitive: TimeSensitivePayload;
  agent_stuck: AgentStuckPayload;
  budget_warning: BudgetWarningPayload;
};

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function getConfidenceBadge(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  return '🔴';
}

function buildContentReadyMinimal(payload: ContentReadyPayload): DiscordMessage {
  const indicator = getUrgencyIndicator('low');
  return {
    content: `${indicator}**Content Ready**: ${payload.queueCount} posts awaiting review (${payload.highConfidenceCount} high confidence)`,
  };
}

function buildContentReadySummary(payload: ContentReadyPayload): DiscordMessage {
  const embed: DiscordEmbed = {
    title: '📝 Content Ready for Review',
    description: `${payload.queueCount} posts are waiting in the queue`,
    color: getEmbedColor('content_ready'),
    fields: [
      {
        name: 'High Confidence',
        value: String(payload.highConfidenceCount),
        inline: true,
      },
      {
        name: 'Needs Review',
        value: String(payload.queueCount - payload.highConfidenceCount),
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  return { embeds: [embed] };
}

function buildContentReadyRich(payload: ContentReadyPayload): DiscordMessage {
  const fields: DiscordEmbed['fields'] = [
    {
      name: 'Queue Summary',
      value: `**Total:** ${payload.queueCount} | **High Confidence:** ${payload.highConfidenceCount}`,
      inline: false,
    },
  ];

  if (payload.posts && payload.posts.length > 0) {
    const previews = payload.posts.slice(0, 3).map((post) => {
      const badge = getConfidenceBadge(post.confidenceScore);
      const preview = truncate(post.content, 100);
      return `${badge} ${formatPercent(post.confidenceScore)} - "${preview}"`;
    });

    fields.push({
      name: 'Top Posts',
      value: previews.join('\n'),
      inline: false,
    });
  }

  const embed: DiscordEmbed = {
    title: '📝 Content Ready for Review',
    description: 'New content has been generated and is awaiting your review.',
    color: getEmbedColor('content_ready'),
    fields,
    footer: { text: 'Use keyboard shortcuts: A (approve), R (reject), E (edit)' },
    timestamp: new Date().toISOString(),
  };

  return { embeds: [embed] };
}

function buildTimeSensitiveMinimal(payload: TimeSensitivePayload): DiscordMessage {
  const indicator = getUrgencyIndicator('high');
  const preview = truncate(payload.post.content, 80);
  return {
    content: `${indicator}**Time-Sensitive**: "${preview}" ${payload.expiresIn ? `(expires ${payload.expiresIn})` : ''}`,
  };
}

function buildTimeSensitiveSummary(payload: TimeSensitivePayload): DiscordMessage {
  const embed: DiscordEmbed = {
    title: '🚨 Time-Sensitive Content Opportunity',
    description: truncate(payload.post.content, 280),
    color: getEmbedColor('time_sensitive'),
    fields: [
      {
        name: 'Confidence',
        value: formatPercent(payload.post.confidenceScore),
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  if (payload.expiresIn) {
    embed.fields?.push({
      name: 'Expires',
      value: payload.expiresIn,
      inline: true,
    });
  }

  return { embeds: [embed] };
}

function buildTimeSensitiveRich(payload: TimeSensitivePayload): DiscordMessage {
  const fields: DiscordEmbed['fields'] = [
    {
      name: 'Content',
      value: payload.post.content,
      inline: false,
    },
    {
      name: 'Confidence',
      value: formatPercent(payload.post.confidenceScore),
      inline: true,
    },
  ];

  if (payload.expiresIn) {
    fields.push({
      name: 'Expires',
      value: payload.expiresIn,
      inline: true,
    });
  }

  if (payload.post.reasoning?.whyItWorks) {
    fields.push({
      name: 'Why It Works',
      value: truncate(payload.post.reasoning.whyItWorks, 200),
      inline: false,
    });
  }
  if (payload.post.reasoning?.timing) {
    fields.push({
      name: 'Timing Rationale',
      value: payload.post.reasoning.timing,
      inline: false,
    });
  }

  if (payload.sourceUrl) {
    fields.push({
      name: 'Source',
      value: payload.sourceUrl,
      inline: false,
    });
  }

  const embed: DiscordEmbed = {
    title: '🚨 Time-Sensitive Content Opportunity',
    description: 'This content is time-sensitive and should be reviewed immediately.',
    color: getEmbedColor('time_sensitive'),
    fields,
    footer: { text: 'Act quickly - this opportunity may expire soon' },
    timestamp: new Date().toISOString(),
  };

  return { embeds: [embed] };
}

function getStuckReasonTitle(reason: AgentStuckPayload['reason']): string {
  switch (reason) {
    case 'contradiction':
      return 'Conflicting Patterns Detected';
    case 'repeated_rejection':
      return 'Stuck on Repeated Rejections';
    case 'budget_depleted':
      return 'Budget Depleted';
    case 'api_error':
      return 'API Error';
    default:
      return 'Agent Needs Help';
  }
}

function buildAgentStuckMinimal(payload: AgentStuckPayload): DiscordMessage {
  const indicator = getUrgencyIndicator('high');
  const title = getStuckReasonTitle(payload.reason);
  return {
    content: `${indicator}**Agent Stuck - ${title}**: ${truncate(payload.details, 100)}`,
  };
}

function buildAgentStuckSummary(payload: AgentStuckPayload): DiscordMessage {
  const title = getStuckReasonTitle(payload.reason);
  const fields: DiscordEmbed['fields'] = [];

  if (payload.rejectionCount !== undefined) {
    fields.push({
      name: 'Rejection Count',
      value: String(payload.rejectionCount),
      inline: true,
    });
  }

  const embed: DiscordEmbed = {
    title: `🚨 ${title}`,
    description: payload.details,
    color: getEmbedColor('agent_stuck'),
    fields: fields.length > 0 ? fields : undefined,
    timestamp: new Date().toISOString(),
  };

  return { embeds: [embed] };
}

function buildAgentStuckRich(payload: AgentStuckPayload): DiscordMessage {
  const title = getStuckReasonTitle(payload.reason);
  const fields: DiscordEmbed['fields'] = [
    {
      name: 'Issue Type',
      value: payload.reason.replace('_', ' ').toUpperCase(),
      inline: true,
    },
  ];

  if (payload.rejectionCount !== undefined) {
    fields.push({
      name: 'Rejection Count',
      value: String(payload.rejectionCount),
      inline: true,
    });
  }

  fields.push({
    name: 'Details',
    value: payload.details,
    inline: false,
  });

  if (payload.patternDescription) {
    fields.push({
      name: 'Pattern',
      value: payload.patternDescription,
      inline: false,
    });
  }

  if (payload.errorMessage) {
    fields.push({
      name: 'Error Message',
      value: `\`\`\`${truncate(payload.errorMessage, 500)}\`\`\``,
      inline: false,
    });
  }

  let suggestion = '';
  switch (payload.reason) {
    case 'contradiction':
      suggestion = 'Visit the Knowledge Base to resolve conflicting patterns.';
      break;
    case 'repeated_rejection':
      suggestion = 'Consider adding more training examples or adjusting voice guidelines.';
      break;
    case 'budget_depleted':
      suggestion = 'Check Settings to adjust budget limits or wait for the next period.';
      break;
    case 'api_error':
      suggestion = 'Check API status and credentials. Retry may be needed.';
      break;
    default:
      suggestion = 'Review the agent logs for more details.';
  }

  const embed: DiscordEmbed = {
    title: `🚨 ${title}`,
    description: 'The agent has encountered an issue and needs your attention.',
    color: getEmbedColor('agent_stuck'),
    fields,
    footer: { text: suggestion },
    timestamp: new Date().toISOString(),
  };

  return { embeds: [embed] };
}

function getBudgetWarningUrgency(percentUsed: number): 'low' | 'medium' | 'high' {
  if (percentUsed >= 95) return 'high';
  if (percentUsed >= 80) return 'medium';
  return 'low';
}

function buildBudgetWarningMinimal(payload: BudgetWarningPayload): DiscordMessage {
  const urgency = getBudgetWarningUrgency(payload.percentUsed);
  const indicator = getUrgencyIndicator(urgency);
  return {
    content: `${indicator}**Budget Warning**: ${payload.apiName} ${payload.period} budget at ${formatPercent(payload.percentUsed)} (${formatUsd(payload.usedUsd)}/${formatUsd(payload.limitUsd)})`,
  };
}

function buildBudgetWarningSummary(payload: BudgetWarningPayload): DiscordMessage {
  const remaining = payload.limitUsd - payload.usedUsd;
  const embed: DiscordEmbed = {
    title: '⚠️ Budget Warning',
    description: `${payload.apiName.toUpperCase()} ${payload.period} budget is at ${formatPercent(payload.percentUsed)}`,
    color: getEmbedColor('budget_warning'),
    fields: [
      {
        name: 'Used',
        value: formatUsd(payload.usedUsd),
        inline: true,
      },
      {
        name: 'Limit',
        value: formatUsd(payload.limitUsd),
        inline: true,
      },
      {
        name: 'Remaining',
        value: formatUsd(remaining),
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  return { embeds: [embed] };
}

function buildBudgetWarningRich(payload: BudgetWarningPayload): DiscordMessage {
  const remaining = payload.limitUsd - payload.usedUsd;
  const urgency = getBudgetWarningUrgency(payload.percentUsed);

  let statusMessage = '';
  if (payload.percentUsed >= 95) {
    statusMessage = '🔴 Critical - Operations may be halted soon';
  } else if (payload.percentUsed >= 80) {
    statusMessage = '🟡 Warning - Approaching limit';
  } else {
    statusMessage = '🟢 Advisory - Budget usage increasing';
  }

  const embed: DiscordEmbed = {
    title: `${getUrgencyIndicator(urgency)}Budget Warning - ${payload.apiName.toUpperCase()}`,
    description: statusMessage,
    color: getEmbedColor('budget_warning'),
    fields: [
      {
        name: 'Period',
        value: payload.period.charAt(0).toUpperCase() + payload.period.slice(1),
        inline: true,
      },
      {
        name: 'Usage',
        value: formatPercent(payload.percentUsed),
        inline: true,
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: true,
      },
      {
        name: 'Used',
        value: formatUsd(payload.usedUsd),
        inline: true,
      },
      {
        name: 'Limit',
        value: formatUsd(payload.limitUsd),
        inline: true,
      },
      {
        name: 'Remaining',
        value: formatUsd(remaining),
        inline: true,
      },
    ],
    footer: { text: 'Adjust limits in Settings → API Cost Limits' },
    timestamp: new Date().toISOString(),
  };

  return { embeds: [embed] };
}

type TemplateBuilder<T extends NotificationType> = {
  minimal: (payload: NotificationPayload[T]) => DiscordMessage;
  summary: (payload: NotificationPayload[T]) => DiscordMessage;
  rich: (payload: NotificationPayload[T]) => DiscordMessage;
};

const TEMPLATES: { [K in NotificationType]: TemplateBuilder<K> } = {
  content_ready: {
    minimal: buildContentReadyMinimal,
    summary: buildContentReadySummary,
    rich: buildContentReadyRich,
  },
  time_sensitive: {
    minimal: buildTimeSensitiveMinimal,
    summary: buildTimeSensitiveSummary,
    rich: buildTimeSensitiveRich,
  },
  agent_stuck: {
    minimal: buildAgentStuckMinimal,
    summary: buildAgentStuckSummary,
    rich: buildAgentStuckRich,
  },
  budget_warning: {
    minimal: buildBudgetWarningMinimal,
    summary: buildBudgetWarningSummary,
    rich: buildBudgetWarningRich,
  },
};

export function buildNotificationMessage<T extends NotificationType>(
  type: T,
  payload: NotificationPayload[T],
  verbosity: NotificationVerbosity
): DiscordMessage {
  const templateGroup = TEMPLATES[type] as TemplateBuilder<T>;
  const builder = templateGroup[verbosity];
  return builder(payload);
}

export function getDefaultVerbosityForType(type: NotificationType): NotificationVerbosity {
  if (type === 'time_sensitive') {
    return 'rich';
  }
  return 'summary';
}
