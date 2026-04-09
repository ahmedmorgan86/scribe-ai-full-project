import { NextRequest, NextResponse } from 'next/server';
import { scrapeAccountsForTier, type ApifyScrapeResult } from '@/workers/apify-worker';
import { isDiscordConfigured, sendNotification } from '@/lib/notifications/discord';
import type { AccountTier } from '@/types';

export const dynamic = 'force-dynamic';

interface ScrapeRequestBody {
  tier?: 'all' | 1 | 2;
}

interface ScrapeResponse {
  success: boolean;
  result: ApifyScrapeResult | CombinedScrapeResult;
}

interface CombinedScrapeResult {
  tier1: ApifyScrapeResult;
  tier2: ApifyScrapeResult;
  totalTweetsInserted: number;
  totalDuration: number;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ScrapeResponse | ErrorResponse>> {
  try {
    const body = (await request.json().catch(() => ({}))) as ScrapeRequestBody;
    const tierInput = body.tier;

    let result: ApifyScrapeResult | CombinedScrapeResult;

    if (tierInput === 1 || tierInput === 2) {
      result = await scrapeAccountsForTier(tierInput as AccountTier);
    } else {
      // Scrape both tiers
      const tier1Result = await scrapeAccountsForTier(1);
      const tier2Result = await scrapeAccountsForTier(2);

      result = {
        tier1: tier1Result,
        tier2: tier2Result,
        totalTweetsInserted: tier1Result.tweetsInserted + tier2Result.tweetsInserted,
        totalDuration: tier1Result.duration + tier2Result.duration,
      };
    }

    // Send Discord notification if any tweets were imported
    const tweetsInserted = isCombinedResult(result)
      ? result.totalTweetsInserted
      : result.tweetsInserted;

    if (tweetsInserted > 0 && isDiscordConfigured()) {
      try {
        const fields = isCombinedResult(result)
          ? [
              {
                name: 'Tier 1',
                value: `${result.tier1.tweetsInserted} tweets`,
                inline: true,
              },
              {
                name: 'Tier 2',
                value: `${result.tier2.tweetsInserted} tweets`,
                inline: true,
              },
              {
                name: 'Total',
                value: `${result.totalTweetsInserted} new sources`,
                inline: true,
              },
            ]
          : [
              {
                name: 'Tier',
                value: String(result.tier),
                inline: true,
              },
              {
                name: 'Accounts',
                value: `${result.accountsSucceeded}/${result.accountsProcessed}`,
                inline: true,
              },
              {
                name: 'New Sources',
                value: String(result.tweetsInserted),
                inline: true,
              },
            ];

        await sendNotification(
          'content_ready',
          'Source Scrape Complete',
          `Imported ${tweetsInserted} new tweets as sources`,
          'low',
          fields
        );
      } catch (notifyError) {
        console.warn('[api/apify/scrape] Failed to send Discord notification:', notifyError);
      }
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[api/apify/scrape] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Scrape failed', details: message }, { status: 500 });
  }
}

function isCombinedResult(
  result: ApifyScrapeResult | CombinedScrapeResult
): result is CombinedScrapeResult {
  return 'tier1' in result && 'tier2' in result;
}
