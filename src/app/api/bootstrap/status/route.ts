import { NextResponse } from 'next/server';
import { getVoiceCorpusStatus } from '@/lib/voice/embeddings';
import { countAccounts } from '@/db/models/accounts';
import { countFormulas, getActiveFormulas } from '@/db/models/formulas';
import { healthCheck } from '@/db/qdrant/connection';
import { seedStarterFormulas } from '@/lib/formulas/loader';

interface BootstrapStatus {
  voiceGuidelinesLoaded: boolean;
  approvedPostsCount: number;
  hasMinimumCorpus: boolean;
  accountsCount: number;
  formulasCount: number;
  hasActiveFormula: boolean;
  apiKeysConfigured: {
    anthropic: boolean;
    apify: boolean;
  };
  discordWebhookConfigured: boolean;
  isReady: boolean;
  missingRequirements: string[];
  qdrantAvailable: boolean;
}

export async function GET(): Promise<NextResponse<BootstrapStatus>> {
  // Check Qdrant availability first
  const qdrantAvailable = await healthCheck();

  const voiceCorpusStatus = await getVoiceCorpusStatus();
  const accountsCount = countAccounts();

  // Auto-seed starter formulas if none exist
  let formulasCount = countFormulas();
  if (formulasCount === 0) {
    const seedResult = seedStarterFormulas();
    formulasCount = seedResult.seeded;
  }

  const activeFormulas = getActiveFormulas();

  const anthropicConfigured = !!process.env.ANTHROPIC_API_KEY;
  const apifyConfigured = !!process.env.APIFY_API_TOKEN;
  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
  const discordConfigured =
    !!discordWebhook && discordWebhook.startsWith('https://discord.com/api/webhooks/');

  const missingRequirements: string[] = [];

  if (!qdrantAvailable) {
    missingRequirements.push(
      'Qdrant vector database not available - start Docker and run: docker run -d -p 6333:6333 qdrant/qdrant'
    );
  }

  if (!voiceCorpusStatus.guidelinesLoaded) {
    missingRequirements.push('Voice guidelines not loaded');
  }

  // Minimum 20 examples required, 50 recommended
  const MIN_EXAMPLES = 20;
  if (voiceCorpusStatus.approvedPostsCount < MIN_EXAMPLES) {
    missingRequirements.push(
      `Need ${MIN_EXAMPLES - voiceCorpusStatus.approvedPostsCount} more gold examples (${voiceCorpusStatus.approvedPostsCount}/${MIN_EXAMPLES} minimum)`
    );
  }

  if (activeFormulas.length === 0) {
    missingRequirements.push('No active formulas');
  }

  if (!anthropicConfigured) {
    missingRequirements.push('Anthropic API key not configured');
  }

  // isReady requires: guidelines + minimum examples + active formula + anthropic key
  const isReady =
    voiceCorpusStatus.guidelinesLoaded &&
    voiceCorpusStatus.approvedPostsCount >= MIN_EXAMPLES &&
    activeFormulas.length >= 1 &&
    anthropicConfigured;

  const status: BootstrapStatus = {
    voiceGuidelinesLoaded: voiceCorpusStatus.guidelinesLoaded,
    approvedPostsCount: voiceCorpusStatus.approvedPostsCount,
    hasMinimumCorpus: voiceCorpusStatus.hasMinimumCorpus,
    accountsCount,
    formulasCount,
    hasActiveFormula: activeFormulas.length > 0,
    apiKeysConfigured: {
      anthropic: anthropicConfigured,
      apify: apifyConfigured,
    },
    discordWebhookConfigured: discordConfigured,
    isReady,
    missingRequirements,
    qdrantAvailable,
  };

  return NextResponse.json(status);
}
