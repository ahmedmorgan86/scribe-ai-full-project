#!/usr/bin/env npx tsx

/**
 * Seed curated Twitter accounts for Apify scraping.
 *
 * Usage:
 *   npx tsx scripts/seed-accounts.ts
 *   npx tsx scripts/seed-accounts.ts --dry-run
 */

import { getDb, closeDb } from '../src/db/connection';

interface CuratedAccount {
  handle: string;
  tier: 1 | 2;
}

// Example curated accounts for your niche
// Replace these with accounts relevant to your content strategy
const CURATED_ACCOUNTS: CuratedAccount[] = [
  // ==========================================
  // TIER 1 - Top Accounts (scrape more frequently)
  // ==========================================

  // Add your top inspiration accounts here
  // Example: Tech / Startup niche
  { handle: 'example_account_1', tier: 1 },
  { handle: 'example_account_2', tier: 1 },
  { handle: 'example_account_3', tier: 1 },

  // ==========================================
  // TIER 2 - Good Accounts (scrape less frequently)
  // ==========================================

  // Add more accounts for broader content diversity
  { handle: 'example_account_4', tier: 2 },
  { handle: 'example_account_5', tier: 2 },
  { handle: 'example_account_6', tier: 2 },
];

async function seedAccounts(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('Seeding curated Twitter accounts...');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Total accounts to seed: ${CURATED_ACCOUNTS.length}`);
  console.log(`  Tier 1: ${CURATED_ACCOUNTS.filter((a) => a.tier === 1).length}`);
  console.log(`  Tier 2: ${CURATED_ACCOUNTS.filter((a) => a.tier === 2).length}`);
  console.log('');

  if (isDryRun) {
    console.log('Would insert the following accounts:');
    for (const account of CURATED_ACCOUNTS) {
      console.log(`  @${account.handle} (Tier ${account.tier})`);
    }
    return;
  }

  const db = getDb();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO accounts (handle, tier, health_status)
    VALUES (?, ?, 'healthy')
  `);

  let inserted = 0;
  let skipped = 0;

  for (const account of CURATED_ACCOUNTS) {
    try {
      const result = insertStmt.run(account.handle, account.tier);
      if (result.changes > 0) {
        inserted++;
        console.log(`  ✓ Added @${account.handle} (Tier ${account.tier})`);
      } else {
        skipped++;
        console.log(`  - Skipped @${account.handle} (already exists)`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to insert @${account.handle}:`, error);
    }
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (duplicates): ${skipped}`);
  console.log(`  Total in database: ${inserted + skipped}`);
}

seedAccounts()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    closeDb();
  });
