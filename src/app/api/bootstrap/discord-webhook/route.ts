import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

interface DiscordWebhookRequest {
  webhookUrl: string;
}

interface DiscordWebhookResponse {
  success: boolean;
}

interface ErrorResponse {
  error: string;
}

function updateEnvFile(key: string, value: string): void {
  const envPath = path.join(process.cwd(), '.env.local');
  let content = '';

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  const lines = content.split('\n');
  let found = false;

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) {
      return line;
    }

    const [lineKey] = trimmed.split('=');
    if (lineKey === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    updatedLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, updatedLines.join('\n'));
}

export async function POST(
  request: Request
): Promise<NextResponse<DiscordWebhookResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as DiscordWebhookRequest;

    if (!body.webhookUrl || typeof body.webhookUrl !== 'string') {
      return NextResponse.json({ error: 'Webhook URL is required' }, { status: 400 });
    }

    const urlPattern = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/.+$/;
    if (!urlPattern.test(body.webhookUrl)) {
      return NextResponse.json({ error: 'Invalid Discord webhook URL format' }, { status: 400 });
    }

    updateEnvFile('DISCORD_WEBHOOK_URL', body.webhookUrl);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
