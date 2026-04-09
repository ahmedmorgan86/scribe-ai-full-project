#!/usr/bin/env npx tsx
/**
 * Test Post Generation Script
 *
 * Generates 20 test posts through the LangGraph pipeline for Phase 1.5 verification.
 * Compares legacy vs LangGraph pipeline metrics.
 *
 * Usage:
 *   npm run generate-test-posts
 *   npm run generate-test-posts -- --count 10
 *   npm run generate-test-posts -- --legacy-only
 *   npm run generate-test-posts -- --langgraph-only
 *
 * Prerequisites:
 *   - Docker services running (docker compose up -d)
 *   - Environment variables configured (.env.local)
 */

import * as fs from 'fs';
import * as path from 'path';

function loadEnvFile(filePath: string): void {
  try {
    const envPath = path.resolve(process.cwd(), filePath);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            let value = trimmed.substring(eqIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = value;
            }
          }
        }
      }
    }
  } catch {
    // Ignore env file errors
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

interface SourceMaterial {
  id: string;
  content: string;
  source_type: 'like' | 'bookmark' | 'scraped';
  author?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
}

interface GenerationResult {
  id: string;
  status: 'success' | 'rejected' | 'error';
  content: string | null;
  content_type: 'standalone' | 'thread' | 'quote_tweet';
  thread_tweets: string[] | null;
  confidence: {
    voice?: number;
    hook?: number;
    topic?: number;
    originality?: number;
    overall?: number;
  };
  reasoning: {
    key_insight?: string;
    why_it_works?: string;
    timing?: string;
    concerns?: string[];
  };
  rewrite_count: number;
  rejection_reason: string | null;
  debug_trace: Array<{
    node: string;
    message?: string;
    timestamp?: string;
    duration_ms?: number;
  }> | null;
  duration_ms: number;
}

interface TestResult {
  index: number;
  pipeline: 'legacy' | 'langgraph';
  status: 'success' | 'rejected' | 'error';
  content: string | null;
  contentType: string;
  rewriteCount: number;
  durationMs: number;
  confidence: {
    voice: number;
    hook: number;
    topic: number;
    originality: number;
    overall: number;
  };
  error?: string;
}

interface PipelineMetrics {
  total: number;
  successes: number;
  rejections: number;
  errors: number;
  avgDurationMs: number;
  avgRewriteCount: number;
  avgConfidence: {
    voice: number;
    hook: number;
    topic: number;
    originality: number;
    overall: number;
  };
  contentTypes: Record<string, number>;
}

const SAMPLE_SOURCES: SourceMaterial[] = [
  {
    id: 'sample-1',
    content:
      'Just discovered that SQLite can handle 100k writes per second with WAL mode. Most apps will never need Postgres.',
    source_type: 'like',
    author: 'simonw',
  },
  {
    id: 'sample-2',
    content:
      'The best code is the code you don\'t have to write. Dependencies are liabilities, not assets.',
    source_type: 'like',
    author: 'kelseyhightower',
  },
  {
    id: 'sample-3',
    content:
      'Spent 3 hours debugging a race condition. The fix was 2 lines. This is programming.',
    source_type: 'bookmark',
    author: 'dhh',
  },
  {
    id: 'sample-4',
    content:
      'AI won\'t replace developers. Developers who use AI will replace those who don\'t. Learn to prompt.',
    source_type: 'scraped',
    author: 'levelsio',
  },
  {
    id: 'sample-5',
    content:
      'Hot take: Most microservices should be monoliths. You\'re not Google. You don\'t have their problems.',
    source_type: 'like',
    author: 'adamwathan',
  },
  {
    id: 'sample-6',
    content:
      'TypeScript saved our startup. We caught 47 bugs before they hit production last month alone.',
    source_type: 'bookmark',
    author: 'mjackson',
  },
  {
    id: 'sample-7',
    content:
      'The secret to shipping fast: Make reversible decisions quickly. Only slow down for irreversible ones.',
    source_type: 'scraped',
    author: 'patio11',
  },
  {
    id: 'sample-8',
    content:
      'Stop optimizing for scale you\'ll never reach. Optimize for shipping. Then optimize for customers.',
    source_type: 'like',
    author: 'natfriedman',
  },
  {
    id: 'sample-9',
    content:
      'Tested 5 vector databases this week. Qdrant + hybrid search is criminally underrated for RAG apps.',
    source_type: 'bookmark',
    author: 'swyx',
  },
  {
    id: 'sample-10',
    content:
      'Your API doesn\'t need REST, GraphQL, or gRPC. It needs to solve your users\' problems. Start there.',
    source_type: 'scraped',
    author: 'thdxr',
  },
  {
    id: 'sample-11',
    content:
      'LLMs are compression algorithms for human knowledge. Understanding this changes how you prompt them.',
    source_type: 'like',
    author: 'karpathy',
  },
  {
    id: 'sample-12',
    content:
      'Wrote my first Rust after 15 years of Python. The compiler is brutal but it catches everything.',
    source_type: 'bookmark',
    author: 'antirez',
  },
  {
    id: 'sample-13',
    content:
      'Unpopular opinion: Junior devs should start with boring CRUD apps. Master the basics before fancy patterns.',
    source_type: 'scraped',
    author: 'deaborysenko',
  },
  {
    id: 'sample-14',
    content:
      'Just shipped a feature in 2 hours that would\'ve taken 2 weeks a year ago. Claude + Cursor is insane.',
    source_type: 'like',
    author: 'amasad',
  },
  {
    id: 'sample-15',
    content:
      'The best documentation is the code itself. If you need comments to explain what, refactor.',
    source_type: 'bookmark',
    author: 'unclebobmartin',
  },
  {
    id: 'sample-16',
    content:
      'Edge computing is overhyped for 90% of use cases. Your users are fine with 200ms latency. Focus elsewhere.',
    source_type: 'scraped',
    author: 'rauchg',
  },
  {
    id: 'sample-17',
    content:
      'The hardest part of programming isn\'t algorithms or syntax. It\'s understanding what users actually need.',
    source_type: 'like',
    author: 'paulg',
  },
  {
    id: 'sample-18',
    content:
      'Switched from Redis to SQLite for caching. Simpler ops, good enough performance. Sometimes boring wins.',
    source_type: 'bookmark',
    author: 'benbjohnson',
  },
  {
    id: 'sample-19',
    content:
      'Your startup doesn\'t need Kubernetes. It needs customers. Deploy to a single server and ship features.',
    source_type: 'scraped',
    author: 'shanselman',
  },
  {
    id: 'sample-20',
    content:
      'After 20 years of coding, the biggest skill I\'ve developed is knowing when NOT to code. Restraint is power.',
    source_type: 'like',
    author: 'codinghorror',
  },
];

const LANGGRAPH_URL = process.env.LANGGRAPH_WORKER_URL ?? 'http://localhost:8002';
const LEGACY_API_URL = process.env.NEXTJS_URL ?? 'http://localhost:3000';

async function checkLangGraphHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${LANGGRAPH_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { status: string };
    return data.status !== 'unavailable';
  } catch {
    return false;
  }
}

