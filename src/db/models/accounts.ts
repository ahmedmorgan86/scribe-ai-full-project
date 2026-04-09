import { getDb } from '../connection';
import { Account, AccountTier, AccountHealthStatus } from '@/types';

interface AccountRow {
  id: number;
  handle: string;
  tier: AccountTier;
  last_scraped: string | null;
  health_status: AccountHealthStatus;
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    handle: row.handle,
    tier: row.tier,
    lastScraped: row.last_scraped,
    healthStatus: row.health_status,
  };
}

export interface CreateAccountInput {
  handle: string;
  tier: AccountTier;
  healthStatus?: AccountHealthStatus;
}

export interface UpdateAccountInput {
  tier?: AccountTier;
  lastScraped?: string | null;
  healthStatus?: AccountHealthStatus;
}

export interface ListAccountsOptions {
  tier?: AccountTier;
  healthStatus?: AccountHealthStatus;
  lastScrapedBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'handle' | 'tier' | 'last_scraped' | 'health_status';
  orderDir?: 'asc' | 'desc';
}

export function createAccount(input: CreateAccountInput): Account {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO accounts (handle, tier, health_status)
    VALUES (?, ?, ?)
  `);

  const healthStatus = input.healthStatus ?? 'healthy';
  const result = stmt.run(input.handle, input.tier, healthStatus);

  const account = getAccountById(result.lastInsertRowid as number);
  if (!account) {
    throw new Error('Failed to create account');
  }
  return account;
}

export function getAccountById(id: number): Account | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM accounts WHERE id = ?`);
  const row = stmt.get(id) as AccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function getAccountByHandle(handle: string): Account | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM accounts WHERE handle = ?`);
  const row = stmt.get(handle) as AccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function updateAccount(id: number, input: UpdateAccountInput): Account | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.tier !== undefined) {
    setClauses.push('tier = ?');
    values.push(input.tier);
  }
  if (input.lastScraped !== undefined) {
    setClauses.push('last_scraped = ?');
    values.push(input.lastScraped);
  }
  if (input.healthStatus !== undefined) {
    setClauses.push('health_status = ?');
    values.push(input.healthStatus);
  }

  if (setClauses.length === 0) {
    return getAccountById(id);
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE accounts SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getAccountById(id) : null;
}

export function deleteAccount(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM accounts WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function listAccounts(options: ListAccountsOptions = {}): Account[] {
  const db = getDb();
  const {
    tier,
    healthStatus,
    lastScrapedBefore,
    limit = 50,
    offset = 0,
    orderBy = 'handle',
    orderDir = 'asc',
  } = options;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (tier !== undefined) {
    whereClauses.push('tier = ?');
    params.push(tier);
  }
  if (healthStatus !== undefined) {
    whereClauses.push('health_status = ?');
    params.push(healthStatus);
  }
  if (lastScrapedBefore !== undefined) {
    whereClauses.push('(last_scraped IS NULL OR last_scraped < ?)');
    params.push(lastScrapedBefore);
  }

  let query = `SELECT * FROM accounts`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as AccountRow[];
  return rows.map(rowToAccount);
}

export function countAccounts(tier?: AccountTier, healthStatus?: AccountHealthStatus): number {
  const db = getDb();
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (tier !== undefined) {
    whereClauses.push('tier = ?');
    params.push(tier);
  }
  if (healthStatus !== undefined) {
    whereClauses.push('health_status = ?');
    params.push(healthStatus);
  }

  let query = `SELECT COUNT(*) as count FROM accounts`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getAccountsByTier(tier: AccountTier): Account[] {
  return listAccounts({ tier });
}

export function getAccountsByHealthStatus(healthStatus: AccountHealthStatus): Account[] {
  return listAccounts({ healthStatus });
}

export function updateLastScraped(id: number, scrapedAt: string): Account | null {
  return updateAccount(id, { lastScraped: scrapedAt });
}

export function updateHealthStatus(id: number, healthStatus: AccountHealthStatus): Account | null {
  return updateAccount(id, { healthStatus });
}

export function getAccountsDueForScrape(tier: AccountTier, olderThan: string): Account[] {
  return listAccounts({
    tier,
    lastScrapedBefore: olderThan,
    orderBy: 'last_scraped',
    orderDir: 'asc',
  });
}
