'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

interface DashboardConfigStatus {
  voiceGuidelines: { configured: boolean; count: number };
  goldExamples: { configured: boolean; count: number; sufficient: boolean };
  accounts: { configured: boolean; count: number };
  llm: { configured: boolean; provider: string | null };
  qdrant: { available: boolean; collections: string[] };
  formulas: { configured: boolean; activeCount: number };
  discord: { configured: boolean };
  isReady: boolean;
}

interface ConfigStatusPanelProps {
  pollInterval?: number;
  compact?: boolean;
}

interface GoldExample {
  id: string;
  text: string;
  createdAt: string;
}

interface Formula {
  id: number;
  name: string;
  template: string;
  active: boolean;
  usageCount: number;
  successRate: number;
}

type ModalType = 'voiceGuidelines' | 'goldExamples' | 'formulas' | 'qdrant' | 'discord' | null;

interface ConfigItemProps {
  name: string;
  configured: boolean;
  details: string;
  required?: boolean;
  isSetupItem?: boolean;
  onClick?: () => void;
  clickable?: boolean;
}

function ConfigItem({
  name,
  configured,
  details,
  required,
  isSetupItem,
  onClick,
  clickable = false,
}: ConfigItemProps): React.ReactElement {
  const content = (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            configured ? 'bg-green-500' : required === true ? 'bg-red-500' : 'bg-gray-500'
          }`}
        />
        <span className="text-sm text-gray-300">{name}</span>
        {required === true && !configured && (
          <span className="text-xs text-red-400 px-1.5 py-0.5 rounded bg-red-500/10">Required</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-xs ${configured ? 'text-green-400' : 'text-gray-500'}`}>
          {details}
        </span>
        {clickable && <span className="text-xs text-blue-400">View →</span>}
        {!configured && isSetupItem === true && !clickable && (
          <span className="text-xs text-blue-400">→</span>
        )}
      </div>
    </div>
  );

  // Clickable item
  if (clickable && onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full text-left hover:bg-gray-700/50 -mx-1 px-1 rounded transition-colors"
      >
        {content}
      </button>
    );
  }

  // Link incomplete setup items to /config
  if (!configured && isSetupItem === true) {
    return (
      <a href="/config" className="block hover:bg-gray-700/50 -mx-1 px-1 rounded transition-colors">
        {content}
      </a>
    );
  }

  return content;
}