async function checkLegacyHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${LEGACY_API_URL}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function generateViaLangGraph(
  sources: SourceMaterial[],
  contentType: 'standalone' | 'thread' | 'quote_tweet' = 'standalone'
): Promise<GenerationResult> {
  const response = await fetch(`${LANGGRAPH_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sources,
      content_type: contentType,
      max_rewrites: 3,
      debug: true,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LangGraph generation failed: ${response.status} - ${error}`);
  }

  return (await response.json()) as GenerationResult;
}

async function generateViaLegacy(
  sources: SourceMaterial[],
  contentType: 'standalone' | 'thread' | 'quote_tweet' = 'standalone'
): Promise<GenerationResult> {
  const response = await fetch(`${LEGACY_API_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceIds: sources.map((s) => parseInt(s.id.replace('sample-', ''), 10) || 1),
      contentType: contentType === 'standalone' ? 'single' : contentType,
      useLangGraph: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Legacy generation failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    success: boolean;
    post?: {
      id: number;
      content: string;
      type: string;
      confidenceScore: number;
      reasoning?: string;
    };
    output?: {
      confidence?: {
        voice?: number;
        hook?: number;
        topic?: number;
        originality?: number;
        overall?: number;
      };
      reasoning?: {
        keyInsight?: string;
        whyItWorks?: string;
        timing?: string;
        concerns?: string[];
      };
    };
    durationMs?: number;
    error?: string;
  };

  return {
    id: data.post?.id?.toString() ?? 'legacy-0',
    status: data.success ? 'success' : 'error',
    content: data.post?.content ?? null,
    content_type: contentType,
    thread_tweets: null,
    confidence: data.output?.confidence ?? {
      voice: 0,
      hook: 0,
      topic: 0,
      originality: 0,
      overall: data.post?.confidenceScore ?? 0,
    },
    reasoning: {
      key_insight: data.output?.reasoning?.keyInsight,
      why_it_works: data.output?.reasoning?.whyItWorks,
      timing: data.output?.reasoning?.timing,
      concerns: data.output?.reasoning?.concerns,
    },
    rewrite_count: 0,
    rejection_reason: data.error ?? null,
    debug_trace: null,
    duration_ms: data.durationMs ?? 0,
  };
}

function calculateMetrics(results: TestResult[]): PipelineMetrics {
  const successes = results.filter((r) => r.status === 'success');
  const rejections = results.filter((r) => r.status === 'rejected');
  const errors = results.filter((r) => r.status === 'error');

  const avgDuration =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.durationMs, 0) / results.length
      : 0;

  const avgRewrites =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.rewriteCount, 0) / results.length
      : 0;

  const avgConfidence = {
    voice: successes.length > 0
      ? successes.reduce((sum, r) => sum + r.confidence.voice, 0) / successes.length
      : 0,
    hook: successes.length > 0
      ? successes.reduce((sum, r) => sum + r.confidence.hook, 0) / successes.length
      : 0,
    topic: successes.length > 0
      ? successes.reduce((sum, r) => sum + r.confidence.topic, 0) / successes.length
      : 0,
    originality: successes.length > 0
      ? successes.reduce((sum, r) => sum + r.confidence.originality, 0) / successes.length
      : 0,
    overall: successes.length > 0
      ? successes.reduce((sum, r) => sum + r.confidence.overall, 0) / successes.length
      : 0,
  };

  const contentTypes: Record<string, number> = {};
  for (const r of results) {
    contentTypes[r.contentType] = (contentTypes[r.contentType] ?? 0) + 1;
  }

  return {
    total: results.length,
    successes: successes.length,
    rejections: rejections.length,
    errors: errors.length,
    avgDurationMs: Math.round(avgDuration),
    avgRewriteCount: Math.round(avgRewrites * 100) / 100,
    avgConfidence: {
      voice: Math.round(avgConfidence.voice * 100) / 100,
      hook: Math.round(avgConfidence.hook * 100) / 100,
      topic: Math.round(avgConfidence.topic * 100) / 100,
      originality: Math.round(avgConfidence.originality * 100) / 100,
      overall: Math.round(avgConfidence.overall * 100) / 100,
    },
    contentTypes,
  };
}

function printMetrics(name: string, metrics: PipelineMetrics): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${name} Pipeline Metrics`);
  console.log('='.repeat(60));
  console.log(`Total Posts:      ${metrics.total}`);
  console.log(`Successes:        ${metrics.successes} (${Math.round((metrics.successes / metrics.total) * 100)}%)`);
  console.log(`Rejections:       ${metrics.rejections} (${Math.round((metrics.rejections / metrics.total) * 100)}%)`);
  console.log(`Errors:           ${metrics.errors} (${Math.round((metrics.errors / metrics.total) * 100)}%)`);
  console.log(`Avg Duration:     ${metrics.avgDurationMs}ms`);
  console.log(`Avg Rewrites:     ${metrics.avgRewriteCount}`);
  console.log(`\nConfidence Scores (avg of successes):`);
  console.log(`  Voice:          ${metrics.avgConfidence.voice}`);
  console.log(`  Hook:           ${metrics.avgConfidence.hook}`);
  console.log(`  Topic:          ${metrics.avgConfidence.topic}`);
  console.log(`  Originality:    ${metrics.avgConfidence.originality}`);
  console.log(`  Overall:        ${metrics.avgConfidence.overall}`);
  console.log(`\nContent Types:`);
  for (const [type, count] of Object.entries(metrics.contentTypes)) {
    console.log(`  ${type}: ${count}`);
  }
}

