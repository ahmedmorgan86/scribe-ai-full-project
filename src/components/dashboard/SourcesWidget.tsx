'use client';

import { useState, useEffect, useCallback } from 'react';

interface SourceStats {
  total: number;
  unused: number;
  usedToday: number;
  byType: Record<string, number>;
}

interface ApifyStatus {
  connected: boolean;
  configured: boolean;
  worker: {
    running: boolean;
    scraping: boolean;
  };
  accounts: {
    tier1: number;
    tier2: number;
    total: number;
  };
}

interface SourcesWidgetProps {
  pollInterval?: number;
}

export function SourcesWidget({ pollInterval = 60000 }: SourcesWidgetProps): React.ReactElement {
  const [stats, setStats] = useState<SourceStats | null>(null);
  const [apifyStatus, setApifyStatus] = useState<ApifyStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isScraping, setIsScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScrapeResult, setLastScrapeResult] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const [statsRes, statusRes] = await Promise.all([
        fetch('/api/sources?stats=true'),
        fetch('/api/apify/status'),
      ]);

      if (statsRes.ok) {
        const statsData = (await statsRes.json()) as SourceStats;
        setStats(statsData);
      }

      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as ApifyStatus;
        setApifyStatus(statusData);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), pollInterval);
    return () => clearInterval(interval);
  }, [fetchData, pollInterval]);

  const handleScrape = async (tier?: 1 | 2): Promise<void> => {
    setIsScraping(true);
    setLastScrapeResult(null);

    try {
      const response = await fetch('/api/apify/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });

      const data = (await response.json()) as {
        success: boolean;
        result?: { tweetsInserted?: number; totalTweetsInserted?: number };
        error?: string;
      };

      if (data.success && data.result) {
        const imported = data.result.totalTweetsInserted ?? data.result.tweetsInserted ?? 0;
        setLastScrapeResult(`Imported ${imported} new sources`);
        void fetchData();
      } else {
        setLastScrapeResult(`Scrape failed: ${data.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      setLastScrapeResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsScraping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Content Sources</h3>
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Content Sources</h3>
        <div className="text-sm text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-gray-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-white">Content Sources</h3>
        {apifyStatus !== null && (
          <span
            className={`text-xs px-2 py-1 rounded ${
              apifyStatus.connected
                ? 'bg-green-500/20 text-green-400'
                : apifyStatus.configured
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-red-500/20 text-red-400'
            }`}
          >
            {apifyStatus.connected
              ? 'Connected'
              : apifyStatus.configured
                ? 'Configured'
                : 'Not Set'}
          </span>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block">Total</span>
          <span className="text-lg font-medium text-gray-200">{stats?.total ?? 0}</span>
        </div>
        <div className="p-3 rounded bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block">Ready</span>
          <span
            className={`text-lg font-medium ${
              (stats?.unused ?? 0) === 0 ? 'text-red-400' : 'text-green-400'
            }`}
          >
            {stats?.unused ?? 0}
          </span>
        </div>
        <div className="p-3 rounded bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block">Used Today</span>
          <span className="text-lg font-medium text-gray-200">{stats?.usedToday ?? 0}</span>
        </div>
      </div>

      {/* Accounts Info */}
      {apifyStatus !== null && apifyStatus.accounts.total > 0 && (
        <div className="text-xs text-gray-500 mb-4">
          {apifyStatus.accounts.total} accounts ({apifyStatus.accounts.tier1} Tier 1,{' '}
          {apifyStatus.accounts.tier2} Tier 2)
        </div>
      )}

      {/* Warning if no sources */}
      {(stats?.unused ?? 0) === 0 && (
        <div className="p-3 rounded bg-yellow-500/10 border border-yellow-500/30 mb-4">
          <p className="text-xs text-yellow-400">
            No sources available. Run a scrape to fetch tweets from curated accounts.
          </p>
        </div>
      )}

      {/* Last Scrape Result */}
      {lastScrapeResult !== null && (
        <div
          className={`p-2 rounded text-xs mb-4 ${
            lastScrapeResult.startsWith('Imported')
              ? 'bg-green-500/10 text-green-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {lastScrapeResult}
        </div>
      )}

      {/* Scrape Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => void handleScrape()}
          disabled={isScraping || apifyStatus?.configured !== true}
          className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isScraping ? 'Scraping...' : 'Scrape All'}
        </button>
        <button
          onClick={() => void handleScrape(1)}
          disabled={isScraping || apifyStatus?.configured !== true}
          className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Scrape Tier 1 accounts only"
        >
          T1
        </button>
        <button
          onClick={() => void handleScrape(2)}
          disabled={isScraping || apifyStatus?.configured !== true}
          className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Scrape Tier 2 accounts only"
        >
          T2
        </button>
      </div>
    </div>
  );
}

export default SourcesWidget;
