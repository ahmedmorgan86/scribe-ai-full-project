/**
 * Resilience Patterns Module
 *
 * Provides circuit breaker and retry utilities for fault-tolerant operations.
 */

export {
  CircuitBreaker,
  CircuitBreakerOpenError,
  getCircuitBreaker,
  getAllCircuitBreakers,
  getCircuitBreakerStatuses,
  resetAllCircuitBreakers,
  clearCircuitBreakers,
  getProviderCircuitBreaker,
  getProviderCircuitStatuses,
  isProviderAvailable,
  executeWithProviderCircuit,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStatus,
  type ProviderName,
} from './circuit-breaker';

export {
  withRetry,
  retryWithResult,
  createRetryableOperation,
  calculateBackoff,
  calculateDecorrelatedJitter,
  sleep,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
  type RetryResult,
  type RetryableCheck,
} from './retry';
