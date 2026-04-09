import { NextResponse } from 'next/server';
import {
  createAccount,
  getAccountByHandle,
  listAccounts,
  deleteAccount,
} from '@/db/models/accounts';
import type { Account, AccountTier } from '@/types';

interface AccountsRequest {
  accounts: string[];
}

interface AccountsResponse {
  success: boolean;
  added: number;
  skipped: number;
}

interface AccountsListResponse {
  accounts: Array<{
    id: number;
    handle: string;
    tier: AccountTier;
    lastScraped: string | null;
  }>;
  total: number;
}

interface ErrorResponse {
  error: string;
}

interface ParsedAccount {
  handle: string;
  tier: AccountTier;
}

/**
 * GET /api/bootstrap/accounts
 * Returns the list of imported accounts
 */
export function GET(): NextResponse<AccountsListResponse | ErrorResponse> {
  try {
    const accounts = listAccounts({ limit: 500 });
    return NextResponse.json({
      accounts: accounts.map((a: Account) => ({
        id: a.id,
        handle: a.handle,
        tier: a.tier,
        lastScraped: a.lastScraped,
      })),
      total: accounts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/bootstrap/accounts
 * Deletes an account by ID
 */
export function DELETE(request: Request): NextResponse<{ success: boolean } | ErrorResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    const deleted = deleteAccount(parseInt(id, 10));
    if (!deleted) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseAccountLine(line: string): ParsedAccount | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const parts = trimmed.split(',').map((p) => p.trim());
  let handle = parts[0];

  if (handle.startsWith('@')) {
    handle = handle.slice(1);
  }

  if (!handle || handle.length === 0) {
    return null;
  }

  let tier: AccountTier = 2;
  if (parts.length > 1) {
    const parsedTier = parseInt(parts[1], 10);
    if (parsedTier === 1 || parsedTier === 2) {
      tier = parsedTier as AccountTier;
    }
  }

  return { handle, tier };
}

export async function POST(
  request: Request
): Promise<NextResponse<AccountsResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as AccountsRequest;

    if (!Array.isArray(body.accounts)) {
      return NextResponse.json({ error: 'Accounts array is required' }, { status: 400 });
    }

    let added = 0;
    let skipped = 0;

    for (const line of body.accounts) {
      const parsed = parseAccountLine(line);
      if (!parsed) {
        continue;
      }

      const existing = getAccountByHandle(parsed.handle);
      if (existing) {
        skipped++;
        continue;
      }

      try {
        createAccount({
          handle: parsed.handle,
          tier: parsed.tier,
          healthStatus: 'healthy',
        });
        added++;
      } catch {
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      added,
      skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
