/**
 * Bootstrap Flow Integration Test Suite
 *
 * Tests the complete bootstrap wizard flow end-to-end, ensuring each step
 * properly saves data and advances. Verifies data persists correctly in database.
 *
 * Steps tested:
 * 1. Voice Guidelines submission and parsing
 * 2. Gold Examples upload and storage
 * 3. Account curation and saving
 * 4. Complete flow from empty DB to fully configured
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { getAccountByHandle, countAccounts } from '@/db/models/accounts';

// Mock external dependencies that would require network calls
vi.mock('@/db/qdrant/connection', () => ({
  collectionExists: vi.fn().mockResolvedValue(true),
  QDRANT_COLLECTION_NAMES: {
    APPROVED_POSTS: 'approved_posts',
    VOICE_GUIDELINES: 'voice_guidelines',
  },
  getQdrantClient: vi.fn().mockReturnValue({
    scroll: vi.fn().mockResolvedValue({ points: [] }),
    count: vi.fn().mockResolvedValue({ count: 0 }),
  }),
}));

vi.mock('@/db/qdrant/embeddings', () => ({
  addDocumentsBatch: vi.fn().mockResolvedValue(undefined),
  countDocuments: vi.fn().mockResolvedValue(0),
  addDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/embeddings/service', () => ({
  generateEmbeddingsBatch: vi
    .fn()
    .mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => ({ embedding: new Array(1536).fill(0) })))
    ),
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: new Array(1536).fill(0) }),
}));

vi.mock('@/lib/voice/guidelines', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/voice/guidelines')>();
  return {
    ...original,
    syncVoiceGuidelinesToQdrant: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/voice/signature', () => ({
  generateSignature: vi.fn().mockReturnValue({
    sentenceLength: { mean: 15, stdDev: 5 },
    punctuation: {
      periodRate: 0.1,
      commaRate: 0.05,
      exclamationRate: 0.02,
      questionRate: 0.01,
      dashRate: 0.01,
      ellipsisRate: 0,
    },
    vocabulary: { typeTokenRatio: 0.8, hapaxRatio: 0.6 },
    functionWords: {
      the: 0.05,
      and: 0.03,
      but: 0.01,
      of: 0.02,
      to: 0.03,
      a: 0.04,
      in: 0.02,
      that: 0.02,
      is: 0.03,
      it: 0.02,
    },
    syntactic: { avgClauseDepth: 1.5, avgWordsPerClause: 8, subordinateClauseRatio: 0.2 },
    metadata: { textLength: 100, sampleCount: 1, generatedAt: new Date().toISOString() },
  }),
  saveBaselineSignatureToFile: vi.fn(),
  clearPersonaSignatureCache: vi.fn(),
  StyleSignature: {},
}));

vi.mock('@/lib/voice/embeddings', () => ({
  getVoiceCorpusStatus: vi.fn().mockResolvedValue({
    guidelinesLoaded: false,
    approvedPostsCount: 0,
    hasMinimumCorpus: false,
  }),
  getSimilarApprovedPosts: vi.fn().mockResolvedValue([]),
  findSimilarVoiceGuidelines: vi.fn().mockResolvedValue([]),
}));

// Helper to create mock NextRequest
function createMockRequest(
  url: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> }
): NextRequest {
  const fullUrl = url.startsWith('http') ? url : `http://localhost:3000${url}`;
  const headers: Record<string, string> = { ...(options?.headers ?? {}) };
  const requestOptions: { method: string; headers: Record<string, string>; body?: string } = {
    method: options?.method ?? 'GET',
    headers,
  };

  if (options?.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
    requestOptions.headers['Content-Type'] = 'application/json';
  }

  return new NextRequest(fullUrl, requestOptions);
}

// ============================================================================
// Test Data
// ============================================================================

const VALID_VOICE_GUIDELINES = `
# Voice Guidelines for AI Social Engine

## DO's
- Start with the problem or pain point the reader faces
- Use direct "you" language to speak to the reader personally
- Keep sentences short and punchy for social media
- Include specific examples and numbers when possible
- End with an actionable takeaway

## DON'Ts
- Don't use hashtags excessively
- Avoid starting posts with "Let's dive in" or "I'm excited to share"
- Don't be preachy or lecturing in tone
- Avoid corporate buzzwords like "synergy" or "leverage"
- Don't pad posts with filler content

## Examples
Most people think they need a perfect resume. Wrong. You need proof of work.

Here's what actually gets you hired in 2024:
1. Build something real
2. Document the process
3. Share the results

Stop optimizing your resume. Start building your portfolio.

## Rules
Always end with a clear call to action or thought-provoking question
Keep total length under 280 characters for single tweets
Use line breaks strategically for readability
`;

const GOLD_EXAMPLES = [
  "You're probably still using console.log() for debugging. Try the debugger statement instead—you can set breakpoints, inspect variables, and step through code.",
  'Most people skip this because they think it\'s complex. It\'s not. Start with a simple "debugger;" and open DevTools.',
  "Building in public isn't about showing off. It's about accountability. When others watch, you ship.",
  'The best code you can write is the code you delete. Every line is a liability.',
  "Don't optimize for the edge case. Ship the 80% solution and iterate.",
];

const CURATED_ACCOUNTS = [
  '@techinfluencer, 1',
  '@startupfounder, 1',
  'devadvocate, 1',
  'airesearcher, 2',
  'indiehacker',
  '# This is a comment',
  '@opensourcefan, 2',
];

// ============================================================================
// Step 1: Voice Guidelines Tests
// ============================================================================

describe('Bootstrap Step 1: Voice Guidelines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('POST /api/bootstrap/voice-guidelines', () => {
    it('parses and saves valid voice guidelines', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: VALID_VOICE_GUIDELINES },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.parsed).toHaveProperty('dosCount');
      expect(data.parsed).toHaveProperty('dontsCount');
      expect(data.parsed).toHaveProperty('examplesCount');
      expect(data.parsed).toHaveProperty('rulesCount');

      // Verify parsing extracted content from all sections
      expect(data.parsed.dosCount).toBeGreaterThan(0);
      expect(data.parsed.dontsCount).toBeGreaterThan(0);
      expect(data.parsed.examplesCount).toBeGreaterThan(0);
      expect(data.parsed.rulesCount).toBeGreaterThan(0);
    });

    it('extracts correct counts from guidelines', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: VALID_VOICE_GUIDELINES },
      });

      const response = await POST(request);
      const data = await response.json();

      // Check specific counts based on test data
      expect(data.parsed.dosCount).toBe(5);
      expect(data.parsed.dontsCount).toBe(5);
      // Examples section has multi-line content, count may vary
      expect(data.parsed.examplesCount).toBeGreaterThanOrEqual(1);
      expect(data.parsed.rulesCount).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 when content is empty', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: '' },
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('required');
    });

    it('returns 400 when content has no recognizable sections', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: 'Just some random text without markdown headers' },
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('No guidelines found');
    });

    it('handles minimal valid guidelines', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const minimalGuidelines = `
## DO's
- Write clearly
      `;

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: minimalGuidelines },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.parsed.dosCount).toBe(1);
    });

    it('handles guidelines with mixed header styles', async () => {
      const { POST } = await import('@/app/api/bootstrap/voice-guidelines/route');

      const mixedGuidelines = `
# DO's
- Item 1
- Item 2

### DON'Ts
- Don't do this
      `;

      const request = createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: mixedGuidelines },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.parsed.dosCount).toBe(2);
      expect(data.parsed.dontsCount).toBe(1);
    });
  });
});

// ============================================================================
// Step 2: Gold Examples Tests
// ============================================================================

describe('Bootstrap Step 2: Gold Examples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('POST /api/bootstrap/gold-examples', () => {
    it('adds valid gold examples to Qdrant', async () => {
      const { POST } = await import('@/app/api/bootstrap/gold-examples/route');
      const { addDocumentsBatch } = await import('@/db/qdrant/embeddings');

      const request = createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: GOLD_EXAMPLES },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.added).toBe(GOLD_EXAMPLES.length);
      expect(data.skipped).toBe(0);

      // Verify Qdrant was called with correct data
      expect(addDocumentsBatch).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(addDocumentsBatch).mock.calls[0];
      expect(callArgs[0]).toBe('approved_posts');
      expect(callArgs[1]).toHaveLength(GOLD_EXAMPLES.length);
    });

    it('generates baseline signature from examples', async () => {
      const { POST } = await import('@/app/api/bootstrap/gold-examples/route');
      const { saveBaselineSignatureToFile } = await import('@/lib/voice/signature');

      const request = createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: GOLD_EXAMPLES },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.baselineSignatureGenerated).toBe(true);
      expect(saveBaselineSignatureToFile).toHaveBeenCalledTimes(1);
    });

    it('filters out empty examples', async () => {
      const { POST } = await import('@/app/api/bootstrap/gold-examples/route');

      const examplesWithEmpty = ['Valid example 1', '', '   ', 'Valid example 2', '\n\n'];

      const request = createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: examplesWithEmpty },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.added).toBe(2); // Only 2 valid examples
    });

    it('returns 400 when examples array is missing', async () => {
      const { POST } = await import('@/app/api/bootstrap/gold-examples/route');

      const request = createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: {},
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('Examples array is required');
    });

    it('returns 400 when no valid examples provided', async () => {
      const { POST } = await import('@/app/api/bootstrap/gold-examples/route');

      const request = createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: ['', '   ', '\n'] },
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('No valid examples');
    });

    it('handles single example', async () => {
      const { POST } = await import('@/app/api/bootstrap/gold-examples/route');

      const request = createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: ['Single valid example for testing'] },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.added).toBe(1);
    });

    it('trims whitespace from examples', async () => {
      const { POST } = await import('@/app/api/bootstrap/gold-examples/route');
      const { addDocumentsBatch } = await import('@/db/qdrant/embeddings');

      const request = createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: ['  Example with spaces  ', '\n\tTabbed example\n'] },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // Verify trimmed text was passed
      const callArgs = vi.mocked(addDocumentsBatch).mock.calls[0];
      expect(callArgs[1][0].text).toBe('Example with spaces');
      expect(callArgs[1][1].text).toBe('Tabbed example');
    });
  });
});

// ============================================================================
// Step 3: Curated Accounts Tests
// ============================================================================

describe('Bootstrap Step 3: Curated Accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('POST /api/bootstrap/accounts', () => {
    it('adds curated accounts to database', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      const request = createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { accounts: CURATED_ACCOUNTS },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.added).toBe(6); // 7 lines - 1 comment = 6 accounts
      expect(data.skipped).toBe(0);
    });

    it('persists accounts with correct tiers', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: CURATED_ACCOUNTS },
        })
      );

      // Verify tier 1 accounts
      const tech = getAccountByHandle('techinfluencer');
      expect(tech).not.toBeNull();
      expect(tech?.tier).toBe(1);

      const founder = getAccountByHandle('startupfounder');
      expect(founder).not.toBeNull();
      expect(founder?.tier).toBe(1);

      // Verify tier 2 accounts (explicit and default)
      const researcher = getAccountByHandle('airesearcher');
      expect(researcher).not.toBeNull();
      expect(researcher?.tier).toBe(2);

      // indiehacker has no tier specified, defaults to 2
      const indie = getAccountByHandle('indiehacker');
      expect(indie).not.toBeNull();
      expect(indie?.tier).toBe(2);
    });

    it('handles @ prefix in handles', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['@testuser, 1'] },
        })
      );

      // Should be stored without @ prefix
      const user = getAccountByHandle('testuser');
      expect(user).not.toBeNull();
    });

    it('skips duplicate accounts', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      // First import
      await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['testuser, 1', 'anotheruser, 2'] },
        })
      );

      // Second import with overlap
      const response = await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['testuser, 1', 'newuser, 1'] },
        })
      );

      const data = await response.json();
      expect(data.added).toBe(1); // Only newuser added
      expect(data.skipped).toBe(1); // testuser skipped

      // Verify total count
      expect(countAccounts()).toBe(3);
    });

    it('ignores comment lines', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      const response = await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: {
            accounts: [
              '# This is a header comment',
              'validuser, 1',
              '# Another comment',
              '## Double hash comment',
            ],
          },
        })
      );

      const data = await response.json();
      expect(data.added).toBe(1); // Only validuser
    });

    it('ignores empty lines', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      const response = await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: {
            accounts: ['user1, 1', '', '   ', 'user2, 2'],
          },
        })
      );

      const data = await response.json();
      expect(data.added).toBe(2);
    });

    it('returns 400 when accounts array is missing', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      const request = createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: {},
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('Accounts array is required');
    });

    it('handles accounts with extra whitespace', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['  spaceduser  ,  1  '] },
        })
      );

      const user = getAccountByHandle('spaceduser');
      expect(user).not.toBeNull();
      expect(user?.tier).toBe(1);
    });

    it('defaults to tier 2 when tier not specified', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['notieruser'] },
        })
      );

      const user = getAccountByHandle('notieruser');
      expect(user).not.toBeNull();
      expect(user?.tier).toBe(2);
    });

    it('handles invalid tier values gracefully', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');

      await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['badtier, 5', 'anotherbad, abc'] },
        })
      );

      // Should default to tier 2 for invalid values
      const user1 = getAccountByHandle('badtier');
      const user2 = getAccountByHandle('anotherbad');

      expect(user1?.tier).toBe(2);
      expect(user2?.tier).toBe(2);
    });
  });
});

// ============================================================================
// Bootstrap Status Tests
// ============================================================================

describe('Bootstrap Status Check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  describe('GET /api/bootstrap/status', () => {
    it('returns status with all fields', async () => {
      const { GET } = await import('@/app/api/bootstrap/status/route');

      const response = await GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('voiceGuidelinesLoaded');
      expect(data).toHaveProperty('approvedPostsCount');
      expect(data).toHaveProperty('hasMinimumCorpus');
      expect(data).toHaveProperty('accountsCount');
      expect(data).toHaveProperty('formulasCount');
      expect(data).toHaveProperty('hasActiveFormula');
      expect(data).toHaveProperty('apiKeysConfigured');
      expect(data).toHaveProperty('discordWebhookConfigured');
      expect(data).toHaveProperty('isReady');
      expect(data).toHaveProperty('missingRequirements');
    });

    it('reports empty state correctly', async () => {
      const { GET } = await import('@/app/api/bootstrap/status/route');

      const response = await GET();
      const data = await response.json();

      // With mocked voice corpus status returning false/0
      expect(data.voiceGuidelinesLoaded).toBe(false);
      expect(data.approvedPostsCount).toBe(0);
      expect(data.hasMinimumCorpus).toBe(false);

      // Fresh database should have 0 accounts
      expect(data.accountsCount).toBe(0);

      // System not ready with empty state
      expect(data.isReady).toBe(false);
      expect(data.missingRequirements.length).toBeGreaterThan(0);
    });

    it('updates accounts count after adding accounts', async () => {
      const { POST } = await import('@/app/api/bootstrap/accounts/route');
      const { GET } = await import('@/app/api/bootstrap/status/route');

      // Add some accounts
      await POST(
        createMockRequest('/api/bootstrap/accounts', {
          method: 'POST',
          body: { accounts: ['user1', 'user2', 'user3'] },
        })
      );

      const response = await GET();
      const data = await response.json();

      expect(data.accountsCount).toBe(3);
    });

    it('identifies missing requirements', async () => {
      const { GET } = await import('@/app/api/bootstrap/status/route');

      const response = await GET();
      const data = await response.json();

      // Should identify key missing requirements
      const requirements = data.missingRequirements as string[];
      expect(requirements.some((r: string) => r.toLowerCase().includes('voice'))).toBe(true);
      expect(requirements.some((r: string) => r.toLowerCase().includes('formula'))).toBe(true);
    });
  });
});

// ============================================================================
// Complete Bootstrap Flow Tests
// ============================================================================

describe('Complete Bootstrap Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    resetDb();
  });

  it('completes full bootstrap sequence from empty database', async () => {
    const { POST: postGuidelines } = await import('@/app/api/bootstrap/voice-guidelines/route');
    const { POST: postExamples } = await import('@/app/api/bootstrap/gold-examples/route');
    const { POST: postAccounts } = await import('@/app/api/bootstrap/accounts/route');

    // Step 1: Voice Guidelines
    const guidelinesResponse = await postGuidelines(
      createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: VALID_VOICE_GUIDELINES },
      })
    );
    expect(guidelinesResponse.status).toBe(200);
    const guidelinesData = await guidelinesResponse.json();
    expect(guidelinesData.success).toBe(true);

    // Step 2: Gold Examples
    const examplesResponse = await postExamples(
      createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: GOLD_EXAMPLES },
      })
    );
    expect(examplesResponse.status).toBe(200);
    const examplesData = await examplesResponse.json();
    expect(examplesData.success).toBe(true);
    expect(examplesData.added).toBe(GOLD_EXAMPLES.length);

    // Step 3: Accounts
    const accountsResponse = await postAccounts(
      createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { accounts: CURATED_ACCOUNTS },
      })
    );
    expect(accountsResponse.status).toBe(200);
    const accountsData = await accountsResponse.json();
    expect(accountsData.success).toBe(true);

    // Verify final state
    expect(countAccounts()).toBe(6); // All non-comment accounts added
  });

  it('allows incremental progress through bootstrap steps', async () => {
    const { POST: postAccounts } = await import('@/app/api/bootstrap/accounts/route');

    // Add accounts in batches
    await postAccounts(
      createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { accounts: ['batch1user1', 'batch1user2'] },
      })
    );

    expect(countAccounts()).toBe(2);

    await postAccounts(
      createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { accounts: ['batch2user1', 'batch2user2', 'batch2user3'] },
      })
    );

    expect(countAccounts()).toBe(5);
  });

  it('handles repeated submissions gracefully', async () => {
    const { POST: postGuidelines } = await import('@/app/api/bootstrap/voice-guidelines/route');

    // Submit guidelines twice
    const firstResponse = await postGuidelines(
      createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: VALID_VOICE_GUIDELINES },
      })
    );
    expect(firstResponse.status).toBe(200);

    // Second submission should also succeed (update/replace)
    const secondResponse = await postGuidelines(
      createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: VALID_VOICE_GUIDELINES },
      })
    );
    expect(secondResponse.status).toBe(200);
  });

  it('maintains data integrity across multiple operations', async () => {
    const { POST: postAccounts } = await import('@/app/api/bootstrap/accounts/route');

    // First batch
    await postAccounts(
      createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { accounts: ['alpha, 1', 'beta, 2'] },
      })
    );

    // Second batch with overlap
    await postAccounts(
      createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { accounts: ['alpha, 1', 'gamma, 1'] }, // alpha is duplicate
      })
    );

    // Verify original data unchanged
    const alpha = getAccountByHandle('alpha');
    expect(alpha?.tier).toBe(1);

    // Verify new data added
    const gamma = getAccountByHandle('gamma');
    expect(gamma?.tier).toBe(1);

    // Verify total
    expect(countAccounts()).toBe(3);
  });

  it('validates each step independently', async () => {
    const { POST: postGuidelines } = await import('@/app/api/bootstrap/voice-guidelines/route');
    const { POST: postExamples } = await import('@/app/api/bootstrap/gold-examples/route');
    const { POST: postAccounts } = await import('@/app/api/bootstrap/accounts/route');

    // Invalid guidelines should fail
    const badGuidelines = await postGuidelines(
      createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: 'no valid sections here' },
      })
    );
    expect(badGuidelines.status).toBe(400);

    // Invalid examples should fail
    const badExamples = await postExamples(
      createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: [] },
      })
    );
    expect(badExamples.status).toBe(400);

    // Invalid accounts should fail
    const badAccounts = await postAccounts(
      createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { notAccounts: [] },
      })
    );
    expect(badAccounts.status).toBe(400);
  });

  it('verifies all configured via config status API after full bootstrap', async () => {
    const { POST: postGuidelines } = await import('@/app/api/bootstrap/voice-guidelines/route');
    const { POST: postExamples } = await import('@/app/api/bootstrap/gold-examples/route');
    const { POST: postAccounts } = await import('@/app/api/bootstrap/accounts/route');
    const { GET: getConfigStatus } = await import('@/app/api/config/status/route');

    // Step 1: Voice Guidelines
    const guidelinesResponse = await postGuidelines(
      createMockRequest('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        body: { content: VALID_VOICE_GUIDELINES },
      })
    );
    expect(guidelinesResponse.status).toBe(200);

    // Step 2: Gold Examples
    const examplesResponse = await postExamples(
      createMockRequest('/api/bootstrap/gold-examples', {
        method: 'POST',
        body: { examples: GOLD_EXAMPLES },
      })
    );
    expect(examplesResponse.status).toBe(200);

    // Step 3: Curated Accounts
    const accountsResponse = await postAccounts(
      createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { accounts: CURATED_ACCOUNTS },
      })
    );
    expect(accountsResponse.status).toBe(200);

    // Verify final configuration state via config status API
    const statusResponse = await getConfigStatus();
    expect(statusResponse.status).toBe(200);

    const status = await statusResponse.json();

    // Verify accounts are configured
    expect(status.accounts.configured).toBe(true);
    expect(status.accounts.count).toBe(6);

    // Verify gold examples were added (count from mocked Qdrant)
    expect(status.goldExamples).toBeDefined();

    // Verify voice guidelines status
    expect(status.voiceGuidelines).toBeDefined();

    // Verify overall structure includes all expected fields
    expect(status).toHaveProperty('llm');
    expect(status).toHaveProperty('qdrant');
    expect(status).toHaveProperty('formulas');
    expect(status).toHaveProperty('discord');
    expect(status).toHaveProperty('isReady');
  });

  it('verifies config status reflects each bootstrap step completion', async () => {
    const { POST: postAccounts } = await import('@/app/api/bootstrap/accounts/route');
    const { GET: getConfigStatus } = await import('@/app/api/config/status/route');

    // Initial state - no accounts
    const initialStatus = await getConfigStatus();
    const initialData = await initialStatus.json();
    expect(initialData.accounts.configured).toBe(false);
    expect(initialData.accounts.count).toBe(0);

    // Add accounts
    await postAccounts(
      createMockRequest('/api/bootstrap/accounts', {
        method: 'POST',
        body: { accounts: ['user1, 1', 'user2, 2', 'user3, 1'] },
      })
    );

    // Verify accounts now configured
    const afterAccountsStatus = await getConfigStatus();
    const afterAccountsData = await afterAccountsStatus.json();
    expect(afterAccountsData.accounts.configured).toBe(true);
    expect(afterAccountsData.accounts.count).toBe(3);
  });
});
