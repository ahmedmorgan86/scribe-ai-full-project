import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  getCircuitBreaker,
  clearCircuitBreakers,
  getProviderCircuitBreaker,
  isProviderAvailable,
  getProviderCircuitStatuses,
} from './circuit-breaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    clearCircuitBreakers();
    vi.unstubAllEnvs();
  });

  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      const breaker = new CircuitBreaker('test');
      expect(breaker.state).toBe('CLOSED');
    });

    it('allows attempts when CLOSED', () => {
      const breaker = new CircuitBreaker('test');
      expect(breaker.canAttempt()).toBe(true);
      expect(breaker.isOpen()).toBe(false);
    });
  });

  describe('failure tracking', () => {
    it('opens circuit after threshold failures', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 3 });

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.state).toBe('CLOSED');

      breaker.recordFailure();
      expect(breaker.state).toBe('OPEN');
    });

    it('resets failure count on success in CLOSED state', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 3 });

      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.state).toBe('CLOSED');
    });
  });

  describe('OPEN state', () => {
    it('rejects requests when OPEN', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1 });
      breaker.recordFailure();

      expect(breaker.state).toBe('OPEN');
      expect(breaker.canAttempt()).toBe(false);
      expect(breaker.isOpen()).toBe(true);
    });

    it('tracks rejected requests', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1 });
      breaker.recordFailure();
      breaker.recordRejected();
      breaker.recordRejected();

      expect(breaker.status.totalRejected).toBe(2);
    });
  });

  describe('HALF_OPEN state', () => {
    it('transitions to HALF_OPEN after timeout', () => {
      vi.useFakeTimers();
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 1000,
      });

      breaker.recordFailure();
      expect(breaker.state).toBe('OPEN');

      vi.advanceTimersByTime(1000);
      expect(breaker.state).toBe('HALF_OPEN');

      vi.useRealTimers();
    });

    it('closes circuit after success threshold in HALF_OPEN', () => {
      vi.useFakeTimers();
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 1000,
        successThreshold: 2,
      });

      breaker.recordFailure();
      vi.advanceTimersByTime(1000);
      expect(breaker.state).toBe('HALF_OPEN');

      breaker.recordSuccess();
      expect(breaker.state).toBe('HALF_OPEN');

      breaker.recordSuccess();
      expect(breaker.state).toBe('CLOSED');

      vi.useRealTimers();
    });

    it('opens circuit immediately on failure in HALF_OPEN', () => {
      vi.useFakeTimers();
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 1000,
      });

      breaker.recordFailure();
      vi.advanceTimersByTime(1000);
      expect(breaker.state).toBe('HALF_OPEN');

      breaker.recordFailure();
      expect(breaker.state).toBe('OPEN');

      vi.useRealTimers();
    });
  });

  describe('execute', () => {
    it('executes operation and records success', async () => {
      const breaker = new CircuitBreaker('test');
      const result = await breaker.execute(() => Promise.resolve('success'));

      expect(result).toBe('success');
      expect(breaker.status.totalSuccesses).toBe(1);
    });

    it('executes operation and records failure', async () => {
      const breaker = new CircuitBreaker('test');
      const failingOp = breaker.execute(() => Promise.reject(new Error('test error')));

      await expect(failingOp).rejects.toThrow('test error');

      expect(breaker.status.totalFailures).toBe(1);
    });

    it('throws CircuitBreakerOpenError when OPEN', async () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1 });
      breaker.recordFailure();
      const blockedOp = breaker.execute(() => Promise.resolve('success'));

      await expect(blockedOp).rejects.toThrow(CircuitBreakerOpenError);
    });
  });

  describe('reset', () => {
    it('resets circuit to initial state', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1 });

      breaker.recordFailure();
      expect(breaker.state).toBe('OPEN');

      breaker.reset();
      expect(breaker.state).toBe('CLOSED');
      expect(breaker.status.totalFailures).toBe(0);
    });
  });

  describe('status', () => {
    it('tracks total metrics', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 5 });

      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordSuccess();

      const status = breaker.status;
      expect(status.totalSuccesses).toBe(3);
      expect(status.totalFailures).toBe(1);
      expect(status.failures).toBe(0);
    });
  });
});

describe('Circuit Breaker Registry', () => {
  beforeEach(() => {
    clearCircuitBreakers();
  });

  it('returns same instance for same name', () => {
    const breaker1 = getCircuitBreaker('test');
    const breaker2 = getCircuitBreaker('test');
    expect(breaker1).toBe(breaker2);
  });

  it('returns different instances for different names', () => {
    const breaker1 = getCircuitBreaker('test1');
    const breaker2 = getCircuitBreaker('test2');
    expect(breaker1).not.toBe(breaker2);
  });
});

describe('Provider Circuit Breakers', () => {
  beforeEach(() => {
    clearCircuitBreakers();
  });

  it('creates separate circuits for each provider', () => {
    const anthropic = getProviderCircuitBreaker('anthropic');
    const openai = getProviderCircuitBreaker('openai');

    anthropic.recordFailure();

    expect(anthropic.status.totalFailures).toBe(1);
    expect(openai.status.totalFailures).toBe(0);
  });

  it('isProviderAvailable returns false when circuit is OPEN', () => {
    const breaker = getProviderCircuitBreaker('anthropic');

    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }

    expect(isProviderAvailable('anthropic')).toBe(false);
    expect(isProviderAvailable('openai')).toBe(true);
  });

  it('getProviderCircuitStatuses returns all provider statuses', () => {
    getProviderCircuitBreaker('anthropic').recordSuccess();
    getProviderCircuitBreaker('openai').recordFailure();

    const statuses = getProviderCircuitStatuses();

    expect(statuses.anthropic.totalSuccesses).toBe(1);
    expect(statuses.openai.totalFailures).toBe(1);
  });
});

describe('Configuration via environment', () => {
  beforeEach(() => {
    clearCircuitBreakers();
    vi.unstubAllEnvs();
  });

  it('uses default values when env vars not set', () => {
    const breaker = new CircuitBreaker('test');

    for (let i = 0; i < 4; i++) {
      breaker.recordFailure();
    }
    expect(breaker.state).toBe('CLOSED');

    breaker.recordFailure();
    expect(breaker.state).toBe('OPEN');
  });

  it('respects CIRCUIT_BREAKER_THRESHOLD env var', () => {
    vi.stubEnv('CIRCUIT_BREAKER_THRESHOLD', '2');
    clearCircuitBreakers();

    const breaker = new CircuitBreaker('test');

    breaker.recordFailure();
    expect(breaker.state).toBe('CLOSED');

    breaker.recordFailure();
    expect(breaker.state).toBe('OPEN');
  });
});
