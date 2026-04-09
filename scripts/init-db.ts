#!/usr/bin/env npx tsx
/**
 * Database Initialization Script
 *
 * Initializes SQLite database, runs migrations, creates Qdrant collections,
 * and seeds default formulas.
 *
 * Usage: npx tsx scripts/init-db.ts
 */

import { getDb, closeDb } from '../src/db/connection';
import { runMigrations } from '../src/db/migrations';
import { initializeAllCollections } from '../src/db/qdrant/collections';
import { createFormula, getFormulaByName } from '../src/db/models/formulas';
import { healthCheck } from '../src/db/qdrant/connection';

interface DefaultFormula {
  name: string;
  template: string;
}

const DEFAULT_FORMULAS: DefaultFormula[] = [
  {
    name: 'insight-tweet',
    template: `You are writing a tweet that shares a valuable insight.

Source/Topic: {{source}}

Write a single tweet (max 280 chars) that:
- Starts with the insight or problem, not "I" or "You know what"
- Uses direct, conversational language
- Provides actionable value
- Avoids hashtags and emojis
- Sounds like a real person, not a marketer`,
  },
  {
    name: 'thread-hook',
    template: `You are writing the opening tweet of a thread.

Topic: {{source}}

Write a compelling hook tweet (max 280 chars) that:
- Creates curiosity or states a bold claim
- Makes people want to read the thread
- Is specific, not vague
- Avoids "thread incoming" or similar meta-commentary
- Ends naturally (no "Here's what I learned:" cliffhangers)`,
  },
  {
    name: 'contrarian-take',
    template: `You are writing a tweet with a contrarian perspective.

Topic: {{source}}

Write a thought-provoking tweet (max 280 chars) that:
- Challenges conventional wisdom
- Backs up the claim with reasoning
- Isn't contrarian just for shock value
- Invites discussion
- Stays respectful and constructive`,
  },
  {
    name: 'story-tweet',
    template: `You are writing a tweet that tells a brief story or shares an experience.

Context: {{source}}

Write an engaging story tweet (max 280 chars) that:
- Starts in the middle of the action
- Has a clear point or lesson
- Uses concrete details
- Feels authentic and personal
- Avoids obvious moralizing at the end`,
  },
  {
    name: 'question-tweet',
    template: `You are writing a tweet that asks a thought-provoking question.

Topic: {{source}}

Write an engaging question tweet (max 280 chars) that:
- Asks a genuine question you'd want answered
- Is specific enough to invite real responses
- Isn't rhetorical or leading
- Sparks curiosity or self-reflection
- Stands alone without needing context`,
  },
];

async function seedFormulas(): Promise<{ added: number; skipped: number }> {
  const result = { added: 0, skipped: 0 };

  for (const formula of DEFAULT_FORMULAS) {
    const existing = getFormulaByName(formula.name);
    if (existing) {
      console.log(`  - Formula "${formula.name}" already exists, skipping`);
      result.skipped++;
      continue;
    }

    createFormula({
      name: formula.name,
      template: formula.template,
      active: true,
    });
    console.log(`  - Created formula "${formula.name}"`);
    result.added++;
  }

  return result;
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('AI Social Engine - Database Initialization');
  console.log('='.repeat(60));
  console.log();

  try {
    // Step 1: Initialize SQLite and run migrations
    console.log('[1/3] SQLite Database');
    console.log('-'.repeat(40));

    const db = getDb();
    console.log(`  Database path: ${db.name}`);

    const migrationResult = runMigrations();
    if (migrationResult.applied.length > 0) {
      console.log(`  Applied ${migrationResult.applied.length} migrations:`);
      migrationResult.applied.forEach((m) => console.log(`    - ${m}`));
    } else {
      console.log(`  All ${migrationResult.skipped.length} migrations already applied`);
    }
    console.log();

    // Step 2: Initialize Qdrant collections
    console.log('[2/3] Qdrant Collections');
    console.log('-'.repeat(40));

    const qdrantHealthy = await healthCheck();
    if (!qdrantHealthy) {
      console.log('  WARNING: Qdrant is not available at configured URL');
      console.log('  Make sure Qdrant is running (docker-compose up -d qdrant)');
      console.log('  Skipping collection initialization...');
    } else {
      console.log('  Qdrant connection: OK');
      await initializeAllCollections();
      console.log('  All collections initialized');
    }
    console.log();

    // Step 3: Seed default formulas
    console.log('[3/3] Default Formulas');
    console.log('-'.repeat(40));

    const formulaResult = await seedFormulas();
    console.log(
      `  Result: ${formulaResult.added} added, ${formulaResult.skipped} already existed`
    );
    console.log();

    // Summary
    console.log('='.repeat(60));
    console.log('Initialization Complete!');
    console.log('='.repeat(60));
    console.log();
    console.log('Next steps:');
    console.log('  1. Start the dev server: npm run dev');
    console.log('  2. Open http://localhost:3000/bootstrap');
    console.log('  3. Complete the setup wizard');
    console.log();
  } catch (error) {
    console.error('Initialization failed:', error);
    process.exit(1);
  } finally {
    closeDb();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
