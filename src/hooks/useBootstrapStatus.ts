'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

export interface BootstrapStatus {
  voiceGuidelinesLoaded: boolean;
  approvedPostsCount: number;
  hasMinimumCorpus: boolean;
  accountsCount: number;
  formulasCount: number;
  hasActiveFormula: boolean;
  apiKeysConfigured: {
    anthropic: boolean;
    apify: boolean;
  };
  discordWebhookConfigured: boolean;
  isReady: boolean;
  missingRequirements: string[];
  qdrantAvailable?: boolean;
}

export interface UseBootstrapStatusResult {
  status: BootstrapStatus | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useBootstrapStatus(): UseBootstrapStatusResult {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/bootstrap/status');

      if (!isMountedRef.current) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as BootstrapStatus;

      if (!isMountedRef.current) return;

      setStatus(data);
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch bootstrap status'));
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const refetch = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await fetchStatus();
  }, [fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refetch,
  };
}
