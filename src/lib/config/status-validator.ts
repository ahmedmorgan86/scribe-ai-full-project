/**
 * Configuration Status Validator
 *
 * Provides accurate validation of system configuration state by checking
 * actual data in the database and services, not just env var presence.
 */

import { countAccounts } from '@/db/models/accounts';
import { countPosts } from '@/db/models/posts';
import { countFormulas, getActiveFormulas } from '@/db/models/formulas';
import {
  QDRANT_COLLECTION_NAMES,
  collectionExists,
  healthCheck as qdrantHealthCheck,
} from '@/db/qdrant/connection';
import { countDocuments } from '@/db/qdrant/embeddings';
import { createLogger } from '@/lib/logger';

const logger = createLogger('config:status-validator');

export type ConfigStatus = 'configured' | 'not_configured' | 'partial' | 'error';

export interface ConfigItemStatus {
  name: string;
  status: ConfigStatus;
  details: string;
  count?: number;
  required: boolean;
}

export interface ConfigValidationResult {
  isReady: boolean;
  items: ConfigItemStatus[];
  missingRequired: string[];
  summary: {
    configured: number;
    notConfigured: number;
    partial: number;
    errors: number;
  };
}

export interface ValidatorOptions {
  skipQdrant?: boolean;
  skipLLM?: boolean;
}

/**
 * Check if voice guidelines exist in Qdrant
 */
