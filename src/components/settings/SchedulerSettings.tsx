'use client';

import { useState, useEffect, useCallback } from 'react';

interface SchedulerConfig {
  id: number;
  enabled: boolean;
  intervalMinutes: number;
  maxQueueSize: number;
  sourceMode: 'round_robin' | 'random' | 'weighted' | 'manual';
  manualSourceIds: number[] | null;
  timeSlots: string[] | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface SchedulerRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  status: string;
  sourceId: number | null;
  postsGenerated: number;
  postsQueued: number;
  error: string | null;
  durationMs: number | null;
}

interface SchedulerStatus {
  config: SchedulerConfig;
  shouldRunNow: boolean;
  currentQueueSize: number;
  recentRuns: SchedulerRun[];
  stats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    skippedRuns: number;
    totalPostsGenerated: number;
    totalPostsQueued: number;
    avgDurationMs: number;
  };
}

interface SourceOption {
  id: number;
  sourceType: string;
  sourceId: string;
}

const SOURCE_MODES = [
  { value: 'round_robin', label: 'Round Robin', description: 'Cycle through all sources evenly' },
  { value: 'random', label: 'Random', description: 'Pick a random source each time' },
  { value: 'weighted', label: 'Weighted', description: 'Favor less-used sources' },
  { value: 'manual', label: 'Manual', description: 'Use only selected sources' },
] as const;

