'use client';

import { useState, useEffect, useCallback } from 'react';

interface TwitterAccountMasked {
  id: number;
  username: string;
  displayName: string | null;
  profileImageUrl: string | null;
  isPrimary: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  apiKeyMasked: string | null;
  apiSecretMasked: string | null;
  accessTokenMasked: string | null;
  accessSecretMasked: string | null;
  hasCredentials: boolean;
}

interface AccountResponse {
  account: TwitterAccountMasked | null;
  accounts?: TwitterAccountMasked[];
  encryptionConfigured: boolean;
}

interface TestResponse {
  success: boolean;
  configured: boolean;
  user?: { id: string; username: string; name: string };
  error?: string;
}

export function TwitterAccountSettings(): React.ReactElement {
  const [account, setAccount] = useState<TwitterAccountMasked | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [encryptionConfigured, setEncryptionConfigured] = useState(false);

  const [formData, setFormData] = useState({
    username: '',
    apiKey: '',
    apiSecret: '',
    accessToken: '',
    accessSecret: '',
  });

  const [showCredentials, setShowCredentials] = useState(false);

  const fetchAccount = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/twitter/account');
      if (!response.ok) throw new Error('Failed to fetch account');
      const data = (await response.json()) as AccountResponse;
      setAccount(data.account);
      setEncryptionConfigured(data.encryptionConfigured);
      if (data.account) {
        setFormData((prev) => ({
          ...prev,
          username: data.account?.username ?? '',
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch account');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccount();
  }, [fetchAccount]);

  const handleSave = async (): Promise<void> => {
    if (!formData.username) {
      setError('Username is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/twitter/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: account?.id,
          username: formData.username,
          apiKey: formData.apiKey || undefined,
          apiSecret: formData.apiSecret || undefined,
          accessToken: formData.accessToken || undefined,
          accessSecret: formData.accessSecret || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error: string };
        throw new Error(data.error);
      }

      await fetchAccount();
      setFormData((prev) => ({
        ...prev,
        apiKey: '',
        apiSecret: '',
        accessToken: '',
        accessSecret: '',
      }));
      setShowCredentials(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save account');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const response = await fetch('/api/twitter/test', { method: 'POST' });
      const data = (await response.json()) as TestResponse;
      setTestResult(data);
      if (!data.success && data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test connection');
    } finally {
      setIsTesting(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    if (!account) return;
    if (!confirm('Are you sure you want to disconnect this Twitter account?')) return;

    try {
      const response = await fetch(`/api/twitter/account?id=${account.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = (await response.json()) as { error: string };
        throw new Error(data.error);
      }
      setAccount(null);
      setFormData({
        username: '',
        apiKey: '',
        apiSecret: '',
        accessToken: '',
        accessSecret: '',
      });
      setTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading Twitter account settings...</div>;
  }

  return (
    <div className="space-y-4">
      {error !== null && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/50">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {!encryptionConfigured && (
        <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-500/50">
          <p className="text-sm text-yellow-400">
            Warning: CREDENTIALS_ENCRYPTION_KEY not set. Using default key. Set this in your .env
            for production.
          </p>
        </div>
      )}

      {/* Status */}
      <div className="flex items-center gap-3 p-4 rounded-lg bg-gray-900 border border-gray-700">
        <div
          className={`w-3 h-3 rounded-full ${
            account?.hasCredentials === true ? 'bg-green-500' : 'bg-gray-500'
          }`}
        />
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-200">
            {account ? `@${account.username}` : 'Not Connected'}
          </span>
          {account?.lastSyncAt && (
            <span className="text-xs text-gray-500 ml-2">
              Last sync: {new Date(account.lastSyncAt).toLocaleDateString()}
            </span>
          )}
        </div>
        {account?.hasCredentials === true && (
          <button
            onClick={() => void handleTest()}
            disabled={isTesting}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/50 hover:bg-blue-600/30 disabled:opacity-50"
          >
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
        )}
      </div>

      {/* Test Result */}
      {testResult !== null && (
        <div
          className={`p-3 rounded-lg ${
            testResult.success
              ? 'bg-green-900/20 border border-green-500/50'
              : 'bg-red-900/20 border border-red-500/50'
          }`}
        >
          {testResult.success && testResult.user ? (
            <p className="text-sm text-green-400">
              Connected as @{testResult.user.username} ({testResult.user.name})
            </p>
          ) : (
            <p className="text-sm text-red-400">{testResult.error ?? 'Connection failed'}</p>
          )}
        </div>
      )}

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-300 block mb-2">Twitter Username</label>
          <div className="flex items-center">
            <span className="px-3 py-2 text-sm bg-gray-800 border border-r-0 border-gray-700 rounded-l-lg text-gray-400">
              @
            </span>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              placeholder="your_username"
              className="flex-1 px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-r-lg text-gray-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Credentials Section */}
        <div className="border border-gray-700 rounded-lg">
          <button
            onClick={() => setShowCredentials(!showCredentials)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <div>
              <span className="text-sm font-medium text-gray-300">API Credentials</span>
              <p className="text-xs text-gray-500">
                {account?.hasCredentials === true
                  ? 'Credentials configured'
                  : 'Required for performance tracking'}
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showCredentials ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          <div
            className={`overflow-hidden transition-all duration-200 ${
              showCredentials ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <div className="p-4 pt-0 space-y-3 border-t border-gray-700">
              {account?.hasCredentials === true && (
                <div className="text-xs text-gray-500 space-y-1">
                  <p>Current credentials (masked):</p>
                  <p>API Key: {account.apiKeyMasked}</p>
                  <p>API Secret: {account.apiSecretMasked}</p>
                  <p>Access Token: {account.accessTokenMasked}</p>
                  <p>Access Secret: {account.accessSecretMasked}</p>
                </div>
              )}

              <p className="text-xs text-gray-500">
                Get these from the{' '}
                <a
                  href="https://developer.twitter.com/en/portal/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  Twitter Developer Portal
                </a>
                . Leave blank to keep existing values.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">API Key</label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder="Enter new API key"
                    className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">API Secret</label>
                  <input
                    type="password"
                    value={formData.apiSecret}
                    onChange={(e) => setFormData({ ...formData, apiSecret: e.target.value })}
                    placeholder="Enter new API secret"
                    className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Access Token</label>
                  <input
                    type="password"
                    value={formData.accessToken}
                    onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                    placeholder="Enter new access token"
                    className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Access Secret</label>
                  <input
                    type="password"
                    value={formData.accessSecret}
                    onChange={(e) => setFormData({ ...formData, accessSecret: e.target.value })}
                    placeholder="Enter new access secret"
                    className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : account ? 'Update Account' : 'Connect Account'}
          </button>
          {account !== null && (
            <button
              onClick={() => void handleDisconnect()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600/20 text-red-400 border border-red-500/50 hover:bg-red-600/30"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default TwitterAccountSettings;
