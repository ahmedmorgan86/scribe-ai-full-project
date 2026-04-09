'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import type { CostWidgetData } from '@/components/dashboard/CostWidget';
import type { ApiName } from '@/types';

const DEFAULT_POLL_INTERVAL = 30000;

export interface UseCostDataOptions {
  pollInterval?: number;
  enabled?: boolean;
}

export interface UseCostDataResult {
  costData: CostWidgetData;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

interface ApiCostResponse {
  apiName: string;
  dailyCost: number;
  monthlyCost: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  dailyRemaining?: number;
  monthlyRemaining?: number;
  dailyPercentUsed?: number;
  monthlyPercentUsed?: number;
}

interface CostsApiResponse {
  byApi: ApiCostResponse[];
  totalDailyCost: number;
  totalMonthlyCost: number;
  timestamp: string;
}

function createEmptyCostData(): CostWidgetData {
  return {
    byApi: [
      { apiName: 'anthropic' as ApiName, dailyCost: 0, monthlyCost: 0 },
      { apiName: 'apify' as ApiName, dailyCost: 0, monthlyCost: 0 },
      { apiName: 'smaug' as ApiName, dailyCost: 0, monthlyCost: 0 },
    ],
    totalDailyCost: 0,
    totalMonthlyCost: 0,
    timestamp: new Date().toISOString(),
  };
}

export function useCostData(options: UseCostDataOptions = {}): UseCostDataResult {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  const [costData, setCostData] = useState<CostWidgetData>(createEmptyCostData());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const isMountedRef = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchCosts = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/costs');

      if (!isMountedRef.current) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as CostsApiResponse;

      if (!isMountedRef.current) return;

      setCostData({
        byApi: data.byApi.map((api) => ({
          apiName: api.apiName as ApiName,
          dailyCost: api.dailyCost,
          monthlyCost: api.monthlyCost,
          dailyLimit: api.dailyLimit,
          monthlyLimit: api.monthlyLimit,
          dailyRemaining: api.dailyRemaining,
          monthlyRemaining: api.monthlyRemaining,
          dailyPercentUsed: api.dailyPercentUsed,
          monthlyPercentUsed: api.monthlyPercentUsed,
        })),
        totalDailyCost: data.totalDailyCost,
        totalMonthlyCost: data.totalMonthlyCost,
        timestamp: data.timestamp,
      });
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch cost data'));
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
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    void fetchCosts();

    intervalRef.current = setInterval(() => {
      void fetchCosts();
    }, pollInterval);

    return (): void => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, pollInterval, fetchCosts]);

  const refetch = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await fetchCosts();
  }, [fetchCosts]);

  return {
    costData,
    isLoading,
    error,
    refetch,
  };
}
