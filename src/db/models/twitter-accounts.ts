import { getDb } from '../connection';
import { encrypt, decrypt, maskCredential } from '@/lib/crypto/credentials';

export interface TwitterAccount {
  id: number;
  username: string;
  displayName: string | null;
  profileImageUrl: string | null;
  isPrimary: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface TwitterAccountWithCredentials extends TwitterAccount {
  apiKey: string | null;
  apiSecret: string | null;
  accessToken: string | null;
  accessSecret: string | null;
}

export interface TwitterAccountMasked extends TwitterAccount {
  apiKeyMasked: string | null;
  apiSecretMasked: string | null;
  accessTokenMasked: string | null;
  accessSecretMasked: string | null;
  hasCredentials: boolean;
}

interface TwitterAccountRow {
  id: number;
  username: string;
  display_name: string | null;
  profile_image_url: string | null;
  api_key: string | null;
  api_secret: string | null;
  access_token: string | null;
  access_secret: string | null;
  is_primary: number;
  connected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
}

function rowToAccount(row: TwitterAccountRow): TwitterAccount {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    profileImageUrl: row.profile_image_url,
    isPrimary: row.is_primary === 1,
    connectedAt: row.connected_at,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
  };
}

function rowToAccountWithCredentials(row: TwitterAccountRow): TwitterAccountWithCredentials {
  return {
    ...rowToAccount(row),
    apiKey: row.api_key ? decrypt(row.api_key) : null,
    apiSecret: row.api_secret ? decrypt(row.api_secret) : null,
    accessToken: row.access_token ? decrypt(row.access_token) : null,
    accessSecret: row.access_secret ? decrypt(row.access_secret) : null,
  };
}

function rowToAccountMasked(row: TwitterAccountRow): TwitterAccountMasked {
  const apiKey = row.api_key ? decrypt(row.api_key) : null;
  const apiSecret = row.api_secret ? decrypt(row.api_secret) : null;
  const accessToken = row.access_token ? decrypt(row.access_token) : null;
  const accessSecret = row.access_secret ? decrypt(row.access_secret) : null;

  return {
    ...rowToAccount(row),
    apiKeyMasked: apiKey ? maskCredential(apiKey) : null,
    apiSecretMasked: apiSecret ? maskCredential(apiSecret) : null,
    accessTokenMasked: accessToken ? maskCredential(accessToken) : null,
    accessSecretMasked: accessSecret ? maskCredential(accessSecret) : null,
    hasCredentials: Boolean(apiKey && apiSecret && accessToken && accessSecret),
  };
}

export interface CreateTwitterAccountInput {
  username: string;
  displayName?: string;
  profileImageUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
  isPrimary?: boolean;
}

export function createTwitterAccount(input: CreateTwitterAccountInput): TwitterAccount {
  const db = getDb();

  // If this is primary, unset other primaries
  if (input.isPrimary !== false) {
    db.prepare(`UPDATE twitter_accounts SET is_primary = 0`).run();
  }

  const stmt = db.prepare(`
    INSERT INTO twitter_accounts (
      username, display_name, profile_image_url,
      api_key, api_secret, access_token, access_secret,
      is_primary, connected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const result = stmt.run(
    input.username,
    input.displayName ?? null,
    input.profileImageUrl ?? null,
    input.apiKey ? encrypt(input.apiKey) : null,
    input.apiSecret ? encrypt(input.apiSecret) : null,
    input.accessToken ? encrypt(input.accessToken) : null,
    input.accessSecret ? encrypt(input.accessSecret) : null,
    input.isPrimary !== false ? 1 : 0
  );

  const account = getTwitterAccountById(result.lastInsertRowid as number);
  if (!account) throw new Error('Failed to create Twitter account');
  return account;
}

export function getTwitterAccountById(id: number): TwitterAccount | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM twitter_accounts WHERE id = ?`).get(id) as
    | TwitterAccountRow
    | undefined;
  return row ? rowToAccount(row) : null;
}

export function getTwitterAccountByUsername(username: string): TwitterAccount | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM twitter_accounts WHERE username = ?`).get(username) as
    | TwitterAccountRow
    | undefined;
  return row ? rowToAccount(row) : null;
}

export function getPrimaryTwitterAccount(): TwitterAccountWithCredentials | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM twitter_accounts WHERE is_primary = 1 LIMIT 1`).get() as
    | TwitterAccountRow
    | undefined;
  return row ? rowToAccountWithCredentials(row) : null;
}

export function getPrimaryTwitterAccountMasked(): TwitterAccountMasked | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM twitter_accounts WHERE is_primary = 1 LIMIT 1`).get() as
    | TwitterAccountRow
    | undefined;
  return row ? rowToAccountMasked(row) : null;
}

export function listTwitterAccounts(): TwitterAccountMasked[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM twitter_accounts ORDER BY is_primary DESC, created_at DESC`)
    .all() as TwitterAccountRow[];
  return rows.map(rowToAccountMasked);
}

export interface UpdateTwitterAccountInput {
  username?: string;
  displayName?: string;
  profileImageUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
  isPrimary?: boolean;
}

export function updateTwitterAccount(
  id: number,
  input: UpdateTwitterAccountInput
): TwitterAccount | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.username !== undefined) {
    setClauses.push('username = ?');
    values.push(input.username);
  }
  if (input.displayName !== undefined) {
    setClauses.push('display_name = ?');
    values.push(input.displayName);
  }
  if (input.profileImageUrl !== undefined) {
    setClauses.push('profile_image_url = ?');
    values.push(input.profileImageUrl);
  }
  if (input.apiKey !== undefined) {
    setClauses.push('api_key = ?');
    values.push(input.apiKey ? encrypt(input.apiKey) : null);
  }
  if (input.apiSecret !== undefined) {
    setClauses.push('api_secret = ?');
    values.push(input.apiSecret ? encrypt(input.apiSecret) : null);
  }
  if (input.accessToken !== undefined) {
    setClauses.push('access_token = ?');
    values.push(input.accessToken ? encrypt(input.accessToken) : null);
  }
  if (input.accessSecret !== undefined) {
    setClauses.push('access_secret = ?');
    values.push(input.accessSecret ? encrypt(input.accessSecret) : null);
  }
  if (input.isPrimary !== undefined) {
    if (input.isPrimary) {
      db.prepare(`UPDATE twitter_accounts SET is_primary = 0`).run();
    }
    setClauses.push('is_primary = ?');
    values.push(input.isPrimary ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return getTwitterAccountById(id);
  }

  values.push(id);
  db.prepare(`UPDATE twitter_accounts SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  return getTwitterAccountById(id);
}

export function deleteTwitterAccount(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM twitter_accounts WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function updateLastSyncAt(id: number): void {
  const db = getDb();
  db.prepare(`UPDATE twitter_accounts SET last_sync_at = datetime('now') WHERE id = ?`).run(id);
}