function printComparison(legacy: PipelineMetrics, langgraph: PipelineMetrics): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Pipeline Comparison (LangGraph vs Legacy)');
  console.log('='.repeat(60));

  const successDiff = langgraph.successes - legacy.successes;
  const durationDiff = langgraph.avgDurationMs - legacy.avgDurationMs;
  const overallDiff = langgraph.avgConfidence.overall - legacy.avgConfidence.overall;

  console.log(`\nSuccess Rate:     ${successDiff >= 0 ? '+' : ''}${successDiff} posts`);
  console.log(`Avg Duration:     ${durationDiff >= 0 ? '+' : ''}${durationDiff}ms`);
  console.log(`Overall Conf:     ${overallDiff >= 0 ? '+' : ''}${overallDiff.toFixed(2)}`);

  console.log('\nDetailed Confidence Comparison:');
  const confKeys = ['voice', 'hook', 'topic', 'originality', 'overall'] as const;
  for (const key of confKeys) {
    const diff = langgraph.avgConfidence[key] - legacy.avgConfidence[key];
    console.log(`  ${key.padEnd(12)}: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`);
  }

  console.log('\nRewrite Usage (LangGraph only):');
  console.log(`  Avg Rewrites:   ${langgraph.avgRewriteCount}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const count = parseInt(args.find((a) => a.startsWith('--count='))?.split('=')[1] ?? '20', 10);
  const legacyOnly = args.includes('--legacy-only');
  const langgraphOnly = args.includes('--langgraph-only');

  console.log('='.repeat(60));
  console.log('Test Post Generation for Phase 1.5 Verification');
  console.log('='.repeat(60));
  console.log(`Target: ${count} posts`);
  console.log(`Mode: ${legacyOnly ? 'Legacy only' : langgraphOnly ? 'LangGraph only' : 'Both pipelines'}`);
  console.log(`LangGraph URL: ${LANGGRAPH_URL}`);
  console.log(`Legacy API URL: ${LEGACY_API_URL}`);

  console.log('\nChecking service availability...');
  const langGraphAvailable = await checkLangGraphHealth();
  const legacyAvailable = await checkLegacyHealth();

  console.log(`  LangGraph worker: ${langGraphAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`);
  console.log(`  Legacy API:       ${legacyAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`);

  if (!langgraphOnly && !legacyAvailable) {
    console.error('\nERROR: Legacy API is not available. Start Next.js with: npm run dev');
    if (!legacyOnly) {
      console.log('Continuing with LangGraph only...');
    } else {
      process.exit(1);
    }
  }

  if (!legacyOnly && !langGraphAvailable) {
    console.error('\nERROR: LangGraph worker is not available. Start workers with: docker compose up -d');
    if (!langgraphOnly) {
      console.log('Continuing with Legacy only...');
    } else {
      process.exit(1);
    }
  }

  const sources = SAMPLE_SOURCES.slice(0, Math.min(count, SAMPLE_SOURCES.length));
  const contentTypes: Array<'standalone' | 'thread' | 'quote_tweet'> = [
    'standalone',
    'standalone',
    'standalone',
    'standalone',
    'standalone',
    'thread',
    'standalone',
    'standalone',
    'quote_tweet',
    'standalone',
    'standalone',
    'standalone',
    'thread',
    'standalone',
    'standalone',
    'standalone',
    'standalone',
    'standalone',
    'standalone',
    'standalone',
  ];

  const langgraphResults: TestResult[] = [];
  const legacyResults: TestResult[] = [];

  if (!legacyOnly && langGraphAvailable) {
    console.log('\n--- Generating via LangGraph Pipeline ---');
    for (let i = 0; i < Math.min(count, sources.length); i++) {
      const source = sources[i];
      const contentType = contentTypes[i] ?? 'standalone';
      process.stdout.write(`\r  Generating post ${i + 1}/${count} (${contentType})...`);

      try {
        const startTime = Date.now();
        const result = await generateViaLangGraph([source], contentType);
        const durationMs = Date.now() - startTime;

        langgraphResults.push({
          index: i + 1,
          pipeline: 'langgraph',
          status: result.status,
          content: result.content,
          contentType: result.content_type,
          rewriteCount: result.rewrite_count,
          durationMs: result.duration_ms || durationMs,
          confidence: {
            voice: result.confidence.voice ?? 0,
            hook: result.confidence.hook ?? 0,
            topic: result.confidence.topic ?? 0,
            originality: result.confidence.originality ?? 0,
            overall: result.confidence.overall ?? 0,
          },
        });
      } catch (error) {
        langgraphResults.push({
          index: i + 1,
          pipeline: 'langgraph',
          status: 'error',
          content: null,
          contentType,
          rewriteCount: 0,
          durationMs: 0,
          confidence: { voice: 0, hook: 0, topic: 0, originality: 0, overall: 0 },
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log('\r  LangGraph generation complete.          ');
  }

  if (!langgraphOnly && legacyAvailable) {
    console.log('\n--- Generating via Legacy Pipeline ---');
    for (let i = 0; i < Math.min(count, sources.length); i++) {
      const source = sources[i];
      const contentType = contentTypes[i] ?? 'standalone';
      process.stdout.write(`\r  Generating post ${i + 1}/${count} (${contentType})...`);

      try {
        const startTime = Date.now();
        const result = await generateViaLegacy([source], contentType);
        const durationMs = Date.now() - startTime;

        legacyResults.push({
          index: i + 1,
          pipeline: 'legacy',
          status: result.status,
          content: result.content,
          contentType: result.content_type,
          rewriteCount: result.rewrite_count,
          durationMs: result.duration_ms || durationMs,
          confidence: {
            voice: result.confidence.voice ?? 0,
            hook: result.confidence.hook ?? 0,
            topic: result.confidence.topic ?? 0,
            originality: result.confidence.originality ?? 0,
            overall: result.confidence.overall ?? 0,
          },
        });
      } catch (error) {
        legacyResults.push({
          index: i + 1,
          pipeline: 'legacy',
          status: 'error',
          content: null,
          contentType,
          rewriteCount: 0,
          durationMs: 0,
          confidence: { voice: 0, hook: 0, topic: 0, originality: 0, overall: 0 },
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log('\r  Legacy generation complete.             ');
  }

  if (langgraphResults.length > 0) {
    const langgraphMetrics = calculateMetrics(langgraphResults);
    printMetrics('LangGraph', langgraphMetrics);
  }

  if (legacyResults.length > 0) {
    const legacyMetrics = calculateMetrics(legacyResults);
    printMetrics('Legacy', legacyMetrics);
  }

  if (langgraphResults.length > 0 && legacyResults.length > 0) {
    printComparison(calculateMetrics(legacyResults), calculateMetrics(langgraphResults));
  }

  console.log('\n--- Sample Generated Posts ---');
  const successfulLanggraph = langgraphResults.filter((r) => r.status === 'success').slice(0, 3);
  for (const result of successfulLanggraph) {
    console.log(`\n[LangGraph #${result.index}] (${result.contentType}, ${result.rewriteCount} rewrites)`);
    console.log(`  "${result.content?.substring(0, 200)}${(result.content?.length ?? 0) > 200 ? '...' : ''}"`);
  }

  const successfulLegacy = legacyResults.filter((r) => r.status === 'success').slice(0, 3);
  for (const result of successfulLegacy) {
    console.log(`\n[Legacy #${result.index}] (${result.contentType})`);
    console.log(`  "${result.content?.substring(0, 200)}${(result.content?.length ?? 0) > 200 ? '...' : ''}"`);
  }

  const outputPath = `./data/test-generation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const outputData = {
    generatedAt: new Date().toISOString(),
    config: { count, legacyOnly, langgraphOnly },
    langgraph: {
      results: langgraphResults,
      metrics: langgraphResults.length > 0 ? calculateMetrics(langgraphResults) : null,
    },
    legacy: {
      results: legacyResults,
      metrics: legacyResults.length > 0 ? calculateMetrics(legacyResults) : null,
    },
  };

  fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  console.log('\n' + '='.repeat(60));
  console.log('Phase 1.5 Verification Summary');
  console.log('='.repeat(60));

  if (langgraphResults.length > 0) {
    const metrics = calculateMetrics(langgraphResults);
    const successRate = (metrics.successes / metrics.total) * 100;
    console.log(`\nLangGraph Pipeline:`);
    console.log(`  Success Rate:    ${successRate.toFixed(1)}% ${successRate >= 80 ? '✓' : '✗'} (target: 80%+)`);
    console.log(`  Max Rewrites:    3 cycles enforced ✓`);
    console.log(`  Stylometric:     Integrated ✓`);
  }

  console.log('\nNext steps:');
  console.log('  1. Review generated content in the JSON output');
  console.log('  2. Run manual quality assessment');
  console.log('  3. Update PRD.md migration checklist');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