export function SchedulerSettings(): React.ReactElement {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [sources, setSources] = useState<SourceOption[]>([]);

  const [localConfig, setLocalConfig] = useState<{
    enabled: boolean;
    intervalMinutes: number;
    maxQueueSize: number;
    sourceMode: 'round_robin' | 'random' | 'weighted' | 'manual';
    manualSourceIds: number[];
    timeSlots: string[];
  } | null>(null);

  const [newTimeSlot, setNewTimeSlot] = useState('');

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/scheduler/status');
      if (!response.ok) throw new Error('Failed to fetch scheduler status');
      const data = (await response.json()) as SchedulerStatus;
      setStatus(data);
      setLocalConfig({
        enabled: data.config.enabled,
        intervalMinutes: data.config.intervalMinutes,
        maxQueueSize: data.config.maxQueueSize,
        sourceMode: data.config.sourceMode,
        manualSourceIds: data.config.manualSourceIds ?? [],
        timeSlots: data.config.timeSlots ?? [],
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch scheduler status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchSources = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/sources');
      if (!response.ok) throw new Error('Failed to fetch sources');
      const data = (await response.json()) as { sources: SourceOption[] };
      setSources(data.sources);
    } catch {
      // Silently fail - sources list is non-critical
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    void fetchSources();
  }, [fetchStatus, fetchSources]);

  const handleSave = async (): Promise<void> => {
    if (!localConfig) return;
    setSaving(true);
    try {
      const response = await fetch('/api/scheduler/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: localConfig.enabled,
          intervalMinutes: localConfig.intervalMinutes,
          maxQueueSize: localConfig.maxQueueSize,
          sourceMode: localConfig.sourceMode,
          manualSourceIds:
            localConfig.manualSourceIds.length > 0 ? localConfig.manualSourceIds : null,
          timeSlots: localConfig.timeSlots.length > 0 ? localConfig.timeSlots : null,
        }),
      });
      if (!response.ok) throw new Error('Failed to save config');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async (): Promise<void> => {
    setIsRunning(true);
    try {
      const response = await fetch('/api/scheduler/run', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to trigger run');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger run');
    } finally {
      setIsRunning(false);
    }
  };

  const addTimeSlot = (): void => {
    if (!localConfig || !newTimeSlot) return;
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(newTimeSlot)) {
      setError('Invalid time format. Use HH:MM');
      return;
    }
    if (localConfig.timeSlots.includes(newTimeSlot)) {
      setError('Time slot already exists');
      return;
    }
    setLocalConfig({
      ...localConfig,
      timeSlots: [...localConfig.timeSlots, newTimeSlot].sort(),
    });
    setNewTimeSlot('');
    setError(null);
  };

  const removeTimeSlot = (slot: string): void => {
    if (!localConfig) return;
    setLocalConfig({
      ...localConfig,
      timeSlots: localConfig.timeSlots.filter((s) => s !== slot),
    });
  };

  const toggleSourceSelection = (sourceId: number): void => {
    if (!localConfig) return;
    const isSelected = localConfig.manualSourceIds.includes(sourceId);
    setLocalConfig({
      ...localConfig,
      manualSourceIds: isSelected
        ? localConfig.manualSourceIds.filter((id) => id !== sourceId)
        : [...localConfig.manualSourceIds, sourceId],
    });
  };

  const hasChanges =
    status !== null &&
    localConfig !== null &&
    (localConfig.enabled !== status.config.enabled ||
      localConfig.intervalMinutes !== status.config.intervalMinutes ||
      localConfig.maxQueueSize !== status.config.maxQueueSize ||
      localConfig.sourceMode !== status.config.sourceMode ||
      JSON.stringify(localConfig.manualSourceIds) !==
        JSON.stringify(status.config.manualSourceIds ?? []) ||
      JSON.stringify(localConfig.timeSlots) !== JSON.stringify(status.config.timeSlots ?? []));

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading scheduler status...</div>;
  }

  if (!status || !localConfig) {
    return (
      <div className="p-4 rounded-lg bg-red-900/20 border border-red-500/50">
        <p className="text-red-400 text-sm">{error ?? 'Failed to load scheduler status'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/50">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Main Toggle & Save */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.enabled}
              onChange={(e) => setLocalConfig({ ...localConfig, enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
          </label>
          <span className="text-sm font-medium text-gray-200">
            {localConfig.enabled ? 'Scheduler Enabled' : 'Scheduler Disabled'}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void handleRunNow()}
            disabled={isRunning || !status.config.enabled}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/50 hover:bg-purple-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? 'Running...' : 'Run Now'}
          </button>
          {hasChanges && (
            <button
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block mb-1">Queue Size</span>
          <span className="text-lg font-medium text-gray-200">
            {status.currentQueueSize}/{status.config.maxQueueSize}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block mb-1">Last Run</span>
          <span className="text-sm text-gray-200">
            {status.config.lastRunAt
              ? new Date(status.config.lastRunAt).toLocaleTimeString()
              : 'Never'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block mb-1">Next Run</span>
          <span className="text-sm text-gray-200">
            {status.config.nextRunAt
              ? new Date(status.config.nextRunAt).toLocaleTimeString()
              : 'Not scheduled'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
          <span className="text-xs text-gray-500 block mb-1">7-Day Stats</span>
          <span className="text-sm text-gray-200">
            {status.stats.successfulRuns}/{status.stats.totalRuns} runs
          </span>
        </div>
      </div>

      {/* Interval & Queue Size */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-300 block mb-2">
            Generation Interval (minutes)
          </label>
          <input
            type="number"
            value={localConfig.intervalMinutes}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                intervalMinutes: Math.max(1, Math.min(1440, parseInt(e.target.value) || 60)),
              })
            }
            min={1}
            max={1440}
            className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-lg text-gray-200 focus:border-blue-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">How often to generate new content</p>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-300 block mb-2">Max Queue Size</label>
          <input
            type="number"
            value={localConfig.maxQueueSize}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                maxQueueSize: Math.max(1, Math.min(100, parseInt(e.target.value) || 10)),
              })
            }
            min={1}
            max={100}
            className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-lg text-gray-200 focus:border-blue-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">Stop generating when queue reaches this size</p>
        </div>
      </div>

      {/* Source Selection Mode */}
      <div>
        <label className="text-sm font-medium text-gray-300 block mb-2">
          Source Selection Mode
        </label>
        <div className="grid grid-cols-2 gap-2">
          {SOURCE_MODES.map((mode) => (
            <label
              key={mode.value}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                localConfig.sourceMode === mode.value
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <input
                type="radio"
                name="sourceMode"
                value={mode.value}
                checked={localConfig.sourceMode === mode.value}
                onChange={(e) =>
                  setLocalConfig({
                    ...localConfig,
                    sourceMode: e.target.value as typeof localConfig.sourceMode,
                  })
                }
                className="sr-only"
              />
              <span className="text-sm font-medium text-gray-200 block">{mode.label}</span>
              <span className="text-xs text-gray-500">{mode.description}</span>
            </label>
          ))}
        </div>

        {/* Manual Source Selection - always rendered but hidden when not manual mode */}
        <div
          className={`overflow-hidden transition-all duration-200 ease-in-out ${
            localConfig.sourceMode === 'manual'
              ? 'max-h-[300px] opacity-100 mt-4'
              : 'max-h-0 opacity-0 mt-0'
          }`}
        >
          <label className="text-sm font-medium text-gray-300 block mb-2">Select Sources</label>
          <div className="max-h-48 overflow-y-auto border border-gray-700 rounded-lg">
            {sources.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">No sources available</p>
            ) : (
              sources.map((source) => (
                <label
                  key={source.id}
                  className={`flex items-center gap-3 p-3 border-b border-gray-700 last:border-b-0 cursor-pointer hover:bg-gray-800/50 ${
                    localConfig.manualSourceIds.includes(source.id) ? 'bg-blue-500/10' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={localConfig.manualSourceIds.includes(source.id)}
                    onChange={() => toggleSourceSelection(source.id)}
                    className="rounded border-gray-600"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-200 block truncate">{source.sourceId}</span>
                    <span className="text-xs text-gray-500">{source.sourceType}</span>
                  </div>
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {localConfig.manualSourceIds.length} source(s) selected
          </p>
        </div>
      </div>

      {/* Time Slots */}
      <div>
        <label className="text-sm font-medium text-gray-300 block mb-2">
          Time Slots (Optional)
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Limit generation to specific times. Leave empty to generate at any time.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newTimeSlot}
            onChange={(e) => setNewTimeSlot(e.target.value)}
            placeholder="HH:MM (e.g. 09:00)"
            className="flex-1 px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-lg text-gray-200 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={addTimeSlot}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600"
          >
            Add
          </button>
        </div>
        {localConfig.timeSlots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {localConfig.timeSlots.map((slot) => (
              <span
                key={slot}
                className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-gray-800 rounded border border-gray-700"
              >
                {slot}
                <button
                  onClick={() => removeTimeSlot(slot)}
                  className="text-gray-500 hover:text-red-400 ml-1"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Recent Runs */}
      {status.recentRuns.length > 0 && (
        <div>
          <label className="text-sm font-medium text-gray-300 block mb-2">Recent Runs</label>
          <div className="space-y-2">
            {status.recentRuns.slice(0, 5).map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between p-2 rounded bg-gray-900 border border-gray-700"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      run.status === 'completed'
                        ? 'bg-green-500'
                        : run.status === 'failed'
                          ? 'bg-red-500'
                          : run.status === 'skipped'
                            ? 'bg-yellow-500'
                            : 'bg-gray-500'
                    }`}
                  />
                  <span className="text-xs text-gray-400">
                    {new Date(run.startedAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {run.postsQueued > 0 && (
                    <span className="text-green-400">+{run.postsQueued} queued</span>
                  )}
                  {run.error && (
                    <span className="text-red-400 truncate max-w-[150px]" title={run.error}>
                      {run.error}
                    </span>
                  )}
                  {run.durationMs !== null && (
                    <span className="text-gray-500">{run.durationMs}ms</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SchedulerSettings;
