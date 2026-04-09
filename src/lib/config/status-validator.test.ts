import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkVoiceGuidelines,
  checkGoldExamples,
  checkCuratedAccounts,
  checkLLMProvider,
  checkQdrant,
  checkFormulas,
  checkDiscordWebhook,
  validateAllConfig,
  getDashboardConfigStatus,
} from './status-validator';

// Mock dependencies
vi.mock('@/db/models/accounts', () => ({
  countAccounts: vi.fn(),
}));

vi.mock('@/db/models/posts', () => ({
  countPosts: vi.fn(),
}));

vi.mock('@/db/models/formulas', () => ({
  countFormulas: vi.fn(),
  getActiveFormulas: vi.fn(),
}));

vi.mock('@/db/qdrant/connection', () => ({
  QDRANT_COLLECTION_NAMES: {
    APPROVED_POSTS: 'approved_posts',
    VOICE_GUIDELINES: 'voice_guidelines',
    SOURCES: 'sources',
    AI_SLOP_CORPUS: 'ai_slop_corpus',
  },
  collectionExists: vi.fn(),
  healthCheck: vi.fn(),
}));

vi.mock('@/db/qdrant/embeddings', () => ({
  countDocuments: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { countAccounts } from '@/db/models/accounts';
import { countPosts } from '@/db/models/posts';
import { countFormulas, getActiveFormulas } from '@/db/models/formulas';
import { collectionExists, healthCheck } from '@/db/qdrant/connection';
import { countDocuments } from '@/db/qdrant/embeddings';

describe('status-validator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('checkVoiceGuidelines', () => {
    it('returns not_configured when skipQdrant is true', async () => {
      const result = await checkVoiceGuidelines(true);
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('Qdrant check skipped');
    });

    it('returns not_configured when collection does not exist', async () => {
      vi.mocked(collectionExists).mockResolvedValue(false);

      const result = await checkVoiceGuidelines();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('Voice guidelines collection does not exist');
      expect(result.count).toBe(0);
    });

    it('returns not_configured when collection is empty', async () => {
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(0);

      const result = await checkVoiceGuidelines();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('No voice guidelines loaded');
    });

    it('returns configured when guidelines exist', async () => {
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(15);

      const result = await checkVoiceGuidelines();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('15 guidelines loaded');
      expect(result.count).toBe(15);
    });

    it('returns configured with singular form for 1 guideline', async () => {
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(1);

      const result = await checkVoiceGuidelines();
      expect(result.details).toBe('1 guideline loaded');
    });

    it('returns error status on exception', async () => {
      vi.mocked(collectionExists).mockRejectedValue(new Error('Connection failed'));

      const result = await checkVoiceGuidelines();
      expect(result.status).toBe('error');
      expect(result.details).toContain('Connection failed');
    });
  });

  describe('checkGoldExamples', () => {
    it('returns not_configured when skipQdrant and no approved posts', async () => {
      vi.mocked(countPosts).mockReturnValue(0);

      const result = await checkGoldExamples(true);
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('No approved posts found');
    });

    it('returns partial when skipQdrant and below minimum', async () => {
      vi.mocked(countPosts).mockReturnValue(10);

      const result = await checkGoldExamples(true);
      expect(result.status).toBe('partial');
      expect(result.details).toBe('10 approved posts (min: 20)');
    });

    it('returns partial when skipQdrant and below recommended', async () => {
      vi.mocked(countPosts).mockReturnValue(30);

      const result = await checkGoldExamples(true);
      expect(result.status).toBe('partial');
      expect(result.details).toBe('30 approved posts (recommended: 50)');
    });

    it('returns configured when skipQdrant and sufficient posts', async () => {
      vi.mocked(countPosts).mockReturnValue(50);

      const result = await checkGoldExamples(true);
      expect(result.status).toBe('configured');
      expect(result.details).toBe('50 approved posts');
    });

    it('returns error when skipQdrant and countPosts throws', async () => {
      vi.mocked(countPosts).mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await checkGoldExamples(true);
      expect(result.status).toBe('error');
      expect(result.details).toContain('DB error');
    });

    it('returns not_configured when collection does not exist', async () => {
      vi.mocked(collectionExists).mockResolvedValue(false);

      const result = await checkGoldExamples();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('Approved posts collection does not exist');
    });

    it('returns not_configured when collection is empty', async () => {
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(0);

      const result = await checkGoldExamples();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('No gold examples added');
    });

    it('returns partial when below minimum (20)', async () => {
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(15);

      const result = await checkGoldExamples();
      expect(result.status).toBe('partial');
      expect(result.details).toBe('15 examples (minimum: 20)');
    });

    it('returns partial when below recommended (50)', async () => {
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(35);

      const result = await checkGoldExamples();
      expect(result.status).toBe('partial');
      expect(result.details).toBe('35 examples (recommended: 50)');
    });

    it('returns configured when sufficient examples exist', async () => {
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(60);

      const result = await checkGoldExamples();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('60 examples loaded');
    });

    it('returns error status on exception', async () => {
      vi.mocked(collectionExists).mockRejectedValue(new Error('Qdrant timeout'));

      const result = await checkGoldExamples();
      expect(result.status).toBe('error');
      expect(result.details).toContain('Qdrant timeout');
    });
  });

  describe('checkCuratedAccounts', () => {
    it('returns not_configured when no accounts', () => {
      vi.mocked(countAccounts).mockReturnValue(0);

      const result = checkCuratedAccounts();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('No accounts imported');
      expect(result.count).toBe(0);
    });

    it('returns configured when accounts exist', () => {
      vi.mocked(countAccounts).mockReturnValue(25);

      const result = checkCuratedAccounts();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('25 accounts imported');
      expect(result.count).toBe(25);
    });

    it('uses singular form for 1 account', () => {
      vi.mocked(countAccounts).mockReturnValue(1);

      const result = checkCuratedAccounts();
      expect(result.details).toBe('1 account imported');
    });

    it('returns error status on exception', () => {
      vi.mocked(countAccounts).mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const result = checkCuratedAccounts();
      expect(result.status).toBe('error');
      expect(result.details).toContain('DB connection failed');
    });
  });

  describe('checkLLMProvider', () => {
    it('returns not_configured when skipValidation is true', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-valid-key';

      const result = checkLLMProvider(true);
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('Validation skipped');
    });

    it('returns not_configured when no API keys set', () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const result = checkLLMProvider();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('No LLM provider API key configured');
    });

    it('returns configured when Anthropic key is valid', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123';
      delete process.env.OPENAI_API_KEY;

      const result = checkLLMProvider();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('Anthropic API configured');
    });

    it('returns error when Anthropic key has invalid format', () => {
      process.env.ANTHROPIC_API_KEY = 'invalid-key';
      delete process.env.OPENAI_API_KEY;

      const result = checkLLMProvider();
      expect(result.status).toBe('error');
      expect(result.details).toBe('Anthropic API key has invalid format');
    });

    it('returns configured when OpenAI key is valid (fallback)', () => {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-test-openai-key';

      const result = checkLLMProvider();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('OpenAI API configured (fallback)');
    });

    it('returns error when OpenAI key has invalid format', () => {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = 'invalid-openai-key';

      const result = checkLLMProvider();
      expect(result.status).toBe('error');
      expect(result.details).toBe('OpenAI API key has invalid format');
    });

    it('prefers Anthropic over OpenAI when both configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.OPENAI_API_KEY = 'sk-openai-key';

      const result = checkLLMProvider();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('Anthropic API configured');
    });
  });

  describe('checkQdrant', () => {
    it('returns not_configured when skipQdrant is true', async () => {
      const result = await checkQdrant(true);
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('Qdrant check skipped');
    });

    it('returns not_configured when Qdrant is unreachable', async () => {
      vi.mocked(healthCheck).mockResolvedValue(false);

      const result = await checkQdrant();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('Qdrant is not reachable');
    });

    it('returns partial when Qdrant is healthy but no collections', async () => {
      vi.mocked(healthCheck).mockResolvedValue(true);
      vi.mocked(collectionExists).mockResolvedValue(false);

      const result = await checkQdrant();
      expect(result.status).toBe('partial');
      expect(result.details).toBe('Qdrant online, no collections created');
    });

    it('returns configured when collections exist', async () => {
      vi.mocked(healthCheck).mockResolvedValue(true);
      vi.mocked(collectionExists)
        .mockResolvedValueOnce(true) // approved_posts
        .mockResolvedValueOnce(true); // voice_guidelines

      const result = await checkQdrant();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('Collections: approved_posts, voice_guidelines');
    });

    it('returns configured with only approved_posts', async () => {
      vi.mocked(healthCheck).mockResolvedValue(true);
      vi.mocked(collectionExists)
        .mockResolvedValueOnce(true) // approved_posts
        .mockResolvedValueOnce(false); // voice_guidelines

      const result = await checkQdrant();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('Collections: approved_posts');
    });

    it('returns error status on exception', async () => {
      vi.mocked(healthCheck).mockRejectedValue(new Error('Network error'));

      const result = await checkQdrant();
      expect(result.status).toBe('error');
      expect(result.details).toContain('Network error');
    });
  });

  describe('checkFormulas', () => {
    it('returns not_configured when no formulas', () => {
      vi.mocked(countFormulas).mockReturnValue(0);
      vi.mocked(getActiveFormulas).mockReturnValue([]);

      const result = checkFormulas();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('No formulas configured');
      expect(result.count).toBe(0);
    });

    it('returns partial when formulas exist but none active', () => {
      vi.mocked(countFormulas).mockReturnValue(3);
      vi.mocked(getActiveFormulas).mockReturnValue([]);

      const result = checkFormulas();
      expect(result.status).toBe('partial');
      expect(result.details).toBe('3 formulas (none active)');
    });

    it('returns configured when active formulas exist', () => {
      vi.mocked(countFormulas).mockReturnValue(5);
      vi.mocked(getActiveFormulas).mockReturnValue([{ id: 1 }, { id: 2 }] as never);

      const result = checkFormulas();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('2 active formulas');
      expect(result.count).toBe(2);
    });

    it('uses singular form for 1 formula', () => {
      vi.mocked(countFormulas).mockReturnValue(1);
      vi.mocked(getActiveFormulas).mockReturnValue([]);

      const result = checkFormulas();
      expect(result.details).toBe('1 formula (none active)');
    });

    it('uses singular form for 1 active formula', () => {
      vi.mocked(countFormulas).mockReturnValue(1);
      vi.mocked(getActiveFormulas).mockReturnValue([{ id: 1 }] as never);

      const result = checkFormulas();
      expect(result.details).toBe('1 active formula');
    });

    it('returns error status on exception', () => {
      vi.mocked(countFormulas).mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = checkFormulas();
      expect(result.status).toBe('error');
      expect(result.details).toContain('DB error');
    });
  });

  describe('checkDiscordWebhook', () => {
    it('returns not_configured when no webhook URL', () => {
      delete process.env.DISCORD_WEBHOOK_URL;

      const result = checkDiscordWebhook();
      expect(result.status).toBe('not_configured');
      expect(result.details).toBe('No webhook URL configured');
    });

    it('returns error when webhook URL has invalid format', () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://invalid-url.com/webhook';

      const result = checkDiscordWebhook();
      expect(result.status).toBe('error');
      expect(result.details).toBe('Invalid Discord webhook URL format');
    });

    it('returns configured when valid webhook URL', () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

      const result = checkDiscordWebhook();
      expect(result.status).toBe('configured');
      expect(result.details).toBe('Webhook configured');
    });
  });

  describe('validateAllConfig', () => {
    beforeEach(() => {
      // Setup default mocks for a fully configured system
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(50);
      vi.mocked(healthCheck).mockResolvedValue(true);
      vi.mocked(countAccounts).mockReturnValue(10);
      vi.mocked(countFormulas).mockReturnValue(5);
      vi.mocked(getActiveFormulas).mockReturnValue([{ id: 1 }] as never);
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';
    });

    it('returns isReady true when all required items configured', async () => {
      const result = await validateAllConfig();

      expect(result.isReady).toBe(true);
      expect(result.missingRequired).toHaveLength(0);
    });

    it('returns isReady false when required item missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const result = await validateAllConfig();

      expect(result.isReady).toBe(false);
      expect(result.missingRequired).toContain('LLM Provider');
    });

    it('calculates summary correctly', async () => {
      vi.mocked(countAccounts).mockReturnValue(0); // not_configured

      const result = await validateAllConfig();

      expect(result.summary.configured).toBeGreaterThan(0);
      expect(result.summary.notConfigured).toBeGreaterThanOrEqual(1);
    });

    it('passes skipQdrant option correctly', async () => {
      const result = await validateAllConfig({ skipQdrant: true });

      const qdrantItem = result.items.find((i) => i.name === 'Vector Database (Qdrant)');
      expect(qdrantItem?.details).toBe('Qdrant check skipped');
    });

    it('passes skipLLM option correctly', async () => {
      const result = await validateAllConfig({ skipLLM: true });

      const llmItem = result.items.find((i) => i.name === 'LLM Provider');
      expect(llmItem?.details).toBe('Validation skipped');
    });

    it('includes all 7 config items', async () => {
      const result = await validateAllConfig();

      expect(result.items).toHaveLength(7);
      const names = result.items.map((i) => i.name);
      expect(names).toContain('Voice Guidelines');
      expect(names).toContain('Gold Examples');
      expect(names).toContain('Curated Accounts');
      expect(names).toContain('LLM Provider');
      expect(names).toContain('Vector Database (Qdrant)');
      expect(names).toContain('Content Formulas');
      expect(names).toContain('Discord Webhook');
    });

    it('tracks errors in missingRequired', async () => {
      vi.mocked(collectionExists).mockImplementation((name) => {
        if (name === 'voice_guidelines') {
          return Promise.reject(new Error('Connection error'));
        }
        return Promise.resolve(true);
      });

      const result = await validateAllConfig();

      expect(result.missingRequired).toContain('Voice Guidelines (error)');
      expect(result.isReady).toBe(false);
    });
  });

  describe('getDashboardConfigStatus', () => {
    beforeEach(() => {
      // Setup default mocks
      vi.mocked(collectionExists).mockResolvedValue(true);
      vi.mocked(countDocuments).mockResolvedValue(50);
      vi.mocked(healthCheck).mockResolvedValue(true);
      vi.mocked(countAccounts).mockReturnValue(10);
      vi.mocked(countFormulas).mockReturnValue(5);
      vi.mocked(getActiveFormulas).mockReturnValue([{ id: 1 }, { id: 2 }] as never);
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';
    });

    it('returns structured dashboard status', async () => {
      const result = await getDashboardConfigStatus();

      expect(result).toHaveProperty('voiceGuidelines');
      expect(result).toHaveProperty('goldExamples');
      expect(result).toHaveProperty('accounts');
      expect(result).toHaveProperty('llm');
      expect(result).toHaveProperty('qdrant');
      expect(result).toHaveProperty('formulas');
      expect(result).toHaveProperty('discord');
      expect(result).toHaveProperty('isReady');
    });

    it('returns correct voiceGuidelines status', async () => {
      vi.mocked(countDocuments).mockImplementation((collection) => {
        if (collection === 'voice_guidelines') return Promise.resolve(15);
        return Promise.resolve(50);
      });

      const result = await getDashboardConfigStatus();

      expect(result.voiceGuidelines.configured).toBe(true);
      expect(result.voiceGuidelines.count).toBe(15);
    });

    it('returns correct goldExamples status', async () => {
      vi.mocked(countDocuments).mockImplementation((collection) => {
        if (collection === 'approved_posts') return Promise.resolve(60);
        return Promise.resolve(15);
      });

      const result = await getDashboardConfigStatus();

      expect(result.goldExamples.configured).toBe(true);
      expect(result.goldExamples.count).toBe(60);
      expect(result.goldExamples.sufficient).toBe(true);
    });

    it('returns sufficient false when below 20 examples', async () => {
      vi.mocked(countDocuments).mockImplementation((collection) => {
        if (collection === 'approved_posts') return Promise.resolve(10);
        return Promise.resolve(15);
      });

      const result = await getDashboardConfigStatus();

      expect(result.goldExamples.sufficient).toBe(false);
    });

    it('returns correct accounts status', async () => {
      vi.mocked(countAccounts).mockReturnValue(25);

      const result = await getDashboardConfigStatus();

      expect(result.accounts.configured).toBe(true);
      expect(result.accounts.count).toBe(25);
    });

    it('identifies Anthropic as LLM provider', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      delete process.env.OPENAI_API_KEY;

      const result = await getDashboardConfigStatus();

      expect(result.llm.configured).toBe(true);
      expect(result.llm.provider).toBe('anthropic');
    });

    it('identifies OpenAI as LLM provider', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-test-openai';

      const result = await getDashboardConfigStatus();

      expect(result.llm.configured).toBe(true);
      expect(result.llm.provider).toBe('openai');
    });

    it('returns null provider when not configured', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const result = await getDashboardConfigStatus();

      expect(result.llm.configured).toBe(false);
      expect(result.llm.provider).toBeNull();
    });

    it('returns qdrant collections list', async () => {
      vi.mocked(collectionExists)
        .mockResolvedValueOnce(true) // voice_guidelines in checkVoiceGuidelines
        .mockResolvedValueOnce(true) // approved_posts in checkGoldExamples
        .mockResolvedValueOnce(true) // approved_posts in checkQdrant
        .mockResolvedValueOnce(true); // voice_guidelines in checkQdrant

      const result = await getDashboardConfigStatus();

      expect(result.qdrant.available).toBe(true);
      expect(result.qdrant.collections).toContain('approved_posts');
      expect(result.qdrant.collections).toContain('voice_guidelines');
    });

    it('returns correct formulas status', async () => {
      vi.mocked(countFormulas).mockReturnValue(3);
      vi.mocked(getActiveFormulas).mockReturnValue([{ id: 1 }, { id: 2 }] as never);

      const result = await getDashboardConfigStatus();

      expect(result.formulas.configured).toBe(true);
      expect(result.formulas.activeCount).toBe(2);
    });

    it('returns correct discord status', async () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

      const result = await getDashboardConfigStatus();

      expect(result.discord.configured).toBe(true);
    });

    it('returns isReady based on required items', async () => {
      const result = await getDashboardConfigStatus();

      expect(result.isReady).toBe(true);
    });

    it('passes options to validateAllConfig', async () => {
      const result = await getDashboardConfigStatus({ skipQdrant: true });

      expect(result.qdrant.available).toBe(false);
      expect(result.qdrant.collections).toHaveLength(0);
    });
  });
});
