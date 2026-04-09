import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

interface ApiKeysRequest {
  anthropicApiKey?: string;
  smaugApiUrl?: string;
  smaugApiKey?: string;
  apifyApiToken?: string;
}

interface ApiKeysResponse {
  success: boolean;
  configured: {
    anthropic: boolean;
    smaug: boolean;
    apify: boolean;
  };
}

interface ApiKeysStatusResponse {
  anthropic: { configured: boolean; masked: string | null };
  apify: { configured: boolean; masked: string | null };
  discord: { configured: boolean; masked: string | null };
}

interface ErrorResponse {
  error: string;
}

function maskApiKey(key: string | undefined): string | null {
  if (!key || key.length < 8) return null;
  const prefix = key.substring(0, 7);
  const suffix = key.substring(key.length - 4);
  return `${prefix}...${suffix}`;
}

function maskWebhookUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/');
    if (pathParts.length > 2) {
      return `${parsed.origin}/.../${pathParts[pathParts.length - 1].substring(0, 6)}...`;
    }
    return `${parsed.origin}/...`;
  } catch {
    return null;
  }
}

/**
 * GET /api/bootstrap/api-keys
 * Returns the status of configured API keys with masked values
 */
export function GET(): NextResponse<ApiKeysStatusResponse> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const apifyToken = process.env.APIFY_API_TOKEN;
  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;

  return NextResponse.json({
    anthropic: {
      configured: !!anthropicKey,
      masked: maskApiKey(anthropicKey),
    },
    apify: {
      configured: !!apifyToken,
      masked: maskApiKey(apifyToken),
    },
    discord: {
      configured:
        !!discordWebhook && discordWebhook.startsWith('https://discord.com/api/webhooks/'),
      masked: maskWebhookUrl(discordWebhook),
    },
  });
}

function updateEnvFile(updates: Record<string, string>): void {
  const envPath = path.join(process.cwd(), '.env.local');
  let content = '';

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  const lines = content.split('\n');
  const existingKeys = new Set<string>();
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) {
      return line;
    }

    const [key] = trimmed.split('=');
    existingKeys.add(key);

    if (key in updates && updates[key]) {
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!existingKeys.has(key) && value) {
      updatedLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, updatedLines.join('\n'));
}

export async function POST(
  request: Request
): Promise<NextResponse<ApiKeysResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as ApiKeysRequest;

    const updates: Record<string, string> = {};

    if (body.anthropicApiKey) {
      updates['ANTHROPIC_API_KEY'] = body.anthropicApiKey;
    }

    if (body.smaugApiUrl) {
      updates['SMAUG_API_URL'] = body.smaugApiUrl;
    }

    if (body.smaugApiKey) {
      updates['SMAUG_API_KEY'] = body.smaugApiKey;
    }

    if (body.apifyApiToken) {
      updates['APIFY_API_TOKEN'] = body.apifyApiToken;
    }

    if (Object.keys(updates).length > 0) {
      updateEnvFile(updates);
    }

    const configured = {
      anthropic: !!(body.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY),
      smaug: !!(body.smaugApiUrl ?? process.env.SMAUG_API_URL),
      apify: !!(body.apifyApiToken ?? process.env.APIFY_API_TOKEN),
    };

    return NextResponse.json({
      success: true,
      configured,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
