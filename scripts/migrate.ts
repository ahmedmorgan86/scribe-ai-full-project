#!/usr/bin/env npx tsx

/**
 * Database migration CLI script.
 * Usage:
 *   npx tsx scripts/migrate.ts         - Run pending migrations
 *   npx tsx scripts/migrate.ts status  - Show migration status
 *   npx tsx scripts/migrate.ts down    - Rollback last migration
 */

import '../src/db/migrations';
import { runMigrations, getMigrationStatus, rollbackMigration } from '../src/db/migrations/runner';
import { closeDb } from '../src/db/connection';

const command = process.argv[2] || 'up';

try {
  switch (command) {
    case 'up': {
      console.log('Running migrations...\n');
      const result = runMigrations();

      if (result.applied.length > 0) {
        console.log('Applied migrations:');
        result.applied.forEach((m) => console.log(`  ✓ ${m}`));
      } else {
        console.log('No pending migrations.');
      }

      if (result.skipped.length > 0) {
        console.log(`\nSkipped ${result.skipped.length} already applied migrations.`);
      }
      break;
    }

    case 'status': {
      const status = getMigrationStatus();

      console.log('Applied migrations:');
      if (status.applied.length > 0) {
        status.applied.forEach((m) =>
          console.log(`  ✓ ${m.id}_${m.name} (${m.applied_at})`)
        );
      } else {
        console.log('  (none)');
      }

      console.log('\nPending migrations:');
      if (status.pending.length > 0) {
        status.pending.forEach((m) => console.log(`  ○ ${m}`));
      } else {
        console.log('  (none)');
      }
      break;
    }

    case 'down': {
      console.log('Rolling back last migration...\n');
      const rolled = rollbackMigration();

      if (rolled) {
        console.log(`  ✓ Rolled back: ${rolled}`);
      } else {
        console.log('  No migrations to rollback.');
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log('Usage: npx tsx scripts/migrate.ts [up|status|down]');
      process.exit(1);
  }
} finally {
  closeDb();
}
