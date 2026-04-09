import { NextRequest, NextResponse } from 'next/server';
import {
  createTwitterAccount,
  updateTwitterAccount,
  deleteTwitterAccount,
  getPrimaryTwitterAccountMasked,
  listTwitterAccounts,
  type TwitterAccountMasked,
  type CreateTwitterAccountInput,
  type UpdateTwitterAccountInput,
} from '@/db/models/twitter-accounts';
import { isEncryptionConfigured } from '@/lib/crypto/credentials';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:twitter:account');

export const dynamic = 'force-dynamic';

interface AccountResponse {
  account: TwitterAccountMasked | null;
  accounts?: TwitterAccountMasked[];
  encryptionConfigured: boolean;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

interface SuccessResponse {
  success: boolean;
  account?: TwitterAccountMasked;
  message?: string;
}

/**
 * GET /api/twitter/account
 *
 * Returns the primary connected Twitter account (without decrypted secrets).
 */
export function GET(): NextResponse<AccountResponse | ErrorResponse> {
  try {
    const account = getPrimaryTwitterAccountMasked();
    const accounts = listTwitterAccounts();

    return NextResponse.json({
      account,
      accounts,
      encryptionConfigured: isEncryptionConfigured(),
    });
  } catch (error) {
    logger.error('Failed to get Twitter account', { error });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/twitter/account
 *
 * Create or update Twitter account credentials.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as CreateTwitterAccountInput & { id?: number };

    if (!body.username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    // Remove @ prefix if present
    const username = body.username.replace(/^@/, '');

    if (body.id != null && body.id !== 0) {
      // Update existing account
      const updated = updateTwitterAccount(body.id, {
        username,
        displayName: body.displayName,
        profileImageUrl: body.profileImageUrl,
        apiKey: body.apiKey,
        apiSecret: body.apiSecret,
        accessToken: body.accessToken,
        accessSecret: body.accessSecret,
        isPrimary: body.isPrimary,
      } as UpdateTwitterAccountInput);

      if (!updated) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      }

      logger.info('Twitter account updated', { id: body.id, username });
      const maskedAccount = getPrimaryTwitterAccountMasked();
      return NextResponse.json({ success: true, account: maskedAccount ?? undefined });
    }

    // Create new account
    const account = createTwitterAccount({
      username,
      displayName: body.displayName,
      profileImageUrl: body.profileImageUrl,
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
      accessToken: body.accessToken,
      accessSecret: body.accessSecret,
      isPrimary: body.isPrimary,
    });

    logger.info('Twitter account created', { id: account.id, username });
    const maskedAccount = getPrimaryTwitterAccountMasked();
    return NextResponse.json({ success: true, account: maskedAccount ?? undefined });
  } catch (error) {
    logger.error('Failed to save Twitter account', { error });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/twitter/account
 *
 * Disconnect/delete a Twitter account.
 */
export function DELETE(request: NextRequest): NextResponse<SuccessResponse | ErrorResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');

    if (!idParam) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 });
    }

    const deleted = deleteTwitterAccount(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    logger.info('Twitter account deleted', { id });
    return NextResponse.json({ success: true, message: 'Account disconnected' });
  } catch (error) {
    logger.error('Failed to delete Twitter account', { error });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
