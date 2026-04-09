'use client';

import { useState, useEffect, useCallback } from 'react';
import type { NotificationVerbosity, NotificationPreferences, ApiName } from '@/types';
import type { LLMHealthResponse } from '@/app/api/llm/health/route';
import type { WorkerStatusResponse } from '@/app/api/workers/health/route';
import type { WorkerServiceName, WorkerStatus } from '@/lib/workers/client';
import type { ThresholdsConfig } from '@/lib/config/thresholds';
import { SchedulerSettings } from '@/components/settings/SchedulerSettings';
import { TwitterAccountSettings } from '@/components/settings/TwitterAccountSettings';

interface ThresholdsResponse {
  thresholds: ThresholdsConfig;
  validationErrors?: string[];
}

interface BudgetStatusResponse {
  apiName: ApiName;
  period: 'daily' | 'monthly';
  used: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
}

interface VoiceExampleResponse {
  id: string;
  content: string;
  createdAt: string;
}

interface DataSourceConfig {
  smaugEnabled: boolean;
  smaugPollIntervalMinutes: number;
  apifyEnabled: boolean;
  apifyTier1IntervalMinutes: number;
  apifyTier2IntervalMinutes: number;
}

interface HumanizerSettings {
  autoHumanize: boolean;
}

interface SettingsData {
  notificationVerbosity: NotificationVerbosity;
  notificationPreferences: NotificationPreferences;
  budgetLimits: {
    anthropicDailyUsd: number;
    anthropicMonthlyUsd: number;
    apifyMonthlyUsd: number;
  };
  budgetStatus: BudgetStatusResponse[];
  voiceExamples: VoiceExampleResponse[];
  goldExamplesCount: number;
  dataSourceConfig: DataSourceConfig;
  humanizerSettings: HumanizerSettings;
}

const VERBOSITY_OPTIONS: { value: NotificationVerbosity; label: string; description: string }[] = [
  { value: 'minimal', label: 'Minimal', description: 'Only critical alerts and errors' },
  { value: 'summary', label: 'Summary', description: 'Daily summaries and important updates' },
  { value: 'rich', label: 'Rich', description: 'All notifications with full details' },
];

const NOTIFICATION_TYPE_OPTIONS: {
  key: keyof NotificationPreferences['enabledTypes'];
  label: string;
  description: string;
}[] = [
  {
    key: 'content_ready',
    label: 'Content Ready',
    description: 'When new content is ready for review',
  },
  {
    key: 'time_sensitive',
    label: 'Time Sensitive',
    description: 'Trending topics or urgent opportunities',
  },
  {
    key: 'agent_stuck',
    label: 'Agent Stuck',
    description: 'When the agent needs help or is confused',
  },
  {
    key: 'budget_warning',
    label: 'Budget Warning',
    description: 'When API costs approach limits',
  },
];

function getBudgetPercentage(used: number, limit: number): number {
  if (limit === 0) return 0;
  return Math.min(100, (used / limit) * 100);
}

function getBudgetColor(percentage: number): string {
  if (percentage >= 95) return 'bg-red-500';
  if (percentage >= 80) return 'bg-yellow-500';
  return 'bg-green-500';
}

function getBudgetTextColor(percentage: number): string {
  if (percentage >= 95) return 'text-red-400';
  if (percentage >= 80) return 'text-yellow-400';
  return 'text-green-400';
}

function getStatusColor(status: 'healthy' | 'degraded' | 'unavailable'): string {
  if (status === 'healthy') return 'bg-green-500';
  if (status === 'degraded') return 'bg-yellow-500';
  return 'bg-red-500';
}

function getStatusTextColor(status: 'healthy' | 'degraded' | 'unavailable'): string {
  if (status === 'healthy') return 'text-green-400';
  if (status === 'degraded') return 'text-yellow-400';
  return 'text-red-400';
}