export async function checkVoiceGuidelines(skipQdrant = false): Promise<ConfigItemStatus> {
  const name = 'Voice Guidelines';

  if (skipQdrant) {
    return {
      name,
      status: 'not_configured',
      details: 'Qdrant check skipped',
      required: true,
    };
  }

  try {
    const exists = await collectionExists(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
    if (!exists) {
      return {
        name,
        status: 'not_configured',
        details: 'Voice guidelines collection does not exist',
        count: 0,
        required: true,
      };
    }

    const count = await countDocuments(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
    if (count === 0) {
      return {
        name,
        status: 'not_configured',
        details: 'No voice guidelines loaded',
        count: 0,
        required: true,
      };
    }

    return {
      name,
      status: 'configured',
      details: `${count} guideline${count === 1 ? '' : 's'} loaded`,
      count,
      required: true,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Error checking voice guidelines', { error: msg });
    return {
      name,
      status: 'error',
      details: `Failed to check: ${msg}`,
      required: true,
    };
  }
}

/**
 * Check if gold examples (approved posts) exist
 */
export async function checkGoldExamples(skipQdrant = false): Promise<ConfigItemStatus> {
  const name = 'Gold Examples';
  const MINIMUM_EXAMPLES = 20;
  const RECOMMENDED_EXAMPLES = 50;

  if (skipQdrant) {
    // Fall back to counting approved posts in SQLite
    try {
      const count = countPosts('approved');
      if (count === 0) {
        return {
          name,
          status: 'not_configured',
          details: 'No approved posts found',
          count: 0,
          required: false,
        };
      }
      if (count < MINIMUM_EXAMPLES) {
        return {
          name,
          status: 'partial',
          details: `${count} approved posts (min: ${MINIMUM_EXAMPLES})`,
          count,
          required: false,
        };
      }
      if (count < RECOMMENDED_EXAMPLES) {
        return {
          name,
          status: 'partial',
          details: `${count} approved posts (recommended: ${RECOMMENDED_EXAMPLES})`,
          count,
          required: false,
        };
      }
      return {
        name,
        status: 'configured',
        details: `${count} approved posts`,
        count,
        required: false,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        name,
        status: 'error',
        details: `Failed to check: ${msg}`,
        required: false,
      };
    }
  }

  try {
    const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
    if (!exists) {
      return {
        name,
        status: 'not_configured',
        details: 'Approved posts collection does not exist',
        count: 0,
        required: false,
      };
    }

    // Filter by content_type: 'gold_example' to match bootstrap count
    const count = await countDocuments(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, {
      must: [{ key: 'content_type', match: { value: 'gold_example' } }],
    });
    if (count === 0) {
      return {
        name,
        status: 'not_configured',
        details: 'No gold examples added',
        count: 0,
        required: false,
      };
    }

    if (count < MINIMUM_EXAMPLES) {
      return {
        name,
        status: 'partial',
        details: `${count} examples (minimum: ${MINIMUM_EXAMPLES})`,
        count,
        required: false,
      };
    }

    if (count < RECOMMENDED_EXAMPLES) {
      return {
        name,
        status: 'partial',
        details: `${count} examples (recommended: ${RECOMMENDED_EXAMPLES})`,
        count,
        required: false,
      };
    }

    return {
      name,
      status: 'configured',
      details: `${count} examples loaded`,
      count,
      required: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Error checking gold examples', { error: msg });
    return {
      name,
      status: 'error',
      details: `Failed to check: ${msg}`,
      required: false,
    };
  }
}

/**
 * Check if curated accounts exist in DB
 */
export function checkCuratedAccounts(): ConfigItemStatus {
  const name = 'Curated Accounts';

  try {
    const count = countAccounts();
    if (count === 0) {
      return {
        name,
        status: 'not_configured',
        details: 'No accounts imported',
        count: 0,
        required: false,
      };
    }

    return {
      name,
      status: 'configured',
      details: `${count} account${count === 1 ? '' : 's'} imported`,
      count,
      required: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Error checking curated accounts', { error: msg });
    return {
      name,
      status: 'error',
      details: `Failed to check: ${msg}`,
      required: false,
    };
  }
}

/**
 * Check if LLM provider is configured with valid API key
 */
export function checkLLMProvider(skipValidation = false): ConfigItemStatus {
  const name = 'LLM Provider';

  if (skipValidation) {
    return {
      name,
      status: 'not_configured',
      details: 'Validation skipped',
      required: true,
    };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Check Anthropic (primary)
  if (anthropicKey) {
    if (!anthropicKey.startsWith('sk-ant-')) {
      return {
        name,
        status: 'error',
        details: 'Anthropic API key has invalid format',
        required: true,
      };
    }
    return {
      name,
      status: 'configured',
      details: 'Anthropic API configured',
      required: true,
    };
  }

  // Check OpenAI (fallback)
  if (openaiKey) {
    if (!openaiKey.startsWith('sk-')) {
      return {
        name,
        status: 'error',
        details: 'OpenAI API key has invalid format',
        required: true,
      };
    }
    return {
      name,
      status: 'configured',
      details: 'OpenAI API configured (fallback)',
      required: true,
    };
  }

  return {
    name,
    status: 'not_configured',
    details: 'No LLM provider API key configured',
    required: true,
  };
}

/**
 * Check if Qdrant is available and collections exist
 */
export async function checkQdrant(skipQdrant = false): Promise<ConfigItemStatus> {
  const name = 'Vector Database (Qdrant)';

  if (skipQdrant) {
    return {
      name,
      status: 'not_configured',
      details: 'Qdrant check skipped',
      required: false,
    };
  }

  try {
    const isHealthy = await qdrantHealthCheck();
    if (!isHealthy) {
      return {
        name,
        status: 'not_configured',
        details: 'Qdrant is not reachable',
        required: false,
      };
    }

    // Check if required collections exist
    const [approvedExists, guidelinesExists] = await Promise.all([
      collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS),
      collectionExists(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES),
    ]);

    if (!approvedExists && !guidelinesExists) {
      return {
        name,
        status: 'partial',
        details: 'Qdrant online, no collections created',
        required: false,
      };
    }

    const collections = [];
    if (approvedExists) collections.push('approved_posts');
    if (guidelinesExists) collections.push('voice_guidelines');

    return {
      name,
      status: 'configured',
      details: `Collections: ${collections.join(', ')}`,
      required: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Error checking Qdrant', { error: msg });
    return {
      name,
      status: 'error',
      details: `Failed to check: ${msg}`,
      required: false,
    };
  }
}

/**
 * Check if at least one active formula exists
 */
export function checkFormulas(): ConfigItemStatus {
  const name = 'Content Formulas';

  try {
    const totalCount = countFormulas();
    const activeFormulas = getActiveFormulas();
    const activeCount = activeFormulas.length;

    if (totalCount === 0) {
      return {
        name,
        status: 'not_configured',
        details: 'No formulas configured',
        count: 0,
        required: true,
      };
    }

    if (activeCount === 0) {
      return {
        name,
        status: 'partial',
        details: `${totalCount} formula${totalCount === 1 ? '' : 's'} (none active)`,
        count: totalCount,
        required: true,
      };
    }

    return {
      name,
      status: 'configured',
      details: `${activeCount} active formula${activeCount === 1 ? '' : 's'}`,
      count: activeCount,
      required: true,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Error checking formulas', { error: msg });
    return {
      name,
      status: 'error',
      details: `Failed to check: ${msg}`,
      required: true,
    };
  }
}

/**
 * Check if Discord webhook is configured
 */
export function checkDiscordWebhook(): ConfigItemStatus {
  const name = 'Discord Webhook';

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();

  // Check if URL exists and is not empty
  if (!webhookUrl || webhookUrl === '') {
    return {
      name,
      status: 'not_configured',
      details: 'No webhook URL configured',
      required: false,
    };
  }

  // Basic URL validation - must start with Discord webhooks URL
  if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    return {
      name,
      status: 'error',
      details: 'Invalid Discord webhook URL format',
      required: false,
    };
  }

  return {
    name,
    status: 'configured',
    details: 'Webhook configured',
    required: false,
  };
}

/**
 * Validate all configuration items and return comprehensive status
 */
export async function validateAllConfig(
  options: ValidatorOptions = {}
): Promise<ConfigValidationResult> {
  const { skipQdrant = false, skipLLM = false } = options;

  // Run all checks (parallel where possible)
  const [voiceGuidelines, goldExamples, qdrant] = await Promise.all([
    checkVoiceGuidelines(skipQdrant),
    checkGoldExamples(skipQdrant),
    checkQdrant(skipQdrant),
  ]);

  // Synchronous checks
  const curatedAccounts = checkCuratedAccounts();
  const llmProvider = checkLLMProvider(skipLLM);
  const formulas = checkFormulas();
  const discordWebhook = checkDiscordWebhook();

  const items: ConfigItemStatus[] = [
    voiceGuidelines,
    goldExamples,
    curatedAccounts,
    llmProvider,
    qdrant,
    formulas,
    discordWebhook,
  ];

  // Calculate summary
  const summary = {
    configured: 0,
    notConfigured: 0,
    partial: 0,
    errors: 0,
  };

  const missingRequired: string[] = [];

  for (const item of items) {
    switch (item.status) {
      case 'configured':
        summary.configured++;
        break;
      case 'not_configured':
        summary.notConfigured++;
        if (item.required) {
          missingRequired.push(item.name);
        }
        break;
      case 'partial':
        summary.partial++;
        break;
      case 'error':
        summary.errors++;
        if (item.required) {
          missingRequired.push(`${item.name} (error)`);
        }
        break;
    }
  }

  // System is ready if all required items are configured (or partial is acceptable)
  const isReady = missingRequired.length === 0;

  return {
    isReady,
    items,
    missingRequired,
    summary,
  };
}

/**
 * Get a quick status check for dashboard display
 * Returns simplified status for each config item
 */
export async function getDashboardConfigStatus(options: ValidatorOptions = {}): Promise<{
  voiceGuidelines: { configured: boolean; count: number };
  goldExamples: { configured: boolean; count: number; sufficient: boolean };
  accounts: { configured: boolean; count: number };
  llm: { configured: boolean; provider: string | null };
  qdrant: { available: boolean; collections: string[] };
  formulas: { configured: boolean; activeCount: number };
  discord: { configured: boolean };
  isReady: boolean;
}> {
  const result = await validateAllConfig(options);

  const voiceItem = result.items.find((i) => i.name === 'Voice Guidelines');
  const goldItem = result.items.find((i) => i.name === 'Gold Examples');
  const accountsItem = result.items.find((i) => i.name === 'Curated Accounts');
  const llmItem = result.items.find((i) => i.name === 'LLM Provider');
  const qdrantItem = result.items.find((i) => i.name === 'Vector Database (Qdrant)');
  const formulasItem = result.items.find((i) => i.name === 'Content Formulas');
  const discordItem = result.items.find((i) => i.name === 'Discord Webhook');

  // Determine LLM provider
  let llmProvider: string | null = null;
  if (llmItem?.status === 'configured') {
    if (llmItem.details.includes('Anthropic')) llmProvider = 'anthropic';
    else if (llmItem.details.includes('OpenAI')) llmProvider = 'openai';
  }

  // Extract Qdrant collections from details
  const qdrantCollections: string[] = [];
  if (qdrantItem?.status === 'configured' && qdrantItem.details.includes('Collections:')) {
    const collectionsStr = qdrantItem.details.replace('Collections: ', '');
    qdrantCollections.push(...collectionsStr.split(', '));
  }

  return {
    voiceGuidelines: {
      configured: voiceItem?.status === 'configured',
      count: voiceItem?.count ?? 0,
    },
    goldExamples: {
      configured: goldItem?.status === 'configured',
      count: goldItem?.count ?? 0,
      sufficient: (goldItem?.count ?? 0) >= 20,
    },
    accounts: {
      configured: accountsItem?.status === 'configured',
      count: accountsItem?.count ?? 0,
    },
    llm: {
      configured: llmItem?.status === 'configured',
      provider: llmProvider,
    },
    qdrant: {
      available: qdrantItem?.status === 'configured' || qdrantItem?.status === 'partial',
      collections: qdrantCollections,
    },
    formulas: {
      configured: formulasItem?.status === 'configured',
      activeCount: formulasItem?.count ?? 0,
    },
    discord: {
      configured: discordItem?.status === 'configured',
    },
    isReady: result.isReady,
  };
}