// Modal Component
function Modal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-800 border border-gray-700 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// Voice Guidelines Modal Content
function VoiceGuidelinesModalContent(): React.ReactElement {
  const [guidelines, setGuidelines] = useState<{
    dos: string[];
    donts: string[];
    examples: string[];
    rules: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/bootstrap/voice-guidelines')
      .then((res) => res.json())
      .then((data: { guidelines: typeof guidelines }) => {
        setGuidelines(data.guidelines);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400">Loading...</div>;
  if (!guidelines) return <div className="text-gray-400">Failed to load guidelines</div>;

  const sections = [
    { title: "DO's", items: guidelines.dos, color: 'text-green-400' },
    { title: "DON'Ts", items: guidelines.donts, color: 'text-red-400' },
    { title: 'Examples', items: guidelines.examples, color: 'text-blue-400' },
    { title: 'Rules', items: guidelines.rules, color: 'text-yellow-400' },
  ];

  const total =
    guidelines.dos.length +
    guidelines.donts.length +
    guidelines.examples.length +
    guidelines.rules.length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">{total} guidelines loaded</p>
      {sections.map((section) =>
        section.items.length > 0 ? (
          <div key={section.title}>
            <h4 className={`text-sm font-medium ${section.color} mb-2`}>
              {section.title} ({section.items.length})
            </h4>
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {section.items.map((item, i) => (
                <li key={i} className="text-xs text-gray-300 pl-3 border-l border-gray-700">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null
      )}
      <a
        href="/config?tab=voice"
        className="block text-center text-sm text-blue-400 hover:text-blue-300 mt-4"
      >
        Edit Voice Guidelines →
      </a>
    </div>
  );
}

// Gold Examples Modal Content
function GoldExamplesModalContent(): React.ReactElement {
  const [examples, setExamples] = useState<GoldExample[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/bootstrap/gold-examples')
      .then((res) => res.json())
      .then((data: { examples?: GoldExample[]; total?: number }) => {
        setExamples(data.examples ?? []);
        setTotal(data.total ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {total} gold examples {total >= 50 ? '(optimal)' : total >= 20 ? '(good)' : '(need more)'}
        </p>
        <span
          className={`text-xs px-2 py-1 rounded ${
            total >= 50
              ? 'bg-green-500/20 text-green-400'
              : total >= 20
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-red-500/20 text-red-400'
          }`}
        >
          {total >= 50 ? '50+ recommended ✓' : `${total}/50+ recommended`}
        </span>
      </div>
      {examples.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No gold examples yet</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {examples.map((example) => (
            <div key={example.id} className="p-3 rounded-lg bg-gray-900 border border-gray-700">
              <p className="text-sm text-gray-300 line-clamp-2">{example.text}</p>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(example.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
      <a
        href="/config?tab=examples"
        className="block text-center text-sm text-blue-400 hover:text-blue-300 mt-4"
      >
        Manage Gold Examples →
      </a>
    </div>
  );
}

// Formulas Modal Content
function FormulasModalContent(): React.ReactElement {
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);

  const fetchFormulas = useCallback(() => {
    fetch('/api/formulas')
      .then((res) => res.json())
      .then((data: { formulas?: Formula[] }) => {
        setFormulas(data.formulas ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchFormulas();
  }, [fetchFormulas]);

  const toggleFormula = async (id: number, active: boolean): Promise<void> => {
    setToggling(id);
    try {
      await fetch(`/api/formulas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      fetchFormulas();
    } catch {
      // Silent fail
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <div className="text-gray-400">Loading...</div>;

  const activeCount = formulas.filter((f) => f.active).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        {formulas.length} formulas ({activeCount} active)
      </p>
      {formulas.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No formulas configured</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {formulas.map((formula) => (
            <div
              key={formula.id}
              className={`p-3 rounded-lg border ${
                formula.active
                  ? 'bg-gray-900 border-green-500/30'
                  : 'bg-gray-900/50 border-gray-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-200">{formula.name}</span>
                <button
                  onClick={() => void toggleFormula(formula.id, !formula.active)}
                  disabled={toggling === formula.id}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    formula.active
                      ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  {toggling === formula.id ? '...' : formula.active ? 'Active' : 'Inactive'}
                </button>
              </div>
              <p className="text-xs text-gray-500 line-clamp-1">{formula.template}</p>
              <div className="flex gap-3 mt-1 text-xs text-gray-500">
                <span>Used: {formula.usageCount}x</span>
                <span>Success: {(formula.successRate * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Qdrant Modal Content
function QdrantModalContent({ collections }: { collections: string[] }): React.ReactElement {
  const [collectionInfo, setCollectionInfo] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/bootstrap/voice-guidelines').then((res) => res.json()) as Promise<{
        counts?: { total?: number };
      }>,
      fetch('/api/bootstrap/gold-examples').then((res) => res.json()) as Promise<{
        total?: number;
      }>,
    ])
      .then(([guidelines, examples]) => {
        const info: { name: string; count: number }[] = [];
        if (collections.includes('voice_guidelines')) {
          info.push({ name: 'voice_guidelines', count: guidelines.counts?.total ?? 0 });
        }
        if (collections.includes('approved_posts')) {
          info.push({ name: 'approved_posts', count: examples.total ?? 0 });
        }
        setCollectionInfo(info);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [collections]);

  if (loading) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">{collections.length} collections</p>
      <div className="space-y-2">
        {collectionInfo.map((col) => (
          <div
            key={col.name}
            className="p-3 rounded-lg bg-gray-900 border border-gray-700 flex justify-between"
          >
            <span className="text-sm text-gray-300">{col.name}</span>
            <span className="text-sm text-gray-400">{col.count} documents</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Discord Modal Content
function DiscordModalContent({ configured }: { configured: boolean }): React.ReactElement {
  const [webhookInfo, setWebhookInfo] = useState<{
    configured: boolean;
    masked: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch('/api/bootstrap/api-keys')
      .then((res) => res.json())
      .then((data: { discord?: { configured: boolean; masked: string | null } }) => {
        setWebhookInfo(data.discord ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const testWebhook = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'content_ready' }),
      });
      const data = (await res.json()) as { error?: string };
      setTestResult({
        success: res.ok,
        message: res.ok ? 'Test notification sent!' : (data.error ?? 'Test failed'),
      });
    } catch {
      setTestResult({ success: false, message: 'Failed to send test' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${configured ? 'bg-green-500' : 'bg-gray-500'}`} />
        <span className="text-sm text-gray-300">
          {configured ? 'Webhook Configured' : 'Not Configured'}
        </span>
      </div>

      {webhookInfo?.masked && (
        <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
          <p className="text-xs text-gray-500 mb-1">Webhook URL (masked)</p>
          <code className="text-sm text-gray-300">{webhookInfo.masked}</code>
        </div>
      )}

      {configured && (
        <div className="flex gap-2">
          <button
            onClick={() => void testWebhook()}
            disabled={testing}
            className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Webhook'}
          </button>
        </div>
      )}

      {testResult && (
        <div
          className={`p-3 rounded-lg ${
            testResult.success
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          <p className="text-sm">{testResult.message}</p>
        </div>
      )}

      <a
        href="/config?tab=integrations"
        className="block text-center text-sm text-blue-400 hover:text-blue-300 mt-4"
      >
        {configured ? 'Update Webhook →' : 'Configure Webhook →'}
      </a>
    </div>
  );
}

export function ConfigStatusPanel({
  pollInterval = 60000,
  compact = false,
}: ConfigStatusPanelProps): React.ReactElement {
  const [status, setStatus] = useState<DashboardConfigStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const isMountedRef = useRef(true);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/config/status');

      if (!isMountedRef.current) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as DashboardConfigStatus;

      if (!isMountedRef.current) return;

      setStatus(data);
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch config status'));
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

    const interval = setInterval(() => {
      void fetchStatus();
    }, pollInterval);

    return (): void => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className={compact ? 'h-20 bg-gray-700 rounded-lg' : 'h-48 bg-gray-700 rounded-lg'} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-3">
        <p className="text-red-400 text-sm">Failed to load config status: {error.message}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4 text-center">
        <p className="text-gray-400 text-sm">No config status available</p>
      </div>
    );
  }

  if (compact) {
    return <CompactView status={status} />;
  }

  return (
    <>
      <FullView status={status} onOpenModal={setActiveModal} />

      <Modal
        isOpen={activeModal === 'voiceGuidelines'}
        onClose={() => setActiveModal(null)}
        title="Voice Guidelines"
      >
        <VoiceGuidelinesModalContent />
      </Modal>

      <Modal
        isOpen={activeModal === 'goldExamples'}
        onClose={() => setActiveModal(null)}
        title="Gold Examples"
      >
        <GoldExamplesModalContent />
      </Modal>

      <Modal
        isOpen={activeModal === 'formulas'}
        onClose={() => setActiveModal(null)}
        title="Content Formulas"
      >
        <FormulasModalContent />
      </Modal>

      <Modal
        isOpen={activeModal === 'qdrant'}
        onClose={() => setActiveModal(null)}
        title="Vector Database (Qdrant)"
      >
        <QdrantModalContent collections={status.qdrant.collections} />
      </Modal>

      <Modal
        isOpen={activeModal === 'discord'}
        onClose={() => setActiveModal(null)}
        title="Discord Webhook"
      >
        <DiscordModalContent configured={status.discord.configured} />
      </Modal>
    </>
  );
}

function CompactView({ status }: { status: DashboardConfigStatus }): React.ReactElement {
  const configuredCount = [
    status.voiceGuidelines.configured,
    status.llm.configured,
    status.formulas.configured,
  ].filter(Boolean).length;
  const totalRequired = 3;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-gray-800/50 border border-gray-700">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center ring-4 ${
          status.isReady ? 'bg-green-500 ring-green-500/30' : 'bg-yellow-500 ring-yellow-500/30'
        }`}
      >
        <span className="text-sm font-bold text-white">
          {configuredCount}/{totalRequired}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${status.isReady ? 'text-green-400' : 'text-yellow-400'}`}
          >
            {status.isReady ? 'System Ready' : 'Setup Incomplete'}
          </span>
        </div>
        <p className="text-xs text-gray-500 truncate">
          {status.isReady
            ? 'All required configuration complete'
            : `${totalRequired - configuredCount} required item${totalRequired - configuredCount > 1 ? 's' : ''} missing`}
        </p>
      </div>
      <a href="/config" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
        Configure →
      </a>
    </div>
  );
}

function FullView({
  status,
  onOpenModal,
}: {
  status: DashboardConfigStatus;
  onOpenModal: (modal: ModalType) => void;
}): React.ReactElement {
  // 4 core setup items: Voice Guidelines, Gold Examples, Curated Accounts, LLM Provider
  const setupItems = [
    { configured: status.voiceGuidelines.configured, name: 'Voice Guidelines' },
    { configured: status.goldExamples.configured, name: 'Gold Examples' },
    { configured: status.accounts.configured, name: 'Curated Accounts' },
    { configured: status.llm.configured, name: 'LLM Provider' },
  ];
  const configuredCount = setupItems.filter((item) => item.configured).length;
  const totalItems = setupItems.length;
  const progressPercent = (configuredCount / totalItems) * 100;

  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ring-4 ${
              status.isReady ? 'bg-green-500 ring-green-500/30' : 'bg-yellow-500 ring-yellow-500/30'
            }`}
          >
            <span className="text-sm font-bold text-white">
              {configuredCount}/{totalItems}
            </span>
          </div>
          <div>
            <span
              className={`text-sm font-medium ${status.isReady ? 'text-green-400' : 'text-yellow-400'}`}
            >
              {status.isReady ? 'System Ready' : 'Setup Incomplete'}
            </span>
            {!status.isReady && (
              <p className="text-xs text-gray-500">
                {totalItems - configuredCount} item{totalItems - configuredCount !== 1 ? 's' : ''}{' '}
                need configuration
              </p>
            )}
          </div>
        </div>
        {!status.isReady && (
          <a
            href="/config"
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            Complete Setup →
          </a>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              status.isReady ? 'bg-green-500' : 'bg-yellow-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="divide-y divide-gray-700">
        <ConfigItem
          name="Voice Guidelines"
          configured={status.voiceGuidelines.configured}
          details={
            status.voiceGuidelines.configured
              ? `${status.voiceGuidelines.count} loaded`
              : 'Not configured'
          }
          required
          isSetupItem
          clickable={status.voiceGuidelines.configured}
          onClick={() => onOpenModal('voiceGuidelines')}
        />
        <ConfigItem
          name="Gold Examples"
          configured={status.goldExamples.configured}
          details={
            status.goldExamples.count > 0
              ? `${status.goldExamples.count} examples${status.goldExamples.sufficient ? '' : ' (50+ recommended)'}`
              : 'Not configured'
          }
          isSetupItem
          clickable={status.goldExamples.count > 0}
          onClick={() => onOpenModal('goldExamples')}
        />
        <ConfigItem
          name="Curated Accounts"
          configured={status.accounts.configured}
          details={
            status.accounts.configured ? `${status.accounts.count} accounts` : 'Not configured'
          }
          isSetupItem
        />
        <ConfigItem
          name="LLM Provider"
          configured={status.llm.configured}
          details={status.llm.configured ? (status.llm.provider ?? 'Configured') : 'Not configured'}
          required
          isSetupItem
        />
        <ConfigItem
          name="Vector Database"
          configured={status.qdrant.available}
          details={
            status.qdrant.available
              ? `${status.qdrant.collections.length} collection${status.qdrant.collections.length !== 1 ? 's' : ''}`
              : 'Not available'
          }
          clickable={status.qdrant.available}
          onClick={() => onOpenModal('qdrant')}
        />
        <ConfigItem
          name="Formulas"
          configured={status.formulas.configured}
          details={
            status.formulas.configured ? `${status.formulas.activeCount} active` : 'None active'
          }
          required
          clickable
          onClick={() => onOpenModal('formulas')}
        />
        <ConfigItem
          name="Discord Webhook"
          configured={status.discord.configured}
          details={status.discord.configured ? 'Configured' : 'Not configured'}
          clickable
          onClick={() => onOpenModal('discord')}
        />
      </div>
    </div>
  );
}

export default ConfigStatusPanel;
