#!/usr/bin/env npx tsx
/**
 * System Health Check Script
 *
 * Validates all system components are properly configured and working together.
 * Exit code 0 if healthy, 1 if issues found.
 *
 * Usage: npm run health-check
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { QdrantClient } from '@qdrant/js-client-rest';

// ============================================================================
// Types
// ============================================================================

interface ComponentStatus {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}

interface HealthReport {
  timestamp: string;
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentStatus[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
  };
}

// ============================================================================
// Configuration
// ============================================================================

// Environment variable configurations with optional format validation
interface EnvVarConfig {
  name: string;
  format?: RegExp;
  formatDescription?: string;
}

const REQUIRED_ENV_VARS: EnvVarConfig[] = [
  {
    name: 'ANTHROPIC_API_KEY',
    format: /^sk-ant-[a-zA-Z0-9_-]+$/,
    formatDescription: 'sk-ant-*',
  },
];

const OPTIONAL_ENV_VARS: EnvVarConfig[] = [
  {
    name: 'OPENAI_API_KEY',
    format: /^sk-[a-zA-Z0-9_-]+$/,
    formatDescription: 'sk-*',
  },
  {
    name: 'APIFY_API_TOKEN',
    format: /^apify_api_[a-zA-Z0-9_-]+$/,
    formatDescription: 'apify_api_*',
  },
  {
    name: 'DISCORD_WEBHOOK_URL',
    format: /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[a-zA-Z0-9_-]+$/,
    formatDescription: 'https://discord.com/api/webhooks/{id}/{token}',
  },
  { name: 'QDRANT_URL' },
  { name: 'LITELLM_GATEWAY_URL' },
  { name: 'LANGGRAPH_WORKER_URL' },
  { name: 'STYLOMETRY_WORKER_URL' },
  { name: 'SMAUG_API_URL' },
];

const EXPECTED_TABLES = [
  'posts',
  'feedback',
  'patterns',
  'queue',
  'sources',
  'accounts',
  'formulas',
  'cost_tracking',
  'rules',
  'generation_jobs',
  'threshold_overrides',
  '_migrations',
] as const;

const QDRANT_COLLECTIONS = [
  'approved_posts',
  'voice_guidelines',
  'sources',
  'ai_slop_corpus',
] as const;

// ============================================================================
// Helpers
// ============================================================================

function getDbPath(): string {
  const envPath = process.env.SQLITE_DB_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  return path.resolve(process.cwd(), 'data', 'ai-social-engine.db');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

// ============================================================================
// Component Checks
// ============================================================================

function checkDatabaseConnection(): ComponentStatus {
  const dbPath = getDbPath();

  // Check if file exists
  if (!fs.existsSync(dbPath)) {
    return {
      name: 'SQLite Database',
      status: 'fail',
      message: `Database file not found: ${dbPath}`,
      details: { path: dbPath },
    };
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // Check WAL mode
    const journalMode = db.pragma('journal_mode', { simple: true }) as string;

    // Get database size
    const stats = fs.statSync(dbPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    db.close();

    return {
      name: 'SQLite Database',
      status: 'pass',
      message: `Connected successfully (${sizeMB} MB)`,
      details: {
        path: dbPath,
        size: `${sizeMB} MB`,
        journalMode,
      },
    };
  } catch (error) {
    return {
      name: 'SQLite Database',
      status: 'fail',
      message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { path: dbPath },
    };
  }
}

function checkDatabaseTables(): ComponentStatus {
  const dbPath = getDbPath();

  if (!fs.existsSync(dbPath)) {
    return {
      name: 'Database Tables',
      status: 'fail',
      message: 'Database file not found',
    };
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // Get all table names
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    db.close();

    const missingTables = EXPECTED_TABLES.filter((t) => !tableNames.includes(t));

    if (missingTables.length > 0) {
      return {
        name: 'Database Tables',
        status: 'fail',
        message: `Missing tables: ${missingTables.join(', ')}`,
        details: {
          expected: EXPECTED_TABLES,
          found: tableNames,
          missing: missingTables,
        },
      };
    }

    return {
      name: 'Database Tables',
      status: 'pass',
      message: `All ${EXPECTED_TABLES.length} required tables exist`,
      details: {
        tables: tableNames,
      },
    };
  } catch (error) {
    return {
      name: 'Database Tables',
      status: 'fail',
      message: `Failed to query tables: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function checkRequiredEnvVars(): ComponentStatus {
  const missing: string[] = [];
  const found: string[] = [];
  const invalidFormat: Array<{ name: string; expected: string }> = [];

  for (const config of REQUIRED_ENV_VARS) {
    const value = process.env[config.name];
    if (!value) {
      missing.push(config.name);
    } else {
      found.push(config.name);
      // Validate format if specified
      if (config.format && !config.format.test(value)) {
        invalidFormat.push({
          name: config.name,
          expected: config.formatDescription ?? config.format.toString(),
        });
      }
    }
  }

  if (missing.length > 0) {
    return {
      name: 'Required Environment Variables',
      status: 'fail',
      message: `Missing: ${missing.join(', ')}`,
      details: { missing, found, invalidFormat },
    };
  }

  if (invalidFormat.length > 0) {
    const formatErrors = invalidFormat.map((f) => `${f.name} (expected: ${f.expected})`);
    return {
      name: 'Required Environment Variables',
      status: 'warn',
      message: `Invalid format: ${formatErrors.join(', ')}`,
      details: { found, invalidFormat },
    };
  }

  return {
    name: 'Required Environment Variables',
    status: 'pass',
    message: `All ${REQUIRED_ENV_VARS.length} required variables set with valid format`,
    details: { found },
  };
}

function checkOptionalEnvVars(): ComponentStatus {
  const configured: string[] = [];
  const notConfigured: string[] = [];
  const invalidFormat: Array<{ name: string; expected: string }> = [];

  for (const config of OPTIONAL_ENV_VARS) {
    const value = process.env[config.name];
    if (value) {
      configured.push(config.name);
      // Validate format if specified
      if (config.format && !config.format.test(value)) {
        invalidFormat.push({
          name: config.name,
          expected: config.formatDescription ?? config.format.toString(),
        });
      }
    } else {
      notConfigured.push(config.name);
    }
  }

  if (configured.length === 0) {
    return {
      name: 'Optional Environment Variables',
      status: 'warn',
      message: 'No optional providers configured',
      details: { configured, notConfigured },
    };
  }

  if (invalidFormat.length > 0) {
    const formatErrors = invalidFormat.map((f) => `${f.name} (expected: ${f.expected})`);
    return {
      name: 'Optional Environment Variables',
      status: 'warn',
      message: `${configured.length} set, invalid format: ${formatErrors.join(', ')}`,
      details: { configured, notConfigured, invalidFormat },
    };
  }

  return {
    name: 'Optional Environment Variables',
    status: 'pass',
    message: `${configured.length}/${OPTIONAL_ENV_VARS.length} optional variables set`,
    details: { configured, notConfigured },
  };
}

async function checkQdrantConnection(): Promise<ComponentStatus> {
  const url = process.env.QDRANT_URL ?? 'http://localhost:6333';
  const apiKey = process.env.QDRANT_API_KEY;
  const timeout = parseInt(process.env.QDRANT_TIMEOUT_MS ?? '5000', 10);

  try {
    const client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
      timeout,
    });

    const start = Date.now();
    const collections = await withTimeout(
      client.getCollections(),
      timeout,
      `Qdrant connection timed out after ${timeout}ms`
    );
    const latency = Date.now() - start;

    const collectionNames = collections.collections.map((c) => c.name);
    const foundCollections = QDRANT_COLLECTIONS.filter((c) => collectionNames.includes(c));
    const missingCollections = QDRANT_COLLECTIONS.filter((c) => !collectionNames.includes(c));

    if (missingCollections.length === QDRANT_COLLECTIONS.length) {
      return {
        name: 'Qdrant Vector Database',
        status: 'warn',
        message: `Connected (${formatDuration(latency)}) but no collections exist`,
        details: {
          url,
          latency: `${latency}ms`,
          collections: collectionNames,
          expectedCollections: QDRANT_COLLECTIONS,
        },
      };
    }

    if (missingCollections.length > 0) {
      return {
        name: 'Qdrant Vector Database',
        status: 'warn',
        message: `Connected but missing collections: ${missingCollections.join(', ')}`,
        details: {
          url,
          latency: `${latency}ms`,
          found: foundCollections,
          missing: missingCollections,
        },
      };
    }

    return {
      name: 'Qdrant Vector Database',
      status: 'pass',
      message: `Connected (${formatDuration(latency)}), all collections exist`,
      details: {
        url,
        latency: `${latency}ms`,
        collections: foundCollections,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check if it's a connection error vs timeout
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return {
        name: 'Qdrant Vector Database',
        status: 'warn',
        message: `Not running at ${url} (optional service)`,
        details: { url, error: message },
      };
    }

    return {
      name: 'Qdrant Vector Database',
      status: 'warn',
      message: `Connection failed: ${message}`,
      details: { url, error: message },
    };
  }
}

function checkLLMProviderConfig(): ComponentStatus {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const providers: Array<{ name: string; configured: boolean; keyFormat: boolean }> = [];

  // Check Anthropic
  if (anthropicKey) {
    const validFormat = anthropicKey.startsWith('sk-ant-');
    providers.push({ name: 'Anthropic', configured: true, keyFormat: validFormat });
  } else {
    providers.push({ name: 'Anthropic', configured: false, keyFormat: false });
  }

  // Check OpenAI
  if (openaiKey) {
    const validFormat = openaiKey.startsWith('sk-');
    providers.push({ name: 'OpenAI', configured: true, keyFormat: validFormat });
  } else {
    providers.push({ name: 'OpenAI', configured: false, keyFormat: false });
  }

  const configuredProviders = providers.filter((p) => p.configured);
  const invalidFormats = providers.filter((p) => p.configured && !p.keyFormat);

  if (configuredProviders.length === 0) {
    return {
      name: 'LLM Provider Configuration',
      status: 'fail',
      message: 'No LLM providers configured',
      details: { providers },
    };
  }

  if (invalidFormats.length > 0) {
    return {
      name: 'LLM Provider Configuration',
      status: 'warn',
      message: `Invalid key format for: ${invalidFormats.map((p) => p.name).join(', ')}`,
      details: { providers },
    };
  }

  return {
    name: 'LLM Provider Configuration',
    status: 'pass',
    message: `${configuredProviders.length} provider(s) configured: ${configuredProviders.map((p) => p.name).join(', ')}`,
    details: { providers },
  };
}

async function checkAnthropicConnectivity(): Promise<ComponentStatus> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const timeout = 10000;

  if (!apiKey) {
    return {
      name: 'Anthropic API Connectivity',
      status: 'warn',
      message: 'Not configured (ANTHROPIC_API_KEY not set)',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const start = Date.now();
    // Use the messages endpoint with a minimal request to verify connectivity
    // We use a GET-like approach by sending an empty/minimal body that will fail validation
    // but proves we can connect and authenticate
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      // Minimal body - will fail with validation error but proves auth works
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    clearTimeout(timeoutId);
    const latency = Date.now() - start;

    // 200 = success, 400 = validation error (still means auth worked)
    // 401/403 = auth failed
    if (response.status === 401 || response.status === 403) {
      return {
        name: 'Anthropic API Connectivity',
        status: 'fail',
        message: `Authentication failed (HTTP ${response.status})`,
        details: { latency: `${latency}ms` },
      };
    }

    if (response.status === 429) {
      return {
        name: 'Anthropic API Connectivity',
        status: 'warn',
        message: `Rate limited (${formatDuration(latency)})`,
        details: { latency: `${latency}ms` },
      };
    }

    // Success case: we got a response (even 400 means we're connected and auth'd)
    return {
      name: 'Anthropic API Connectivity',
      status: 'pass',
      message: `Connected (${formatDuration(latency)})`,
      details: { latency: `${latency}ms`, httpStatus: response.status },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        name: 'Anthropic API Connectivity',
        status: 'warn',
        message: `Timeout after ${timeout}ms`,
        details: { error: 'timeout' },
      };
    }

    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return {
        name: 'Anthropic API Connectivity',
        status: 'warn',
        message: 'Network error - unable to reach API',
        details: { error: message },
      };
    }

    return {
      name: 'Anthropic API Connectivity',
      status: 'warn',
      message: `Connection failed: ${message}`,
      details: { error: message },
    };
  }
}

async function checkOpenAIConnectivity(): Promise<ComponentStatus> {
  const apiKey = process.env.OPENAI_API_KEY;
  const timeout = 10000;

  if (!apiKey) {
    return {
      name: 'OpenAI API Connectivity',
      status: 'warn',
      message: 'Not configured (OPENAI_API_KEY not set)',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const start = Date.now();
    // Use the models endpoint to verify connectivity - lightweight GET request
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    clearTimeout(timeoutId);
    const latency = Date.now() - start;

    if (response.status === 401 || response.status === 403) {
      return {
        name: 'OpenAI API Connectivity',
        status: 'fail',
        message: `Authentication failed (HTTP ${response.status})`,
        details: { latency: `${latency}ms` },
      };
    }

    if (response.status === 429) {
      return {
        name: 'OpenAI API Connectivity',
        status: 'warn',
        message: `Rate limited (${formatDuration(latency)})`,
        details: { latency: `${latency}ms` },
      };
    }

    if (!response.ok) {
      return {
        name: 'OpenAI API Connectivity',
        status: 'warn',
        message: `Unexpected response (HTTP ${response.status})`,
        details: { latency: `${latency}ms` },
      };
    }

    return {
      name: 'OpenAI API Connectivity',
      status: 'pass',
      message: `Connected (${formatDuration(latency)})`,
      details: { latency: `${latency}ms` },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        name: 'OpenAI API Connectivity',
        status: 'warn',
        message: `Timeout after ${timeout}ms`,
        details: { error: 'timeout' },
      };
    }

    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return {
        name: 'OpenAI API Connectivity',
        status: 'warn',
        message: 'Network error - unable to reach API',
        details: { error: message },
      };
    }

    return {
      name: 'OpenAI API Connectivity',
      status: 'warn',
      message: `Connection failed: ${message}`,
      details: { error: message },
    };
  }
}

async function checkWorkerHealth(
  name: string,
  urlEnvVar: string,
  defaultUrl: string
): Promise<ComponentStatus> {
  const url = process.env[urlEnvVar] ?? defaultUrl;
  const healthUrl = `${url}/health`;
  const timeout = 5000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const start = Date.now();
    const response = await fetch(healthUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);
    const latency = Date.now() - start;

    if (!response.ok) {
      return {
        name,
        status: 'warn',
        message: `Unhealthy (HTTP ${response.status})`,
        details: { url, latency: `${latency}ms` },
      };
    }

    const health = (await response.json()) as Record<string, unknown>;
    const workerStatus = health.status as string | undefined;

    if (workerStatus === 'degraded') {
      return {
        name,
        status: 'warn',
        message: `Degraded (${formatDuration(latency)})`,
        details: { url, latency: `${latency}ms`, health },
      };
    }

    return {
      name,
      status: 'pass',
      message: `Healthy (${formatDuration(latency)})`,
      details: { url, latency: `${latency}ms`, health },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes('ECONNREFUSED') ||
      message.includes('fetch failed') ||
      error instanceof Error && error.name === 'AbortError'
    ) {
      return {
        name,
        status: 'warn',
        message: `Not running at ${url} (optional service)`,
        details: { url },
      };
    }

    return {
      name,
      status: 'warn',
      message: `Check failed: ${message}`,
      details: { url, error: message },
    };
  }
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(components: ComponentStatus[]): HealthReport {
  const passed = components.filter((c) => c.status === 'pass').length;
  const failed = components.filter((c) => c.status === 'fail').length;
  const warnings = components.filter((c) => c.status === 'warn').length;

  let overallStatus: HealthReport['overallStatus'];
  if (failed > 0) {
    overallStatus = 'unhealthy';
  } else if (warnings > 0) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    components,
    summary: { passed, failed, warnings },
  };
}

function printReport(report: HealthReport): void {
  const statusColors = {
    pass: '\x1b[32m', // green
    fail: '\x1b[31m', // red
    warn: '\x1b[33m', // yellow
  };
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';

  const statusIcons = {
    pass: '✓',
    fail: '✗',
    warn: '!',
  };

  console.log('\n' + bold + '═══════════════════════════════════════════════════════════════' + reset);
  console.log(bold + '                    SYSTEM HEALTH CHECK REPORT' + reset);
  console.log(bold + '═══════════════════════════════════════════════════════════════' + reset);
  console.log(`Timestamp: ${report.timestamp}`);
  console.log('');

  // Component results
  console.log(bold + 'Components:' + reset);
  console.log('───────────────────────────────────────────────────────────────');

  for (const component of report.components) {
    const icon = statusIcons[component.status];
    const color = statusColors[component.status];
    console.log(`${color}${icon}${reset} ${bold}${component.name}${reset}`);
    console.log(`  ${component.message}`);
    if (component.details && process.env.VERBOSE) {
      console.log(`  Details: ${JSON.stringify(component.details, null, 2).replace(/\n/g, '\n  ')}`);
    }
  }

  console.log('───────────────────────────────────────────────────────────────');

  // Summary
  const { passed, failed, warnings } = report.summary;
  const total = passed + failed + warnings;

  console.log('');
  console.log(bold + 'Summary:' + reset);
  console.log(`  ${statusColors.pass}${statusIcons.pass} Passed: ${passed}/${total}${reset}`);
  if (warnings > 0) {
    console.log(`  ${statusColors.warn}${statusIcons.warn} Warnings: ${warnings}${reset}`);
  }
  if (failed > 0) {
    console.log(`  ${statusColors.fail}${statusIcons.fail} Failed: ${failed}${reset}`);
  }

  // Overall status
  console.log('');
  const overallColor =
    report.overallStatus === 'healthy'
      ? statusColors.pass
      : report.overallStatus === 'degraded'
        ? statusColors.warn
        : statusColors.fail;
  console.log(
    `${bold}Overall Status: ${overallColor}${report.overallStatus.toUpperCase()}${reset}`
  );
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// ============================================================================
// Main
// ============================================================================

function parseArgs(): { json: boolean; dbOnly: boolean } {
  const args = process.argv.slice(2);
  return {
    json: args.includes('--json'),
    dbOnly: args.includes('--db-only'),
  };
}

async function main(): Promise<void> {
  const { json, dbOnly } = parseArgs();

  // Load environment variables from .env.local if present
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value !== undefined && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }

  const components: ComponentStatus[] = [];

  if (!json) {
    console.log('\nRunning health checks...\n');
  }

  // Synchronous checks - database
  components.push(checkDatabaseConnection());
  components.push(checkDatabaseTables());

  // If db-only mode, stop here
  if (!dbOnly) {
    components.push(checkRequiredEnvVars());
    components.push(checkOptionalEnvVars());
    components.push(checkLLMProviderConfig());

    // Async checks - external services
    components.push(await checkQdrantConnection());
    components.push(await checkAnthropicConnectivity());
    components.push(await checkOpenAIConnectivity());

    // Worker health checks
    components.push(
      await checkWorkerHealth('LiteLLM Gateway Worker', 'LITELLM_GATEWAY_URL', 'http://localhost:8001')
    );
    components.push(
      await checkWorkerHealth('LangGraph Worker', 'LANGGRAPH_WORKER_URL', 'http://localhost:8002')
    );
    components.push(
      await checkWorkerHealth('Stylometry Worker', 'STYLOMETRY_WORKER_URL', 'http://localhost:8003')
    );
  }

  // Generate report
  const report = generateReport(components);

  // Output in JSON or human-readable format
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  // Exit with appropriate code
  process.exit(report.overallStatus === 'unhealthy' ? 1 : 0);
}

main().catch((error) => {
  console.error('Health check failed with error:', error);
  process.exit(1);
});
