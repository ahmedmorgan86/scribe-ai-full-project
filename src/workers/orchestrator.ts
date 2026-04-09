import {
  startSmaugWorker,
  stopSmaugWorker,
  isSmaugWorkerRunning,
  configureSmaugWorker,
  awaitSmaugWorkerCompletion,
  type SmaugWorkerConfig,
  type SmaugPollResult,
} from './smaug-worker';
import {
  startApifyWorker,
  stopApifyWorker,
  isApifyWorkerRunning,
  configureApifyWorker,
  awaitApifyWorkerCompletion,
  type ApifyWorkerConfig,
  type ApifyScrapeResult,
} from './apify-worker';
import {
  startGenerationWorker,
  stopGenerationWorker,
  isGenerationWorkerRunning,
  configureGenerationWorker,
  awaitGenerationWorkerCompletion,
  type GenerationWorkerConfig,
  type GenerationProcessResult,
} from './generation-worker';
import {
  startQueueWorker,
  stopQueueWorker,
  isQueueWorkerRunning,
  configureQueueWorker,
  awaitQueueWorkerCompletion,
  type QueueWorkerConfig,
  type QueueProcessResult,
} from './queue-worker';

function logInfo(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [orchestrator] INFO: ${message}${logData}`);
}

function logError(message: string, error?: unknown, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const errorMsg = error instanceof Error ? error.message : String(error ?? '');
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  const errorSuffix = errorMsg ? `: ${errorMsg}` : '';
  console.error(`[${timestamp}] [orchestrator] ERROR: ${message}${errorSuffix}${logData}`);
}

function logWarn(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  console.warn(`[${timestamp}] [orchestrator] WARN: ${message}${logData}`);
}

export type WorkerType = 'smaug' | 'apify' | 'generation' | 'queue';

export interface OrchestratorConfig {
  smaug: Partial<SmaugWorkerConfig>;
  apify: Partial<ApifyWorkerConfig>;
  generation: Partial<GenerationWorkerConfig>;
  queue: Partial<QueueWorkerConfig>;
  enabledWorkers: WorkerType[];
}

export interface OrchestratorStatus {
  running: boolean;
  workers: {
    smaug: { running: boolean; enabled: boolean };
    apify: { running: boolean; enabled: boolean };
    generation: { running: boolean; enabled: boolean };
    queue: { running: boolean; enabled: boolean };
  };
  startedAt: string | null;
}

export interface WorkerEvent {
  type: 'smaug_poll' | 'apify_scrape' | 'generation_process' | 'queue_process';
  timestamp: string;
  result: SmaugPollResult | ApifyScrapeResult | GenerationProcessResult | QueueProcessResult;
}

export type WorkerEventCallback = (event: WorkerEvent) => void;

const DEFAULT_CONFIG: OrchestratorConfig = {
  smaug: {},
  apify: {},
  generation: {},
  queue: {},
  enabledWorkers: ['smaug', 'apify', 'generation', 'queue'],
};

let orchestratorConfig: OrchestratorConfig = { ...DEFAULT_CONFIG };
let startedAt: string | null = null;
let eventCallback: WorkerEventCallback | null = null;
let isShuttingDown = false;

export function getOrchestratorConfig(): OrchestratorConfig {
  return { ...orchestratorConfig };
}

export function configureOrchestrator(config: Partial<OrchestratorConfig>): void {
  orchestratorConfig = {
    ...orchestratorConfig,
    ...config,
    smaug: { ...orchestratorConfig.smaug, ...config.smaug },
    apify: { ...orchestratorConfig.apify, ...config.apify },
    generation: { ...orchestratorConfig.generation, ...config.generation },
    queue: { ...orchestratorConfig.queue, ...config.queue },
  };
}

export function resetOrchestratorConfig(): void {
  orchestratorConfig = { ...DEFAULT_CONFIG };
}

function isWorkerEnabled(worker: WorkerType): boolean {
  return orchestratorConfig.enabledWorkers.includes(worker);
}

function handleSmaugPollResult(result: SmaugPollResult): void {
  if (eventCallback) {
    eventCallback({
      type: 'smaug_poll',
      timestamp: new Date().toISOString(),
      result,
    });
  }
}

function handleApifyScrapeResult(result: ApifyScrapeResult): void {
  if (eventCallback) {
    eventCallback({
      type: 'apify_scrape',
      timestamp: new Date().toISOString(),
      result,
    });
  }
}

function handleGenerationProcessResult(result: GenerationProcessResult): void {
  if (eventCallback) {
    eventCallback({
      type: 'generation_process',
      timestamp: new Date().toISOString(),
      result,
    });
  }
}

function handleQueueProcessResult(result: QueueProcessResult): void {
  if (eventCallback) {
    eventCallback({
      type: 'queue_process',
      timestamp: new Date().toISOString(),
      result,
    });
  }
}

export function startOrchestrator(onEvent?: WorkerEventCallback): void {
  if (isOrchestratorRunning()) {
    logWarn('Orchestrator already running, skipping start');
    return;
  }

  logInfo('Starting worker orchestrator', {
    enabledWorkers: orchestratorConfig.enabledWorkers,
  });

  eventCallback = onEvent ?? null;
  startedAt = new Date().toISOString();
  isShuttingDown = false;

  if (isWorkerEnabled('smaug')) {
    configureSmaugWorker(orchestratorConfig.smaug);
    startSmaugWorker(handleSmaugPollResult);
    logInfo('Smaug worker started');
  }

  if (isWorkerEnabled('apify')) {
    configureApifyWorker(orchestratorConfig.apify);
    startApifyWorker(handleApifyScrapeResult);
    logInfo('Apify worker started');
  }

  if (isWorkerEnabled('generation')) {
    configureGenerationWorker(orchestratorConfig.generation);
    startGenerationWorker(handleGenerationProcessResult);
    logInfo('Generation worker started');
  }

  if (isWorkerEnabled('queue')) {
    configureQueueWorker(orchestratorConfig.queue);
    startQueueWorker(handleQueueProcessResult);
    logInfo('Queue worker started');
  }

  logInfo('Worker orchestrator started');
}

export function stopOrchestrator(): void {
  if (!isOrchestratorRunning()) {
    logWarn('Orchestrator not running, skipping stop');
    return;
  }

  logInfo('Stopping worker orchestrator');
  isShuttingDown = true;

  if (isSmaugWorkerRunning()) {
    stopSmaugWorker();
    logInfo('Smaug worker stopped');
  }

  if (isApifyWorkerRunning()) {
    stopApifyWorker();
    logInfo('Apify worker stopped');
  }

  if (isGenerationWorkerRunning()) {
    stopGenerationWorker();
    logInfo('Generation worker stopped');
  }

  if (isQueueWorkerRunning()) {
    stopQueueWorker();
    logInfo('Queue worker stopped');
  }

  startedAt = null;
  eventCallback = null;
  isShuttingDown = false;

  logInfo('Worker orchestrator stopped');
}

export function isOrchestratorRunning(): boolean {
  return startedAt !== null && !isShuttingDown;
}

export function getOrchestratorStatus(): OrchestratorStatus {
  return {
    running: isOrchestratorRunning(),
    workers: {
      smaug: {
        running: isSmaugWorkerRunning(),
        enabled: isWorkerEnabled('smaug'),
      },
      apify: {
        running: isApifyWorkerRunning(),
        enabled: isWorkerEnabled('apify'),
      },
      generation: {
        running: isGenerationWorkerRunning(),
        enabled: isWorkerEnabled('generation'),
      },
      queue: {
        running: isQueueWorkerRunning(),
        enabled: isWorkerEnabled('queue'),
      },
    },
    startedAt,
  };
}

export async function gracefulShutdown(timeoutMs: number = 30000): Promise<boolean> {
  if (!isOrchestratorRunning()) {
    return true;
  }

  logInfo('Initiating graceful shutdown', { timeoutMs });
  isShuttingDown = true;

  stopSmaugWorker();
  stopApifyWorker();
  stopGenerationWorker();
  stopQueueWorker();

  const awaitAllCompletions = async (): Promise<void> => {
    logInfo('Waiting for in-progress operations to complete');
    await Promise.all([
      awaitSmaugWorkerCompletion(),
      awaitApifyWorkerCompletion(),
      awaitGenerationWorkerCompletion(),
      awaitQueueWorkerCompletion(),
    ]);
  };

  const shutdownPromise = awaitAllCompletions().then(() => {
    startedAt = null;
    eventCallback = null;
    isShuttingDown = false;
    logInfo('Graceful shutdown completed');
    return true;
  });

  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      logError('Graceful shutdown timed out, forcing stop');
      startedAt = null;
      eventCallback = null;
      isShuttingDown = false;
      resolve(false);
    }, timeoutMs);
  });

  return Promise.race([shutdownPromise, timeoutPromise]);
}

let shutdownHandlersRegistered = false;

export function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) {
    return;
  }

  const handleSignal = (signal: string): void => {
    logInfo(`Received ${signal}, initiating shutdown`);
    void gracefulShutdown().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));

  shutdownHandlersRegistered = true;
  logInfo('Shutdown handlers registered');
}