function getProviderStatusIcon(available: boolean): React.ReactElement {
  if (available) {
    return (
      <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function getWorkerStatusColor(status: WorkerStatus): string {
  if (status === 'healthy') return 'bg-green-500';
  if (status === 'degraded') return 'bg-yellow-500';
  return 'bg-red-500';
}

function getWorkerStatusTextColor(status: WorkerStatus): string {
  if (status === 'healthy') return 'text-green-400';
  if (status === 'degraded') return 'text-yellow-400';
  return 'text-red-400';
}

function getWorkerDisplayName(service: WorkerServiceName): string {
  switch (service) {
    case 'litellm':
      return 'LiteLLM Gateway';
    case 'langgraph':
      return 'LangGraph Worker';
    case 'stylometry':
      return 'Stylometry Worker';
  }
}

function getWorkerDescription(service: WorkerServiceName): string {
  switch (service) {
    case 'litellm':
      return 'Multi-provider LLM fallback (optional - uses direct Anthropic API without)';
    case 'langgraph':
      return 'Advanced generation pipeline (optional - uses JS pipeline without)';
    case 'stylometry':
      return 'Python voice analysis (optional - uses JS stylometry without)';
  }
}

function getWorkerPort(service: WorkerServiceName): string {
  switch (service) {
    case 'litellm':
      return '8001';
    case 'langgraph':
      return '8002';
    case 'stylometry':
      return '8003';
  }
}

interface SectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function Section({ title, description, children }: SectionProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <h2 className="text-lg font-medium text-white mb-1">{title}</h2>
      <p className="text-sm text-gray-400 mb-4">{description}</p>
      {children}
    </div>
  );
}

interface BudgetCardProps {
  status: BudgetStatusResponse;
  limit: number;
  onLimitChange: (value: number) => void;
  isEditing: boolean;
}

function BudgetCard({
  status,
  limit,
  onLimitChange,
  isEditing,
}: BudgetCardProps): React.ReactElement {
  const percentage = getBudgetPercentage(status.used, status.limit);
  const periodLabel = status.period === 'daily' ? 'Today' : 'This Month';
  const apiLabel = status.apiName.charAt(0).toUpperCase() + status.apiName.slice(1);

  return (
    <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-200">
          {apiLabel} ({periodLabel})
        </span>
        <span className={`text-sm font-medium ${getBudgetTextColor(percentage)}`}>
          ${status.used.toFixed(2)} / ${status.limit.toFixed(2)}
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full ${getBudgetColor(percentage)} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {isEditing && (
        <div className="mt-3">
          <label className="text-xs text-gray-500">Limit (USD)</label>
          <input
            type="number"
            value={limit}
            onChange={(e) => onLimitChange(parseFloat(e.target.value) || 0)}
            min={0}
            step={0.5}
            className="mt-1 w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
          />
        </div>
      )}
      {status.exceeded && (
        <p className="text-xs text-red-400 mt-2">Budget exceeded - operations paused</p>
      )}
    </div>
  );
}

export default function SettingsPage(): React.ReactElement {
  const [data, setData] = useState<SettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [llmHealth, setLlmHealth] = useState<LLMHealthResponse | null>(null);
  const [llmHealthLoading, setLlmHealthLoading] = useState(true);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatusResponse | null>(null);
  const [workerStatusLoading, setWorkerStatusLoading] = useState(true);
  const [thresholds, setThresholds] = useState<ThresholdsConfig | null>(null);
  const [thresholdsLoading, setThresholdsLoading] = useState(true);
  const [thresholdsErrors, setThresholdsErrors] = useState<string[]>([]);
  const [isEditingWeights, setIsEditingWeights] = useState(false);
  const [localWeights, setLocalWeights] = useState<{
    sentenceLength: number;
    punctuation: number;
    vocabulary: number;
    functionWords: number;
    syntactic: number;
  } | null>(null);
  const [weightsSaving, setWeightsSaving] = useState(false);
  const [weightsError, setWeightsError] = useState<string | null>(null);

  const [localSettings, setLocalSettings] = useState<{
    notificationVerbosity: NotificationVerbosity;
    notifyContentReady: boolean;
    notifyTimeSensitive: boolean;
    notifyAgentStuck: boolean;
    notifyBudgetWarning: boolean;
    anthropicDailyUsd: number;
    anthropicMonthlyUsd: number;
    apifyMonthlyUsd: number;
    smaugEnabled: boolean;
    smaugPollIntervalMinutes: number;
    apifyEnabled: boolean;
    apifyTier1IntervalMinutes: number;
    apifyTier2IntervalMinutes: number;
    autoHumanize: boolean;
  } | null>(null);

  const fetchSettings = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = (await response.json()) as SettingsData;
      setData(result);
      setLocalSettings({
        notificationVerbosity: result.notificationVerbosity,
        notifyContentReady: result.notificationPreferences.enabledTypes.content_ready,
        notifyTimeSensitive: result.notificationPreferences.enabledTypes.time_sensitive,
        notifyAgentStuck: result.notificationPreferences.enabledTypes.agent_stuck,
        notifyBudgetWarning: result.notificationPreferences.enabledTypes.budget_warning,
        anthropicDailyUsd: result.budgetLimits.anthropicDailyUsd,
        anthropicMonthlyUsd: result.budgetLimits.anthropicMonthlyUsd,
        apifyMonthlyUsd: result.budgetLimits.apifyMonthlyUsd,
        smaugEnabled: result.dataSourceConfig.smaugEnabled,
        smaugPollIntervalMinutes: result.dataSourceConfig.smaugPollIntervalMinutes,
        apifyEnabled: result.dataSourceConfig.apifyEnabled,
        apifyTier1IntervalMinutes: result.dataSourceConfig.apifyTier1IntervalMinutes,
        apifyTier2IntervalMinutes: result.dataSourceConfig.apifyTier2IntervalMinutes,
        autoHumanize: result.humanizerSettings.autoHumanize,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchLLMHealth = useCallback(async (): Promise<void> => {
    setLlmHealthLoading(true);
    try {
      const response = await fetch('/api/llm/health');
      if (response.ok) {
        const result = (await response.json()) as LLMHealthResponse;
        setLlmHealth(result);
      }
    } catch {
      // Silently fail - LLM health is informational
    } finally {
      setLlmHealthLoading(false);
    }
  }, []);

  const fetchWorkerStatus = useCallback(async (): Promise<void> => {
    setWorkerStatusLoading(true);
    try {
      const response = await fetch('/api/workers/health');
      if (response.ok) {
        const result = (await response.json()) as WorkerStatusResponse;
        setWorkerStatus(result);
      }
    } catch {
      // Silently fail - worker status is informational
    } finally {
      setWorkerStatusLoading(false);
    }
  }, []);

  const fetchThresholds = useCallback(async (): Promise<void> => {
    setThresholdsLoading(true);
    try {
      const response = await fetch('/api/config/thresholds');
      if (response.ok) {
        const result = (await response.json()) as ThresholdsResponse;
        setThresholds(result.thresholds);
        setThresholdsErrors(result.validationErrors ?? []);
        setLocalWeights({
          sentenceLength: result.thresholds.stylometryWeights.sentenceLength,
          punctuation: result.thresholds.stylometryWeights.punctuation,
          vocabulary: result.thresholds.stylometryWeights.vocabulary,
          functionWords: result.thresholds.stylometryWeights.functionWords,
          syntactic: result.thresholds.stylometryWeights.syntactic,
        });
      }
    } catch {
      // Silently fail - thresholds are informational
    } finally {
      setThresholdsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
    void fetchLLMHealth();
    void fetchWorkerStatus();
    void fetchThresholds();
  }, [fetchSettings, fetchLLMHealth, fetchWorkerStatus, fetchThresholds]);

  const handleSave = async (): Promise<void> => {
    if (!localSettings) return;
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localSettings),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      await fetchSettings();
      setSaveSuccess(true);
      setIsEditingBudget(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveWeights = async (): Promise<void> => {
    if (!localWeights) return;
    setWeightsSaving(true);
    setWeightsError(null);

    const weightSum =
      localWeights.sentenceLength +
      localWeights.punctuation +
      localWeights.vocabulary +
      localWeights.functionWords +
      localWeights.syntactic;

    if (Math.abs(weightSum - 1.0) > 0.01) {
      setWeightsError(`Weights must sum to 1.0 (current sum: ${weightSum.toFixed(3)})`);
      setWeightsSaving(false);
      return;
    }

    try {
      const response = await fetch('/api/settings/thresholds', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thresholds: [
            { key: 'stylometryWeights.sentenceLength', value: localWeights.sentenceLength },
            { key: 'stylometryWeights.punctuation', value: localWeights.punctuation },
            { key: 'stylometryWeights.vocabulary', value: localWeights.vocabulary },
            { key: 'stylometryWeights.functionWords', value: localWeights.functionWords },
            { key: 'stylometryWeights.syntactic', value: localWeights.syntactic },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? 'Failed to save weights');
      }

      await fetchThresholds();
      setIsEditingWeights(false);
    } catch (err) {
      setWeightsError(err instanceof Error ? err.message : 'Failed to save weights');
    } finally {
      setWeightsSaving(false);
    }
  };

  const handleExport = async (format: 'json' | 'csv'): Promise<void> => {
    try {
      const response = await fetch(`/api/export?format=${format}`);
      if (!response.ok) {
        throw new Error('Failed to export data');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-social-engine-export.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export data');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading settings...</div>
      </div>
    );
  }

  if (!data || !localSettings) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
        <p className="text-red-400">Failed to load settings: {error}</p>
      </div>
    );
  }

  const prefs = data.notificationPreferences.enabledTypes;
  const hasChanges =
    localSettings.notificationVerbosity !== data.notificationVerbosity ||
    localSettings.notifyContentReady !== prefs.content_ready ||
    localSettings.notifyTimeSensitive !== prefs.time_sensitive ||
    localSettings.notifyAgentStuck !== prefs.agent_stuck ||
    localSettings.notifyBudgetWarning !== prefs.budget_warning ||
    localSettings.anthropicDailyUsd !== data.budgetLimits.anthropicDailyUsd ||
    localSettings.anthropicMonthlyUsd !== data.budgetLimits.anthropicMonthlyUsd ||
    localSettings.apifyMonthlyUsd !== data.budgetLimits.apifyMonthlyUsd ||
    localSettings.smaugEnabled !== data.dataSourceConfig.smaugEnabled ||
    localSettings.smaugPollIntervalMinutes !== data.dataSourceConfig.smaugPollIntervalMinutes ||
    localSettings.apifyEnabled !== data.dataSourceConfig.apifyEnabled ||
    localSettings.apifyTier1IntervalMinutes !== data.dataSourceConfig.apifyTier1IntervalMinutes ||
    localSettings.apifyTier2IntervalMinutes !== data.dataSourceConfig.apifyTier2IntervalMinutes ||
    localSettings.autoHumanize !== data.humanizerSettings.autoHumanize;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Settings</h1>
          <p className="text-sm text-gray-400 mt-1">Configure your AI Social Engine preferences</p>
        </div>
        {hasChanges && (
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      {error !== null && (
        <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {saveSuccess && (
        <div className="rounded-lg bg-green-900/20 border border-green-500/50 p-4">
          <p className="text-green-400 text-sm">Settings saved successfully</p>
        </div>
      )}

      <Section
        title="Notification Preferences"
        description="Control Discord notification verbosity and which types to receive"
      >
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-3">Verbosity Level</h3>
            <div className="space-y-3">
              {VERBOSITY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start p-3 rounded-lg border cursor-pointer transition-colors ${
                    localSettings.notificationVerbosity === option.value
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="verbosity"
                    value={option.value}
                    checked={localSettings.notificationVerbosity === option.value}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        notificationVerbosity: e.target.value as NotificationVerbosity,
                      })
                    }
                    className="mt-0.5 mr-3"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-200">{option.label}</span>
                    <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-700 pt-6">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Notification Types</h3>
            <p className="text-xs text-gray-500 mb-4">
              Choose which types of notifications to receive
            </p>
            <div className="space-y-3">
              {NOTIFICATION_TYPE_OPTIONS.map((option) => {
                const settingKey = `notify${option.key
                  .split('_')
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join('')}` as
                  | 'notifyContentReady'
                  | 'notifyTimeSensitive'
                  | 'notifyAgentStuck'
                  | 'notifyBudgetWarning';
                return (
                  <div
                    key={option.key}
                    className="flex items-center justify-between p-3 rounded-lg bg-gray-900 border border-gray-700"
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-200">{option.label}</span>
                      <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={localSettings[settingKey]}
                        onChange={(e) =>
                          setLocalSettings({ ...localSettings, [settingKey]: e.target.checked })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Content Generation"
        description="Configure how generated content is processed"
      >
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-200">
                Auto-humanize Generated Content
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                Automatically apply humanizer patterns to remove AI-sounding phrases from generated
                posts
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.autoHumanize}
                onChange={(e) =>
                  setLocalSettings({ ...localSettings, autoHumanize: e.target.checked })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
          <p className="text-xs text-gray-600 mt-3">
            When enabled, the 24-pattern humanizer will automatically rewrite AI-typical phrases
            like &quot;delve&quot;, &quot;it&apos;s important to note&quot;, and other patterns
            detected by the humanizer pipeline.
          </p>
        </div>
      </Section>

      <Section
        title="Autonomous Scheduler"
        description="Configure automatic content generation at scheduled intervals"
      >
        <SchedulerSettings />
      </Section>

      <Section
        title="Data Source Configuration"
        description="Configure data ingestion from Smaug and Apify"
      >
        <div className="space-y-6">
          <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm font-medium text-gray-200">Smaug (Likes & Bookmarks)</span>
                <p className="text-xs text-gray-500">Polls your Twitter likes and bookmarks</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.smaugEnabled}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, smaugEnabled: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            {localSettings.smaugEnabled && (
              <div className="mt-3">
                <label className="text-xs text-gray-500">Poll Interval (minutes)</label>
                <input
                  type="number"
                  value={localSettings.smaugPollIntervalMinutes}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      smaugPollIntervalMinutes: parseInt(e.target.value) || 5,
                    })
                  }
                  min={1}
                  max={60}
                  className="mt-1 w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm font-medium text-gray-200">Apify (Account Scraping)</span>
                <p className="text-xs text-gray-500">Scrapes tweets from curated accounts</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.apifyEnabled}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, apifyEnabled: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            {localSettings.apifyEnabled && (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Tier 1 Interval (minutes)</label>
                  <input
                    type="number"
                    value={localSettings.apifyTier1IntervalMinutes}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        apifyTier1IntervalMinutes: parseInt(e.target.value) || 30,
                      })
                    }
                    min={15}
                    max={180}
                    className="mt-1 w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Tier 2 Interval (minutes)</label>
                  <input
                    type="number"
                    value={localSettings.apifyTier2IntervalMinutes}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        apifyTier2IntervalMinutes: parseInt(e.target.value) || 120,
                      })
                    }
                    min={60}
                    max={480}
                    className="mt-1 w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="API Cost Limits"
        description="Monitor usage and set budget caps to prevent overspending"
      >
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setIsEditingBudget(!isEditingBudget)}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              {isEditingBudget ? 'Cancel' : 'Edit Limits'}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {data.budgetStatus.map((status) => {
              const limitKey =
                status.apiName === 'anthropic'
                  ? status.period === 'daily'
                    ? 'anthropicDailyUsd'
                    : 'anthropicMonthlyUsd'
                  : 'apifyMonthlyUsd';

              return (
                <BudgetCard
                  key={`${status.apiName}-${status.period}`}
                  status={status}
                  limit={localSettings[limitKey]}
                  onLimitChange={(value) =>
                    setLocalSettings({ ...localSettings, [limitKey]: value })
                  }
                  isEditing={isEditingBudget}
                />
              );
            })}
          </div>

          {data.budgetStatus.some((s) => getBudgetPercentage(s.used, s.limit) >= 80) && (
            <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-500/50">
              <p className="text-sm text-yellow-400">
                Warning: Some budgets are nearing their limits. Consider increasing limits or
                reducing usage.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Validation Thresholds"
        description="View current validation thresholds for voice, slop, and stylometry checks"
      >
        {thresholdsLoading ? (
          <div className="text-sm text-gray-400">Loading thresholds...</div>
        ) : thresholds === null ? (
          <div className="text-sm text-gray-500">Unable to fetch thresholds</div>
        ) : (
          <div className="space-y-4">
            {thresholdsErrors.length > 0 && (
              <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-500/50">
                <p className="text-sm text-yellow-400 mb-2">Threshold validation warnings:</p>
                <ul className="text-xs text-yellow-300 list-disc list-inside">
                  {thresholdsErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
                <h4 className="text-sm font-medium text-gray-200 mb-3">Voice Validation</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Similarity Threshold</span>
                    <span className="text-gray-300">{thresholds.voice.similarity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Min Confidence</span>
                    <span className="text-gray-300">{thresholds.voice.minConfidence}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Min Dimension Score</span>
                    <span className="text-gray-300">{thresholds.voice.minDimensionScore}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Contrast Threshold</span>
                    <span className="text-gray-300">{thresholds.voice.contrastThreshold}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
                <h4 className="text-sm font-medium text-gray-200 mb-3">Slop Detection</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max Score</span>
                    <span className="text-gray-300">{thresholds.slop.maxScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Warning Score</span>
                    <span className="text-gray-300">{thresholds.slop.warningScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Semantic Threshold</span>
                    <span className="text-gray-300">{thresholds.slop.semanticThreshold}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
                <h4 className="text-sm font-medium text-gray-200 mb-3">Stylometry</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Similarity</span>
                    <span className="text-gray-300">{thresholds.stylometry.similarity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Min Dimensions</span>
                    <span className="text-gray-300">{thresholds.stylometry.minDimensions}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max Drift</span>
                    <span className="text-gray-300">{thresholds.stylometry.maxDrift}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
                <h4 className="text-sm font-medium text-gray-200 mb-3">Duplicate Detection</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Post Similarity</span>
                    <span className="text-gray-300">{thresholds.duplicate.postSimilarity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Source Similarity</span>
                    <span className="text-gray-300">{thresholds.duplicate.sourceSimilarity}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
              <h4 className="text-sm font-medium text-gray-200 mb-3">Learning System</h4>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Stuck Base Threshold</span>
                  <span className="text-gray-300">
                    {thresholds.learning.stuckBaseThreshold} rejections
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pattern Similarity</span>
                  <span className="text-gray-300">{thresholds.learning.patternSimilarity}</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-200">Stylometry Dimension Weights</h4>
                {!isEditingWeights ? (
                  <button
                    onClick={() => setIsEditingWeights(true)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Edit Weights
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setIsEditingWeights(false);
                        setWeightsError(null);
                        if (thresholds !== null) {
                          setLocalWeights({
                            sentenceLength: thresholds.stylometryWeights.sentenceLength,
                            punctuation: thresholds.stylometryWeights.punctuation,
                            vocabulary: thresholds.stylometryWeights.vocabulary,
                            functionWords: thresholds.stylometryWeights.functionWords,
                            syntactic: thresholds.stylometryWeights.syntactic,
                          });
                        }
                      }}
                      className="text-xs text-gray-400 hover:text-gray-300"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleSaveWeights()}
                      disabled={weightsSaving}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                    >
                      {weightsSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Weights control how each dimension contributes to stylometric similarity. Must sum
                to 1.0.
              </p>
              {weightsError && (
                <div className="mb-3 p-2 rounded bg-red-900/20 border border-red-500/50">
                  <p className="text-xs text-red-400">{weightsError}</p>
                </div>
              )}
              {localWeights && (
                <div className="space-y-3">
                  {[
                    { key: 'sentenceLength', label: 'Sentence Length' },
                    { key: 'punctuation', label: 'Punctuation' },
                    { key: 'vocabulary', label: 'Vocabulary Richness' },
                    { key: 'functionWords', label: 'Function Words' },
                    { key: 'syntactic', label: 'Syntactic Complexity' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <span className="text-xs text-gray-500 flex-shrink-0 w-32">{label}</span>
                      {isEditingWeights ? (
                        <input
                          type="number"
                          value={localWeights[key as keyof typeof localWeights]}
                          onChange={(e) =>
                            setLocalWeights({
                              ...localWeights,
                              [key]: parseFloat(e.target.value) || 0,
                            })
                          }
                          min={0}
                          max={1}
                          step={0.05}
                          className="w-20 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                        />
                      ) : (
                        <span className="text-xs text-gray-300">
                          {localWeights[key as keyof typeof localWeights]}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="pt-2 border-t border-gray-700 flex justify-between">
                    <span className="text-xs text-gray-500 font-medium">Total</span>
                    <span
                      className={`text-xs font-medium ${
                        Math.abs(
                          localWeights.sentenceLength +
                            localWeights.punctuation +
                            localWeights.vocabulary +
                            localWeights.functionWords +
                            localWeights.syntactic -
                            1.0
                        ) > 0.01
                          ? 'text-red-400'
                          : 'text-green-400'
                      }`}
                    >
                      {(
                        localWeights.sentenceLength +
                        localWeights.punctuation +
                        localWeights.vocabulary +
                        localWeights.functionWords +
                        localWeights.syntactic
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Configure via environment variables or edit weights above. See README for details.
              </p>
              <button
                onClick={() => void fetchThresholds()}
                className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
                title="Refresh thresholds"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Twitter Account"
        description="Connect your Twitter account for performance tracking"
      >
        <TwitterAccountSettings />
      </Section>

      <Section title="Export Data" description="Download your data for backup or analysis">
        <div className="flex gap-4">
          <button
            onClick={() => void handleExport('json')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export JSON
          </button>
          <button
            onClick={() => void handleExport('csv')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export CSV
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Includes posts, feedback, patterns, and cost history
        </p>
      </Section>

      <Section
        title="LLM Provider Status"
        description="Monitor the availability of AI model providers"
      >
        {llmHealthLoading ? (
          <div className="text-sm text-gray-400">Checking provider status...</div>
        ) : llmHealth === null ? (
          <div className="text-sm text-gray-500">Unable to fetch provider status</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(llmHealth.status)}`} />
              <span className={`text-sm font-medium ${getStatusTextColor(llmHealth.status)}`}>
                {llmHealth.status === 'healthy'
                  ? 'All Systems Operational'
                  : llmHealth.status === 'degraded'
                    ? 'Degraded Performance'
                    : 'Service Unavailable'}
              </span>
              <button
                onClick={() => void fetchLLMHealth()}
                className="ml-auto text-xs text-gray-500 hover:text-gray-300"
                title="Refresh status"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>

            {llmHealth.gatewayEnabled && (
              <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-300">LiteLLM Gateway</span>
                    <span className="text-xs text-gray-500">({llmHealth.gatewayUrl})</span>
                  </div>
                  {llmHealth.gatewayReachable ? (
                    <span className="text-xs text-green-400">Connected</span>
                  ) : (
                    <span className="text-xs text-red-400">Unreachable</span>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {llmHealth.providers.map((provider) => (
                <div
                  key={provider.name}
                  className="p-4 rounded-lg bg-gray-900 border border-gray-700"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getProviderStatusIcon(provider.available)}
                      <span className="text-sm font-medium text-gray-200 capitalize">
                        {provider.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {provider.configuredViaEnv ? (
                        <span className="text-xs text-gray-500">API key configured</span>
                      ) : (
                        <span className="text-xs text-yellow-500">No API key</span>
                      )}
                    </div>
                  </div>
                  {provider.models.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {provider.models.map((model) => (
                        <span
                          key={model}
                          className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-400 border border-gray-700"
                        >
                          {model}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-500">
              Last checked: {new Date(llmHealth.timestamp).toLocaleString()}
            </p>
          </div>
        )}
      </Section>

      <Section
        title="Python Worker Status (Optional)"
        description="Optional Python workers provide advanced features. Basic content generation works without them."
      >
        {workerStatusLoading ? (
          <div className="text-sm text-gray-400">Checking worker status...</div>
        ) : workerStatus === null ? (
          <div className="text-sm text-gray-500">Unable to fetch worker status</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${getWorkerStatusColor(workerStatus.overall)}`}
              />
              <span
                className={`text-sm font-medium ${getWorkerStatusTextColor(workerStatus.overall)}`}
              >
                {workerStatus.overall === 'healthy'
                  ? 'All Workers Operational'
                  : workerStatus.overall === 'degraded'
                    ? 'Some Workers Unavailable'
                    : 'Workers Offline (Optional)'}
              </span>
              <button
                onClick={() => void fetchWorkerStatus()}
                className="ml-auto text-xs text-gray-500 hover:text-gray-300"
                title="Refresh status"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>

            {workerStatus.overall === 'unavailable' && (
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-700">
                <p className="text-sm text-gray-400 mb-2">
                  Python workers are optional and provide advanced features like multi-provider LLM
                  fallback and Python-based stylometry. Basic content generation works without them.
                </p>
                <p className="text-xs text-gray-500">
                  To enable:{' '}
                  <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-400">
                    docker compose up -d
                  </code>
                </p>
              </div>
            )}

            <div className="space-y-3">
              {(['litellm', 'langgraph', 'stylometry'] as const).map((service) => {
                const workerHealth = workerStatus[service];
                const isAvailable = workerStatus.availableServices.includes(service);
                const url = workerStatus.urls[service];

                return (
                  <div key={service} className="p-4 rounded-lg bg-gray-900 border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getProviderStatusIcon(isAvailable)}
                        <span className="text-sm font-medium text-gray-200">
                          {getWorkerDisplayName(service)}
                        </span>
                        <span className="text-xs text-gray-500">
                          (port {getWorkerPort(service)})
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isAvailable && workerHealth ? (
                          <span
                            className={`text-xs ${getWorkerStatusTextColor(workerHealth.status)}`}
                          >
                            {workerHealth.status === 'healthy'
                              ? 'Healthy'
                              : workerHealth.status === 'degraded'
                                ? 'Degraded'
                                : 'Down'}
                          </span>
                        ) : (
                          <span className="text-xs text-red-400">Unavailable</span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-gray-500 mb-2">{getWorkerDescription(service)}</p>

                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <span>URL:</span>
                      <code className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{url}</code>
                    </div>

                    {isAvailable && workerHealth && (
                      <div className="mt-3 pt-3 border-t border-gray-700">
                        <div className="flex flex-wrap gap-3 text-xs">
                          <span className="text-gray-500">
                            Version: <span className="text-gray-400">{workerHealth.version}</span>
                          </span>
                          <span className="text-gray-500">
                            Uptime:{' '}
                            <span className="text-gray-400">
                              {Math.floor(workerHealth.uptime_seconds / 60)}m
                            </span>
                          </span>
                          {workerHealth.dependencies.length > 0 && (
                            <span className="text-gray-500">
                              Dependencies:{' '}
                              {workerHealth.dependencies.map((dep, idx) => (
                                <span key={dep.name}>
                                  <span
                                    className={
                                      dep.status === 'healthy'
                                        ? 'text-green-400'
                                        : dep.status === 'degraded'
                                          ? 'text-yellow-400'
                                          : 'text-red-400'
                                    }
                                  >
                                    {dep.name}
                                  </span>
                                  {idx < workerHealth.dependencies.length - 1 && ', '}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {workerStatus.availableServices.length === 0 && (
              <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-500/50">
                <p className="text-sm text-yellow-400 mb-2">
                  No Python workers are running. Start them with:
                </p>
                <code className="block px-3 py-2 text-xs rounded bg-gray-900 text-gray-300">
                  docker compose up -d
                </code>
              </div>
            )}

            <p className="text-xs text-gray-500">
              Last checked: {new Date(workerStatus.timestamp).toLocaleString()}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
