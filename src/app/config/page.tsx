'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

type TabKey = 'voice' | 'examples' | 'accounts' | 'formulas' | 'integrations';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'voice', label: 'Voice' },
  { key: 'examples', label: 'Examples' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'formulas', label: 'Formulas' },
  { key: 'integrations', label: 'Integrations' },
];

// =============================================
// Voice Guidelines Tab
// =============================================
interface ExistingGuidelines {
  hasGuidelines: boolean;
  guidelines: { dos: string[]; donts: string[]; examples: string[]; rules: string[] };
  counts: { dos: number; donts: number; examples: number; rules: number; total: number };
}

function VoiceTab(): React.ReactElement {
  const [guidelinesText, setGuidelinesText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [existing, setExisting] = useState<ExistingGuidelines | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchExisting = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/bootstrap/voice-guidelines');
      if (res.ok) setExisting((await res.json()) as ExistingGuidelines);
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchExisting();
  }, [fetchExisting]);

  const handleSubmit = async (): Promise<void> => {
    if (!guidelinesText.trim()) return;
    setIsUploading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/bootstrap/voice-guidelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: guidelinesText }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Failed to save');
      }
      setSuccess(true);
      setGuidelinesText('');
      await fetchExisting();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event): void => {
      const content = event.target?.result;
      if (typeof content === 'string') setGuidelinesText(content);
    };
    reader.readAsText(file);
  };

  const handleDelete = async (type: string, index: number): Promise<void> => {
    if (!existing) return;
    if (!confirm('Delete this guideline?')) return;
    try {
      const res = await fetch('/api/bootstrap/voice-guidelines', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, index }),
      });
      if (res.ok) {
        await fetchExisting();
      }
    } catch {
      /* ignore */
    }
  };

  if (isLoading) {
    return <div className="text-gray-400">Loading voice guidelines...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-white mb-2">Voice Guidelines</h2>
        <p className="text-gray-400 text-sm">
          Define how the AI should write content. Include DOs, DONTs, example phrases, and tone
          instructions.
        </p>
      </div>

      {/* Existing Guidelines */}
      {existing?.hasGuidelines === true && (
        <div className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-200">
              Current Guidelines ({existing.counts.total} items)
            </span>
          </div>
          <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
            {(['rules', 'dos', 'donts', 'examples'] as const).map((type) => {
              const items = existing.guidelines[type];
              if (items.length === 0) return null;
              const labels: Record<string, { title: string; color: string }> = {
                rules: { title: 'Rules', color: 'text-yellow-400' },
                dos: { title: "DO's", color: 'text-green-400' },
                donts: { title: "DON'Ts", color: 'text-red-400' },
                examples: { title: 'Examples', color: 'text-blue-400' },
              };
              const { title, color } = labels[type];
              return (
                <div key={type}>
                  <h4 className={`text-sm font-medium ${color} mb-2`}>
                    {title} ({items.length})
                  </h4>
                  <div className="space-y-1">
                    {items.map((item, i) => (
                      <div
                        key={i}
                        className="flex items-start justify-between gap-2 p-2 rounded bg-gray-900 group"
                      >
                        <span className="text-xs text-gray-300 flex-1">{item}</span>
                        <button
                          onClick={() => void handleDelete(type, i)}
                          className="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add New Guidelines */}
      <div className="rounded-lg bg-gray-800 border border-gray-700 p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-200">
          {existing?.hasGuidelines === true ? 'Replace Guidelines' : 'Add Guidelines'}
        </h3>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Upload Markdown File
          </label>
          <input
            type="file"
            accept=".md,.txt"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer"
          />
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-gray-800 px-2 text-gray-500">or paste content</span>
          </div>
        </div>

        <textarea
          value={guidelinesText}
          onChange={(e) => setGuidelinesText(e.target.value)}
          rows={10}
          placeholder={`# Voice Guidelines

## DO's
- Start with the problem/pain point
- Use direct "you" language

## DON'Ts
- Don't use hashtags
- Don't start with "Let's dive in"

## Examples
...`}
          className="w-full px-4 py-3 text-sm bg-gray-900 border border-gray-600 rounded-lg text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono"
        />

        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/50">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {success && (
          <div className="p-3 rounded-lg bg-green-900/20 border border-green-500/50">
            <p className="text-green-400 text-sm">Voice guidelines saved!</p>
          </div>
        )}

        <button
          onClick={() => void handleSubmit()}
          disabled={!guidelinesText.trim() || isUploading}
          className="w-full py-3 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? 'Saving...' : 'Save Voice Guidelines'}
        </button>
      </div>
    </div>
  );
}

// =============================================
// Gold Examples Tab
// =============================================
interface GoldExample {
  id: string;
  text: string;
  createdAt: string;
}

interface ExistingExamples {
  examples: GoldExample[];
  count: number;
  total: number;
}

function ExamplesTab(): React.ReactElement {
  const [examplesText, setExamplesText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [existing, setExisting] = useState<ExistingExamples | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchExisting = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/bootstrap/gold-examples');
      if (res.ok) setExisting((await res.json()) as ExistingExamples);
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchExisting();
  }, [fetchExisting]);

  const handleSubmit = async (): Promise<void> => {
    const examples = examplesText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    if (examples.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/bootstrap/gold-examples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examples }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Failed to add');
      }
      const result = (await res.json()) as { added: number };
      setAddedCount((prev) => prev + result.added);
      setExamplesText('');
      await fetchExisting();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete this example?')) return;
    try {
      const res = await fetch(`/api/bootstrap/gold-examples?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchExisting();
      }
    } catch {
      /* ignore */
    }
  };

  if (isLoading) {
    return <div className="text-gray-400">Loading gold examples...</div>;
  }

  const currentCount = existing?.total ?? 0;
  const targetCount = 50;
  const progress = Math.min(100, (currentCount / targetCount) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-white mb-2">Gold Examples</h2>
        <p className="text-gray-400 text-sm">
          Add example posts that represent your authentic voice. These help the AI understand your
          style and maintain consistency.
        </p>
      </div>

      {/* Progress */}
      <div className="p-4 rounded-lg bg-gray-800 border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-300">Progress</span>
          <span className="text-sm font-medium text-gray-200">
            {currentCount} / {targetCount}+
          </span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${progress >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {currentCount >= 50 && (
          <p className="text-xs text-green-400 mt-2">Optimal corpus size reached!</p>
        )}
        {currentCount >= 20 && currentCount < 50 && (
          <p className="text-xs text-yellow-400 mt-2">Good start! Add more for better results.</p>
        )}
      </div>

      {/* Existing Examples */}
      {existing && existing.total > 0 && (
        <div className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700">
            <span className="text-sm font-medium text-gray-200">
              Gold Examples ({existing.total})
            </span>
          </div>
          <div className="divide-y divide-gray-700 max-h-80 overflow-y-auto">
            {existing.examples.map((example) => (
              <div key={example.id} className="p-3 flex items-start gap-3 group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-300 line-clamp-2">{example.text}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(example.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => void handleDelete(example.id)}
                  className="text-red-400 hover:text-red-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Examples */}
      <div className="rounded-lg bg-gray-800 border border-gray-700 p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-200">Add Examples</h3>

        {addedCount > 0 && (
          <div className="p-3 rounded-lg bg-green-900/20 border border-green-500/50">
            <p className="text-green-400 text-sm">Added {addedCount} examples this session!</p>
          </div>
        )}

        <textarea
          value={examplesText}
          onChange={(e) => setExamplesText(e.target.value)}
          rows={8}
          placeholder={`Paste your best tweets here, one per line.

Example:
You're probably still using console.log() for debugging. Try the debugger statement instead.

Most people skip this because they think it's complex. It's not.`}
          className="w-full px-4 py-3 text-sm bg-gray-900 border border-gray-600 rounded-lg text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />

        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/50">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <button
          onClick={() => void handleSubmit()}
          disabled={!examplesText.trim() || isSubmitting}
          className="w-full py-3 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Adding...' : 'Add Examples'}
        </button>
      </div>
    </div>
  );
}

// =============================================
// Accounts Tab
// =============================================
interface Account {
  id: number;
  handle: string;
  tier: 1 | 2;
  lastScraped: string | null;
}

interface AccountsResponse {
  accounts: Account[];
  total: number;
}

function AccountsTab(): React.ReactElement {
  const [accountsText, setAccountsText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [existing, setExisting] = useState<AccountsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTier, setEditingTier] = useState<number | null>(null);

  const fetchAccounts = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/bootstrap/accounts');
      if (res.ok) setExisting((await res.json()) as AccountsResponse);
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const handleSubmit = async (): Promise<void> => {
    const lines = accountsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    if (lines.length === 0) return;

    setIsSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/bootstrap/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: lines }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Failed to import');
      }
      const data = (await res.json()) as { added: number; skipped: number };
      setResult(data);
      setAccountsText('');
      await fetchAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    if (!confirm('Remove this account?')) return;
    try {
      const res = await fetch(`/api/bootstrap/accounts?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchAccounts();
      }
    } catch {
      /* ignore */
    }
  };

  const handleTierChange = async (id: number, tier: 1 | 2): Promise<void> => {
    setEditingTier(id);
    try {
      await fetch(`/api/bootstrap/accounts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, tier }),
      });
      await fetchAccounts();
    } catch {
      /* ignore */
    } finally {
      setEditingTier(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event): void => {
      const content = event.target?.result;
      if (typeof content === 'string') setAccountsText(content);
    };
    reader.readAsText(file);
  };

  if (isLoading) {
    return <div className="text-gray-400">Loading accounts...</div>;
  }

  const tier1Count = existing?.accounts.filter((a) => a.tier === 1).length ?? 0;
  const tier2Count = existing?.accounts.filter((a) => a.tier === 2).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-white mb-2">Curated Accounts</h2>
        <p className="text-gray-400 text-sm">
          Twitter accounts to follow for content inspiration. Tier 1 accounts are scraped more
          frequently.
        </p>
      </div>

      {/* Stats */}
      {existing && existing.total > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="p-3 rounded-lg bg-gray-800 border border-gray-700 text-center">
            <div className="text-2xl font-bold text-white">{existing.total}</div>
            <div className="text-xs text-gray-400">Total</div>
          </div>
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-center">
            <div className="text-2xl font-bold text-yellow-400">{tier1Count}</div>
            <div className="text-xs text-yellow-400">Tier 1</div>
          </div>
          <div className="p-3 rounded-lg bg-gray-800 border border-gray-700 text-center">
            <div className="text-2xl font-bold text-gray-400">{tier2Count}</div>
            <div className="text-xs text-gray-400">Tier 2</div>
          </div>
        </div>
      )}

      {/* Existing Accounts */}
      {existing && existing.total > 0 && (
        <div className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700">
            <span className="text-sm font-medium text-gray-200">Accounts ({existing.total})</span>
          </div>
          <div className="divide-y divide-gray-700 max-h-80 overflow-y-auto">
            {existing.accounts.map((account) => (
              <div key={account.id} className="p-3 flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-300">@{account.handle}</span>
                  <button
                    onClick={() => void handleTierChange(account.id, account.tier === 1 ? 2 : 1)}
                    disabled={editingTier === account.id}
                    className={`px-2 py-0.5 rounded text-xs ${
                      account.tier === 1
                        ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {editingTier === account.id ? '...' : `Tier ${account.tier}`}
                  </button>
                </div>
                <button
                  onClick={() => void handleDelete(account.id)}
                  className="text-red-400 hover:text-red-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Accounts */}
      <div className="rounded-lg bg-gray-800 border border-gray-700 p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-200">Import Accounts</h3>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Upload CSV File</label>
          <input
            type="file"
            accept=".csv,.txt"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer"
          />
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-gray-800 px-2 text-gray-500">or paste handles</span>
          </div>
        </div>

        <textarea
          value={accountsText}
          onChange={(e) => setAccountsText(e.target.value)}
          rows={6}
          placeholder={`# Format: handle,tier (tier optional, defaults to 2)
techinfluencer,1
startupfounder,1
devadvocate
airesearcher,1`}
          className="w-full px-4 py-3 text-sm bg-gray-900 border border-gray-600 rounded-lg text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono"
        />

        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/50">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {result && (
          <div className="p-3 rounded-lg bg-green-900/20 border border-green-500/50">
            <p className="text-green-400 text-sm">
              Added {result.added} accounts
              {result.skipped > 0 ? `, skipped ${result.skipped} duplicates` : ''}
            </p>
          </div>
        )}

        <button
          onClick={() => void handleSubmit()}
          disabled={!accountsText.trim() || isSubmitting}
          className="w-full py-3 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Importing...' : 'Import Accounts'}
        </button>
      </div>
    </div>
  );
}

// =============================================
// Formulas Tab
// =============================================
interface Formula {
  id: number;
  name: string;
  template: string;
  usageCount: number;
  successRate: number;
  active: boolean;
}

function FormulasTab(): React.ReactElement {
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', template: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', template: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFormulas = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/formulas');
      if (res.ok) {
        const data = (await res.json()) as { formulas: Formula[] };
        setFormulas(data.formulas);
      }
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFormulas();
  }, [fetchFormulas]);

  const toggleActive = async (id: number, active: boolean): Promise<void> => {
    try {
      await fetch(`/api/formulas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      await fetchFormulas();
    } catch {
      /* ignore */
    }
  };

  const startEdit = (formula: Formula): void => {
    setEditing(formula.id);
    setEditForm({ name: formula.name, template: formula.template });
  };

  const saveEdit = async (): Promise<void> => {
    if (editing === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/formulas/${editing}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error('Failed to save');
      setEditing(null);
      await fetchFormulas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const deleteFormula = async (id: number): Promise<void> => {
    if (!confirm('Delete this formula?')) return;
    try {
      await fetch(`/api/formulas/${id}`, { method: 'DELETE' });
      await fetchFormulas();
    } catch {
      /* ignore */
    }
  };

  const addFormula = async (): Promise<void> => {
    if (!addForm.name.trim() || !addForm.template.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/formulas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addForm.name, template: addForm.template, active: true }),
      });
      if (!res.ok) throw new Error('Failed to create');
      setAddForm({ name: '', template: '' });
      setShowAdd(false);
      await fetchFormulas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-gray-400">Loading formulas...</div>;
  }

  const activeCount = formulas.filter((f) => f.active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-medium text-white mb-2">Content Formulas</h2>
          <p className="text-gray-400 text-sm">
            Templates that guide how content is structured. At least one active formula is required.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
        >
          Add Formula
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-4">
        <div className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-700">
          <span className="text-sm text-gray-400">Total: </span>
          <span className="text-sm font-medium text-white">{formulas.length}</span>
        </div>
        <div
          className={`px-4 py-2 rounded-lg border ${
            activeCount > 0
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}
        >
          <span className="text-sm text-gray-400">Active: </span>
          <span
            className={`text-sm font-medium ${activeCount > 0 ? 'text-green-400' : 'text-red-400'}`}
          >
            {activeCount}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/50">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <div className="rounded-lg bg-gray-800 border border-blue-500 p-4 space-y-4">
          <h3 className="text-sm font-medium text-white">New Formula</h3>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={addForm.name}
              onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g., Problem-Solution"
              className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Template</label>
            <textarea
              value={addForm.template}
              onChange={(e) => setAddForm((p) => ({ ...p, template: e.target.value }))}
              rows={4}
              placeholder="Start with the problem. Then reveal the solution..."
              className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void addFormula()}
              disabled={saving || !addForm.name.trim() || !addForm.template.trim()}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Create'}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setAddForm({ name: '', template: '' });
              }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Formulas List */}
      <div className="space-y-3">
        {formulas.length === 0 ? (
          <div className="p-8 rounded-lg bg-gray-800 border border-gray-700 text-center">
            <p className="text-gray-400">No formulas configured yet.</p>
            <p className="text-sm text-gray-500 mt-1">Add your first formula to get started.</p>
          </div>
        ) : (
          formulas.map((formula) => (
            <div
              key={formula.id}
              className={`rounded-lg border ${
                formula.active
                  ? 'bg-gray-800 border-green-500/30'
                  : 'bg-gray-800/50 border-gray-700'
              }`}
            >
              {editing === formula.id ? (
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Name</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Template</label>
                    <textarea
                      value={editForm.template}
                      onChange={(e) => setEditForm((p) => ({ ...p, template: e.target.value }))}
                      rows={4}
                      className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void saveEdit()}
                      disabled={saving}
                      className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="px-3 py-1.5 text-sm text-gray-400 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-white">{formula.name}</h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void toggleActive(formula.id, !formula.active)}
                        className={`px-2 py-1 text-xs rounded ${
                          formula.active
                            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                        }`}
                      >
                        {formula.active ? 'Active' : 'Inactive'}
                      </button>
                      <button
                        onClick={() => startEdit(formula)}
                        className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void deleteFormula(formula.id)}
                        className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 line-clamp-2">{formula.template}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Used: {formula.usageCount}x</span>
                    <span>Success: {(formula.successRate * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// =============================================
// Integrations Tab
// =============================================
interface ApiKeysStatus {
  anthropic: { configured: boolean; masked: string | null };
  apify: { configured: boolean; masked: string | null };
  discord: { configured: boolean; masked: string | null };
}

function IntegrationsTab(): React.ReactElement {
  const [keysStatus, setKeysStatus] = useState<ApiKeysStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [apifyToken, setApifyToken] = useState('');
  const [discordWebhook, setDiscordWebhook] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/bootstrap/api-keys');
      if (res.ok) setKeysStatus((await res.json()) as ApiKeysStatus);
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const saveApiKeys = async (): Promise<void> => {
    setSaving('api');
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/bootstrap/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anthropicApiKey: anthropicKey || undefined,
          apifyApiToken: apifyToken || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSuccess('API keys saved!');
      setAnthropicKey('');
      setApifyToken('');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  const saveDiscord = async (): Promise<void> => {
    if (!discordWebhook.trim()) return;
    setSaving('discord');
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/bootstrap/discord-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: discordWebhook }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSuccess('Discord webhook saved!');
      setDiscordWebhook('');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

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

  if (isLoading) {
    return <div className="text-gray-400">Loading integrations...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-white mb-2">Integrations</h2>
        <p className="text-gray-400 text-sm">
          Configure API keys and external service connections.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/50">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-3 rounded-lg bg-green-900/20 border border-green-500/50">
          <p className="text-green-400 text-sm">{success}</p>
        </div>
      )}

      {/* API Keys Section */}
      <div className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700">
          <span className="text-sm font-medium text-gray-200">API Keys</span>
        </div>
        <div className="p-4 space-y-4">
          {/* Anthropic */}
          <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-200">Anthropic API</span>
              {keysStatus?.anthropic.configured === true ? (
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Configured
                </span>
              ) : (
                <span className="text-xs text-red-400">Required</span>
              )}
            </div>
            {keysStatus?.anthropic.masked != null && (
              <code className="block text-xs text-gray-500 mb-2">
                {keysStatus.anthropic.masked}
              </code>
            )}
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={
                keysStatus?.anthropic.configured === true
                  ? 'Leave empty to keep current'
                  : 'sk-ant-...'
              }
              className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Apify */}
          <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-200">Apify API</span>
              {keysStatus?.apify.configured === true ? (
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Configured
                </span>
              ) : (
                <span className="text-xs text-gray-500">Optional</span>
              )}
            </div>
            {keysStatus?.apify.masked != null && (
              <code className="block text-xs text-gray-500 mb-2">{keysStatus.apify.masked}</code>
            )}
            <input
              type="password"
              value={apifyToken}
              onChange={(e) => setApifyToken(e.target.value)}
              placeholder={
                keysStatus?.apify.configured === true
                  ? 'Leave empty to keep current'
                  : 'apify_api_...'
              }
              className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            onClick={() => void saveApiKeys()}
            disabled={saving === 'api' || (!anthropicKey && !apifyToken)}
            className="w-full py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
          >
            {saving === 'api' ? 'Saving...' : 'Save API Keys'}
          </button>
        </div>
      </div>

      {/* Discord Section */}
      <div className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700">
          <span className="text-sm font-medium text-gray-200">Discord Webhook</span>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${keysStatus?.discord.configured === true ? 'bg-green-500' : 'bg-gray-500'}`}
            />
            <span className="text-sm text-gray-300">
              {keysStatus?.discord.configured === true ? 'Webhook Configured' : 'Not Configured'}
            </span>
            {keysStatus?.discord.configured === true && (
              <button
                onClick={() => void testWebhook()}
                disabled={testing}
                className="ml-auto px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded"
              >
                {testing ? 'Testing...' : 'Test'}
              </button>
            )}
          </div>

          {keysStatus?.discord.masked != null && (
            <code className="block text-xs text-gray-500 p-2 rounded bg-gray-900">
              {keysStatus.discord.masked}
            </code>
          )}

          {testResult !== null && (
            <div
              className={`p-2 rounded text-sm ${
                testResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              }`}
            >
              {testResult.message}
            </div>
          )}

          <input
            type="url"
            value={discordWebhook}
            onChange={(e) => setDiscordWebhook(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />

          <p className="text-xs text-gray-500">
            Create webhook: Discord Server → Settings → Integrations → Webhooks → New Webhook
          </p>

          <button
            onClick={() => void saveDiscord()}
            disabled={saving === 'discord' || !discordWebhook.trim()}
            className="w-full py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
          >
            {saving === 'discord' ? 'Saving...' : 'Save Webhook'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================
// Main Config Page
// =============================================
function ConfigPageContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as TabKey) || 'voice';
  const [activeTab, setActiveTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? initialTab : 'voice'
  );

  const handleTabChange = (tab: TabKey): void => {
    setActiveTab(tab);
    router.push(`/config?tab=${tab}`, { scroll: false });
  };

  const renderTabContent = (): React.ReactElement => {
    switch (activeTab) {
      case 'voice':
        return <VoiceTab />;
      case 'examples':
        return <ExamplesTab />;
      case 'accounts':
        return <AccountsTab />;
      case 'formulas':
        return <FormulasTab />;
      case 'integrations':
        return <IntegrationsTab />;
      default:
        return <VoiceTab />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Configuration</h1>
        <p className="text-gray-400 mt-1">Manage your AI Social Engine settings</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700 mb-6">
        <nav className="flex gap-1" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.key ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">{renderTabContent()}</div>
    </div>
  );
}

export default function ConfigPage(): React.ReactElement {
  return (
    <Suspense fallback={<div className="text-gray-400">Loading configuration...</div>}>
      <ConfigPageContent />
    </Suspense>
  );
}
