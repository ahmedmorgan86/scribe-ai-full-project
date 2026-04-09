/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by tracking provider health and failing fast
 * when a provider is known to be unhealthy.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Provider is failing, requests fail immediately
 * - HALF_OPEN: Testing if provider has recovered
 *
 * Configuration via environment variables:
 * - CIRCUIT_BREAKER_THRESHOLD: Consecutive failures before opening (default: 5)
 * - CIRCUIT_BREAKER_TIMEOUT: Ms before testing recovery (default: 30000)
 * - CIRCUIT_BREAKER_SUCCESS_THRESHOLD: Successes in half-open to close (default: 2)
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('circuit-breaker');

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  successThreshold: number;
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastStateChange: number;
  totalFailures: number;
  totalSuccesses: number;
  totalRejected: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastStateChange: number;
  totalFailures: number;
  totalSuccesses: number;
  totalRejected: number;
}

function getConfig(): CircuitBreakerConfig {
  return {
    failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD ?? '5', 10),
    resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT ?? '30000', 10),
    successThreshold: parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD ?? '2', 10),
  };
}

export class CircuitBreaker {
  private name: string;
  private config: CircuitBreakerConfig;
  private internalState: CircuitBreakerState;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    const defaultConfig = getConfig();
    this.config = { ...defaultConfig, ...config };
    this.internalState = {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      lastStateChange: Date.now(),
      totalFailures: 0,
      totalSuccesses: 0,
      totalRejected: 0,
    };
  }

  get state(): CircuitState {
    this.checkStateTransition();
    return this.internalState.state;
  }

  get status(): CircuitBreakerStatus {
    this.checkStateTransition();
    return {
      state: this.internalState.state,
      failures: this.internalState.failures,
      successes: this.internalState.successes,
      lastFailureTime: this.internalState.lastFailureTime,
      lastSuccessTime: this.internalState.lastSuccessTime,
      lastStateChange: this.internalState.lastStateChange,
      totalFailures: this.internalState.totalFailures,
      totalSuccesses: this.internalState.totalSuccesses,
      totalRejected: this.internalState.totalRejected,
    };
  }

  private checkStateTransition(): void {
    if (this.internalState.state === 'OPEN') {
      const now = Date.now();
      const timeSinceLastFailure =
        this.internalState.lastFailureTime !== null
          ? now - this.internalState.lastFailureTime
          : Infinity;

      if (timeSinceLastFailure >= this.config.resetTimeout) {
        this.transitionTo('HALF_OPEN');
        logger.info(`Circuit breaker [${this.name}]: OPEN -> HALF_OPEN (testing recovery)`);
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.internalState.state;
    this.internalState.state = newState;
    this.internalState.lastStateChange = Date.now();

    if (newState === 'CLOSED') {
      this.internalState.failures = 0;
      this.internalState.successes = 0;
    } else if (newState === 'HALF_OPEN') {
      this.internalState.successes = 0;
    }

    logger.info(`Circuit breaker [${this.name}]: ${oldState} -> ${newState}`);
  }

  isOpen(): boolean {
    this.checkStateTransition();
    return this.internalState.state === 'OPEN';
  }

  canAttempt(): boolean {
    this.checkStateTransition();
    return this.internalState.state !== 'OPEN';
  }

  recordSuccess(): void {
    this.internalState.successes++;
    this.internalState.totalSuccesses++;
    this.internalState.lastSuccessTime = Date.now();

    if (this.internalState.state === 'HALF_OPEN') {
      if (this.internalState.successes >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
        logger.info(
          `Circuit breaker [${this.name}]: HALF_OPEN -> CLOSED (recovered after ${this.internalState.successes} successes)`
        );
      }
    } else if (this.internalState.state === 'CLOSED') {
      this.internalState.failures = 0;
    }
  }

  recordFailure(): void {
    this.internalState.failures++;
    this.internalState.totalFailures++;
    this.internalState.lastFailureTime = Date.now();

    if (this.internalState.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      logger.warn(`Circuit breaker [${this.name}]: HALF_OPEN -> OPEN (recovery failed)`);
    } else if (this.internalState.state === 'CLOSED') {
      if (this.internalState.failures >= this.config.failureThreshold) {
        this.transitionTo('OPEN');
        logger.warn(
          `Circuit breaker [${this.name}]: CLOSED -> OPEN (threshold ${this.config.failureThreshold} reached)`
        );
      }
    }
  }

  recordRejected(): void {
    this.internalState.totalRejected++;
  }

  reset(): void {
    this.internalState = {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      lastStateChange: Date.now(),
      totalFailures: 0,
      totalSuccesses: 0,
      totalRejected: 0,
    };
    logger.info(`Circuit breaker [${this.name}]: Reset to CLOSED`);
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.checkStateTransition();

    if (this.internalState.state === 'OPEN') {
      this.recordRejected();
      throw new CircuitBreakerOpenError(
        `Circuit breaker [${this.name}] is OPEN. Request rejected.`,
        this.name
      );
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public circuitName: string
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  let breaker = circuitBreakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, config);
    circuitBreakers.set(name, breaker);
  }
  return breaker;
}

export function getAllCircuitBreakers(): Map<string, CircuitBreaker> {
  return circuitBreakers;
}

export function getCircuitBreakerStatuses(): Record<string, CircuitBreakerStatus> {
  const statuses: Record<string, CircuitBreakerStatus> = {};
  for (const [name, breaker] of circuitBreakers) {
    statuses[name] = breaker.status;
  }
  return statuses;
}

export function resetAllCircuitBreakers(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset();
  }
  logger.info('All circuit breakers reset');
}

export function clearCircuitBreakers(): void {
  circuitBreakers.clear();
  logger.info('All circuit breakers cleared');
}

const PROVIDER_CIRCUITS = {
  anthropic: 'provider:anthropic',
  openai: 'provider:openai',
  litellm: 'provider:litellm',
} as const;

export type ProviderName = keyof typeof PROVIDER_CIRCUITS;

export function getProviderCircuitBreaker(provider: ProviderName): CircuitBreaker {
  return getCircuitBreaker(PROVIDER_CIRCUITS[provider]);
}

export function getProviderCircuitStatuses(): Record<ProviderName, CircuitBreakerStatus> {
  return {
    anthropic: getProviderCircuitBreaker('anthropic').status,
    openai: getProviderCircuitBreaker('openai').status,
    litellm: getProviderCircuitBreaker('litellm').status,
  };
}

export function isProviderAvailable(provider: ProviderName): boolean {
  return getProviderCircuitBreaker(provider).canAttempt();
}

export async function executeWithProviderCircuit<T>(
  provider: ProviderName,
  operation: () => Promise<T>
): Promise<T> {
  const breaker = getProviderCircuitBreaker(provider);
  return breaker.execute(operation);
}
