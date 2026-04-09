import { describe, it, expect } from 'vitest';

// Note: React ErrorBoundary components are class-based components that require
// a jsdom environment for proper testing with React Testing Library.
// This project uses node environment, so we test the exports and types.

describe('ErrorBoundary exports', () => {
  it('should export ErrorBoundary', async () => {
    const { ErrorBoundary } = await import('./ErrorBoundary');
    expect(ErrorBoundary).toBeDefined();
    expect(typeof ErrorBoundary).toBe('function');
  });

  it('should export SectionErrorBoundary', async () => {
    const { SectionErrorBoundary } = await import('./SectionErrorBoundary');
    expect(SectionErrorBoundary).toBeDefined();
    expect(typeof SectionErrorBoundary).toBe('function');
  });

  it('should export from index', async () => {
    const exports = await import('./index');
    expect(exports.ErrorBoundary).toBeDefined();
    expect(exports.SectionErrorBoundary).toBeDefined();
  });
});

describe('ErrorDisplay exports', () => {
  it('should export ErrorDisplay component', async () => {
    const { ErrorDisplay } = await import('./ErrorDisplay');
    expect(ErrorDisplay).toBeDefined();
    expect(typeof ErrorDisplay).toBe('function');
  });

  it('should export ErrorList component', async () => {
    const { ErrorList } = await import('./ErrorDisplay');
    expect(ErrorList).toBeDefined();
    expect(typeof ErrorList).toBe('function');
  });

  it('should export InlineError component', async () => {
    const { InlineError } = await import('./ErrorDisplay');
    expect(InlineError).toBeDefined();
    expect(typeof InlineError).toBe('function');
  });

  it('should export error factory functions', async () => {
    const {
      createDisplayError,
      createApiError,
      createNetworkError,
      createBudgetError,
      errorFromResponse,
    } = await import('./ErrorDisplay');

    expect(createDisplayError).toBeDefined();
    expect(createApiError).toBeDefined();
    expect(createNetworkError).toBeDefined();
    expect(createBudgetError).toBeDefined();
    expect(errorFromResponse).toBeDefined();
  });
});

describe('createDisplayError', () => {
  it('creates error with default severity', async () => {
    const { createDisplayError } = await import('./ErrorDisplay');
    const error = createDisplayError('Test message');

    expect(error.message).toBe('Test message');
    expect(error.severity).toBe('error');
    expect(error.id).toMatch(/^err-\d+-[a-z0-9]+$/);
    expect(error.timestamp).toBeDefined();
  });

  it('accepts custom options', async () => {
    const { createDisplayError } = await import('./ErrorDisplay');
    const error = createDisplayError('Test message', {
      severity: 'warning',
      source: 'api',
      retryable: true,
      code: 'ERR_001',
      details: 'Some details',
    });

    expect(error.severity).toBe('warning');
    expect(error.source).toBe('api');
    expect(error.retryable).toBe(true);
    expect(error.code).toBe('ERR_001');
    expect(error.details).toBe('Some details');
  });
});

describe('createApiError', () => {
  it('creates API error with correct defaults', async () => {
    const { createApiError } = await import('./ErrorDisplay');
    const error = createApiError('API failed', 'ERR_API_001', 'Stack trace');

    expect(error.message).toBe('API failed');
    expect(error.source).toBe('api');
    expect(error.code).toBe('ERR_API_001');
    expect(error.details).toBe('Stack trace');
    expect(error.retryable).toBe(true);
  });
});

describe('createNetworkError', () => {
  it('creates network error with warning severity', async () => {
    const { createNetworkError } = await import('./ErrorDisplay');
    const error = createNetworkError('Network timeout');

    expect(error.message).toBe('Network timeout');
    expect(error.source).toBe('network');
    expect(error.severity).toBe('warning');
    expect(error.retryable).toBe(true);
  });
});

describe('createBudgetError', () => {
  it('creates budget error with critical severity', async () => {
    const { createBudgetError } = await import('./ErrorDisplay');
    const error = createBudgetError('Budget exceeded');

    expect(error.message).toBe('Budget exceeded');
    expect(error.source).toBe('budget');
    expect(error.severity).toBe('critical');
    expect(error.retryable).toBe(false);
  });
});

describe('errorFromResponse', () => {
  it('creates error from Error object', async () => {
    const { errorFromResponse } = await import('./ErrorDisplay');
    const error = errorFromResponse(new Error('Something went wrong'));

    expect(error.message).toBe('Something went wrong');
    expect(error.source).toBe('unknown');
    expect(error.retryable).toBe(true);
  });

  it('creates error from plain object', async () => {
    const { errorFromResponse } = await import('./ErrorDisplay');
    const error = errorFromResponse({ message: 'Plain object error' });

    expect(error.message).toBe('Plain object error');
  });
});
