import { scrapeAccount, type NormalizedSource, type ScrapeAccountResult } from '@/lib/apify/client';
import { createSource, sourceExists } from '@/db/models/sources';
import {
  listAccounts,
  updateLastScraped,
  updateHealthStatus,
  getAccountsByTier,
} from '@/db/models/accounts';
import {
  checkSourceDuplicateHybrid,
  addSourceToQdrant,
  SOURCE_SIMILARITY_THRESHOLD,
} from '@/lib/sources/deduplication';
import type { Source, Account, AccountTier } from '@/types';
import { shouldAllowOperation, checkAndHaltIfBudgetExhausted } from '@/lib/costs/operations-halt';

function logInfo(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [apify-worker] INFO: ${message}${logData}`);
}

function logError(message: string, error?: unknown, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const errorMsg = error instanceof Error ? error.message : String(error ?? '');
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  const errorSuffix = errorMsg ? `: ${errorMsg}` : '';
  console.error(`[${timestamp}] [apify-worker] ERROR: ${message}${errorSuffix}${logData}`);
}

function logWarn(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  console.warn(`[${timestamp}] [apify-worker] WARN: ${message}${logData}`);
}

export interface ApifyWorkerConfig {
  tier1IntervalMs: number;
  tier2IntervalMs: number;
  maxTweetsPerAccount: number;
  enabled: boolean;
  bulkFailureThreshold: number;
}

export interface ApifyScrapeResult {
  accountsProcessed: number;
  accountsSucceeded: number;
  accountsFailed: number;
  tweetsInserted: number;
  tweetsDuplicate: number;
  tweetsSemanticDuplicate: number;
  errors: ApifyScrapeError[];
  duration: number;
  tier: AccountTier;
}

export interface ApifyScrapeError {
  type: 'scrape' | 'insert' | 'health';
  handle: string;
  message: string;
  sourceId?: string;
}

const DEFAULT_CONFIG: ApifyWorkerConfig = {
  tier1IntervalMs: 30 * 60 * 1000,
  tier2IntervalMs: 2 * 60 * 60 * 1000,
  maxTweetsPerAccount: 50,
  enabled: true,
  bulkFailureThreshold: 0.2,
};

let workerConfig: ApifyWorkerConfig = { ...DEFAULT_CONFIG };
let tier1Timer: NodeJS.Timeout | null = null;
let tier2Timer: NodeJS.Timeout | null = null;
let isTier1Scraping = false;
let isTier2Scraping = false;
let shutdownRequested = false;
let completionResolvers: Array<() => void> = [];

export function getApifyWorkerConfig(): ApifyWorkerConfig {
  return { ...workerConfig };
}

export function configureApifyWorker(config: Partial<ApifyWorkerConfig>): void {
  workerConfig = { ...workerConfig, ...config };
}

export function resetApifyWorkerConfig(): void {
  workerConfig = { ...DEFAULT_CONFIG };
}

interface InsertWithDedupResult {
  inserted: boolean;
  source?: Source;
  isSemanticDuplicate?: boolean;
  semanticMatch?: { sourceId: string; similarity: number };
}

async function insertTweetWithDedup(normalized: NormalizedSource): Promise<InsertWithDedupResult> {
  if (sourceExists(normalized.sourceType, normalized.sourceId)) {
    return { inserted: false };
  }

  const hybridResult = await checkSourceDuplicateHybrid(normalized.content, {
    threshold: SOURCE_SIMILARITY_THRESHOLD,
    maxResults: 1,
    excludeSourceId: normalized.sourceId,
  });

  if (hybridResult.isDuplicate && hybridResult.matches.length > 0) {
    logInfo('Semantic duplicate found', {
      sourceId: normalized.sourceId,
      matchSourceId: hybridResult.matches[0].sourceId,
      similarity: hybridResult.matches[0].similarity,
    });
    return {
      inserted: false,
      isSemanticDuplicate: true,
      semanticMatch: {
        sourceId: hybridResult.matches[0].sourceId,
        similarity: hybridResult.matches[0].similarity,
      },
    };
  }

  const source = createSource({
    sourceType: normalized.sourceType,
    sourceId: normalized.sourceId,
    content: normalized.content,
    metadata: normalized.metadata,
  });

  try {
    await addSourceToQdrant(
      normalized.sourceId,
      normalized.content,
      normalized.sourceType,
      normalized.metadata
    );
  } catch (qdrantError) {
    logError('Failed to add source to Qdrant', qdrantError, { sourceId: normalized.sourceId });
  }

  return { inserted: true, source };
}

function updateAccountHealth(
  account: Account,
  success: boolean,
  consecutiveFailures: Map<number, number>
): void {
  const currentFailures = consecutiveFailures.get(account.id) ?? 0;

  if (success) {
    consecutiveFailures.set(account.id, 0);
    if (account.healthStatus !== 'healthy') {
      updateHealthStatus(account.id, 'healthy');
    }
  } else {
    const newFailures = currentFailures + 1;
    consecutiveFailures.set(account.id, newFailures);

    if (newFailures >= 5 && account.healthStatus !== 'failing') {
      updateHealthStatus(account.id, 'failing');
    } else if (newFailures >= 2 && account.healthStatus === 'healthy') {
      updateHealthStatus(account.id, 'degraded');
    }
  }
}

async function scrapeAccountWithRetry(
  handle: string,
  maxTweets: number
): Promise<ScrapeAccountResult> {
  return scrapeAccount(handle, {
    maxTweets,
    waitForCompletion: true,
    timeoutMs: 10 * 60 * 1000,
  });
}

export async function scrapeAccountsForTier(tier: AccountTier): Promise<ApifyScrapeResult> {
  const startTime = Date.now();
  const errors: ApifyScrapeError[] = [];
  let accountsProcessed = 0;
  let accountsSucceeded = 0;
  let accountsFailed = 0;
  let tweetsInserted = 0;
  let tweetsDuplicate = 0;
  let tweetsSemanticDuplicate = 0;

  checkAndHaltIfBudgetExhausted();

  if (!shouldAllowOperation('apify')) {
    logWarn('Apify operations halted due to budget constraints');
    return {
      accountsProcessed: 0,
      accountsSucceeded: 0,
      accountsFailed: 0,
      tweetsInserted: 0,
      tweetsDuplicate: 0,
      tweetsSemanticDuplicate: 0,
      errors: [
        {
          type: 'scrape',
          handle: '',
          message: 'Operations halted due to budget constraints',
        },
      ],
      duration: Date.now() - startTime,
      tier,
    };
  }

  const accounts = getAccountsByTier(tier);
  const consecutiveFailures = new Map<number, number>();

  logInfo(`Starting tier ${tier} scrape`, { accountCount: accounts.length });

  if (accounts.length === 0) {
    logInfo(`No accounts for tier ${tier}, skipping`);
    return {
      accountsProcessed: 0,
      accountsSucceeded: 0,
      accountsFailed: 0,
      tweetsInserted: 0,
      tweetsDuplicate: 0,
      tweetsSemanticDuplicate: 0,
      errors: [],
      duration: Date.now() - startTime,
      tier,
    };
  }

  for (const account of accounts) {
    if (account.healthStatus === 'failing') {
      logInfo(`Skipping failing account`, { handle: account.handle });
      continue;
    }

    accountsProcessed++;
    let scrapeResult: ScrapeAccountResult | null = null;

    try {
      scrapeResult = await scrapeAccountWithRetry(account.handle, workerConfig.maxTweetsPerAccount);

      if (scrapeResult.status === 'SUCCEEDED') {
        accountsSucceeded++;
        updateLastScraped(account.id, new Date().toISOString());
        updateAccountHealth(account, true, consecutiveFailures);

        logInfo(`Scraped account`, {
          handle: account.handle,
          tweetsFound: scrapeResult.totalFetched,
        });

        for (const tweet of scrapeResult.tweets) {
          try {
            const result = await insertTweetWithDedup(tweet);
            if (result.inserted) {
              tweetsInserted++;
            } else if (result.isSemanticDuplicate === true) {
              tweetsSemanticDuplicate++;
            } else {
              tweetsDuplicate++;
            }
          } catch (insertError) {
            logError('Failed to insert tweet', insertError, {
              handle: account.handle,
              sourceId: tweet.sourceId,
            });
            errors.push({
              type: 'insert',
              handle: account.handle,
              message: insertError instanceof Error ? insertError.message : 'Unknown insert error',
              sourceId: tweet.sourceId,
            });
          }
        }
      } else {
        accountsFailed++;
        updateAccountHealth(account, false, consecutiveFailures);
        logError('Account scrape failed', undefined, {
          handle: account.handle,
          status: scrapeResult.status,
        });
        errors.push({
          type: 'scrape',
          handle: account.handle,
          message: `Apify run status: ${scrapeResult.status}`,
        });
      }
    } catch (scrapeError) {
      accountsFailed++;
      updateAccountHealth(account, false, consecutiveFailures);
      logError('Account scrape error', scrapeError, { handle: account.handle });
      errors.push({
        type: 'scrape',
        handle: account.handle,
        message: scrapeError instanceof Error ? scrapeError.message : 'Unknown scrape error',
      });
    }
  }

  const duration = Date.now() - startTime;
  const failureRate = accountsProcessed > 0 ? accountsFailed / accountsProcessed : 0;

  if (failureRate >= workerConfig.bulkFailureThreshold) {
    logWarn('Bulk failure detected', {
      tier,
      failureRate: `${(failureRate * 100).toFixed(1)}%`,
      threshold: `${(workerConfig.bulkFailureThreshold * 100).toFixed(1)}%`,
      failed: accountsFailed,
      processed: accountsProcessed,
    });
  }

  logInfo(`Tier ${tier} scrape completed`, {
    accountsProcessed,
    accountsSucceeded,
    accountsFailed,
    tweetsInserted,
    tweetsDuplicate,
    tweetsSemanticDuplicate,
    errorCount: errors.length,
    durationMs: duration,
  });

  return {
    accountsProcessed,
    accountsSucceeded,
    accountsFailed,
    tweetsInserted,
    tweetsDuplicate,
    tweetsSemanticDuplicate,
    errors,
    duration,
    tier,
  };
}

function checkAndNotifyCompletion(): void {
  if (shutdownRequested && !isTier1Scraping && !isTier2Scraping) {
    for (const resolve of completionResolvers) {
      resolve();
    }
    completionResolvers = [];
  }
}

export function startApifyWorker(onScrape?: (result: ApifyScrapeResult) => void): void {
  if (tier1Timer !== null || tier2Timer !== null) {
    logInfo('Worker already running, skipping start');
    return;
  }

  if (!workerConfig.enabled) {
    logInfo('Worker disabled, skipping start');
    return;
  }

  logInfo('Starting Apify worker', {
    tier1IntervalMs: workerConfig.tier1IntervalMs,
    tier2IntervalMs: workerConfig.tier2IntervalMs,
  });
  shutdownRequested = false;

  const runTier1Scrape = async (): Promise<void> => {
    if (isTier1Scraping || shutdownRequested) return;
    isTier1Scraping = true;

    try {
      const result = await scrapeAccountsForTier(1);
      onScrape?.(result);
    } finally {
      isTier1Scraping = false;
      checkAndNotifyCompletion();
    }
  };

  const runTier2Scrape = async (): Promise<void> => {
    if (isTier2Scraping || shutdownRequested) return;
    isTier2Scraping = true;

    try {
      const result = await scrapeAccountsForTier(2);
      onScrape?.(result);
    } finally {
      isTier2Scraping = false;
      checkAndNotifyCompletion();
    }
  };

  void runTier1Scrape();
  void runTier2Scrape();

  tier1Timer = setInterval(() => {
    void runTier1Scrape();
  }, workerConfig.tier1IntervalMs);

  tier2Timer = setInterval(() => {
    void runTier2Scrape();
  }, workerConfig.tier2IntervalMs);
}

export function stopApifyWorker(): void {
  if (tier1Timer !== null) {
    clearInterval(tier1Timer);
    tier1Timer = null;
  }
  if (tier2Timer !== null) {
    clearInterval(tier2Timer);
    tier2Timer = null;
  }
  shutdownRequested = true;
  logInfo('Apify worker stopped');
}

export function awaitApifyWorkerCompletion(): Promise<void> {
  if (!isTier1Scraping && !isTier2Scraping) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    completionResolvers.push(resolve);
  });
}

export function isApifyWorkerRunning(): boolean {
  return tier1Timer !== null || tier2Timer !== null;
}

export function isApifyWorkerScraping(): boolean {
  return isTier1Scraping || isTier2Scraping;
}

export function getAccountsDueForScrape(tier: AccountTier): Account[] {
  const intervalMs = tier === 1 ? workerConfig.tier1IntervalMs : workerConfig.tier2IntervalMs;
  const threshold = new Date(Date.now() - intervalMs).toISOString();

  return listAccounts({
    tier,
    lastScrapedBefore: threshold,
    orderBy: 'last_scraped',
    orderDir: 'asc',
  }).filter((account) => account.healthStatus !== 'failing');
}
