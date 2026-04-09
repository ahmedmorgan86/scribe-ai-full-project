#!/usr/bin/env npx tsx
/**
 * Automated Bug Report Generator
 *
 * Runs all test suites, collects failures, and generates a structured bug report.
 *
 * Usage: npm run bug-report
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

interface TestFailure {
  suite: string;
  testName: string;
  file?: string;
  line?: number;
  error: string;
  expected?: string;
  actual?: string;
  reproductionSteps?: string[];
}

interface SuiteResult {
  name: string;
  command: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: TestFailure[];
  exitCode: number;
  output: string;
}

interface BugReport {
  timestamp: string;
  summary: {
    totalSuites: number;
    passedSuites: number;
    failedSuites: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
  };
  suiteResults: SuiteResult[];
  issuesByComponent: Record<string, TestFailure[]>;
}

// ============================================================================
// Configuration
// ============================================================================

const SUITES = [
  {
    name: 'Health Check',
    command: 'npx tsx scripts/health-check.ts',
    parser: 'health-check',
  },
  {
    name: 'Unit Tests',
    command: 'npx vitest run --reporter=json',
    parser: 'vitest',
  },
  {
    name: 'Integration Tests',
    command: 'npx vitest run src/tests/integration --reporter=json',
    parser: 'vitest',
  },
  {
    name: 'E2E Tests',
    command: 'npx playwright test --reporter=json',
    parser: 'playwright',
  },
] as const;

const COMPONENT_PATTERNS: Record<string, RegExp[]> = {
  'Voice System': [/voice/, /fast-filter/, /guidelines/, /stylometric/],
  'Slop Detection': [/slop/, /humanizer/, /detector/],
  'Content Generation': [/generation/, /generate/, /content/],
  'Queue Management': [/queue/, /approve/, /reject/, /edit/],
  'Bootstrap': [/bootstrap/, /wizard/],
  'API Routes': [/api\./, /route/],
  'Database': [/db/, /sqlite/, /qdrant/, /models/],
  'LLM Integration': [/llm/, /gateway/, /anthropic/, /openai/],
  'Authentication': [/auth/, /middleware/],
  'Dashboard': [/dashboard/, /page\.tsx/],
};

// ============================================================================
// Helpers
// ============================================================================

function runCommand(command: string, timeout = 300000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command.split(' ');
    const proc: ChildProcess = spawn(cmd, args, {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGTERM');
        resolve({
          stdout,
          stderr: stderr + '\n[TIMEOUT] Command exceeded ' + (timeout / 1000) + 's',
          exitCode: 124,
        });
      }
    }, timeout);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve({ stdout, stderr: stderr + '\n' + err.message, exitCode: 1 });
      }
    });
  });
}

function parseVitestOutput(output: string): Partial<SuiteResult> {
  const failures: TestFailure[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // Try to parse JSON output
  const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[0]) as {
        numPassedTests?: number;
        numFailedTests?: number;
        numPendingTests?: number;
        testResults?: Array<{
          name?: string;
          assertionResults?: Array<{
            fullName?: string;
            status?: string;
            failureMessages?: string[];
          }>;
        }>;
      };
      passed = json.numPassedTests ?? 0;
      failed = json.numFailedTests ?? 0;
      skipped = json.numPendingTests ?? 0;

      // Extract failures
      for (const result of json.testResults ?? []) {
        for (const assertion of result.assertionResults ?? []) {
          if (assertion.status === 'failed') {
            const errorMsg = assertion.failureMessages?.join('\n') ?? 'Unknown error';
            failures.push({
              suite: 'Vitest',
              testName: assertion.fullName ?? 'Unknown test',
              file: result.name,
              error: errorMsg,
            });
          }
        }
      }
    } catch {
      // JSON parsing failed, fall back to regex
    }
  }

  // Fallback: parse text output for summary
  if (passed === 0 && failed === 0) {
    const summaryMatch = output.match(/(\d+)\s+passed|(\d+)\s+failed|(\d+)\s+skipped/gi);
    if (summaryMatch) {
      for (const match of summaryMatch) {
        const num = parseInt(match, 10);
        if (match.includes('passed')) passed = num;
        if (match.includes('failed')) failed = num;
        if (match.includes('skipped')) skipped = num;
      }
    }
  }

  // Fallback: extract failure details from text
  if (failures.length === 0 && failed > 0) {
    const failureBlocks = output.split(/FAIL\s+/);
    for (let i = 1; i < failureBlocks.length; i++) {
      const block = failureBlocks[i];
      const lines = block.split('\n');
      const fileMatch = lines[0]?.match(/([^\s]+\.(?:test|spec)\.[jt]sx?)/);
      const testMatch = block.match(/✕\s+(.+?)(?:\s+\d+ms)?$/m);
      const errorMatch = block.match(/Error:\s+(.+?)(?:\n|$)/);

      failures.push({
        suite: 'Vitest',
        testName: testMatch?.[1] ?? 'Unknown test',
        file: fileMatch?.[1],
        error: errorMatch?.[1] ?? block.slice(0, 500),
      });
    }
  }

  return { passed, failed, skipped, failures };
}

function parsePlaywrightOutput(output: string): Partial<SuiteResult> {
  const failures: TestFailure[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // Try to parse JSON output
  try {
    const json = JSON.parse(output) as {
      stats?: {
        expected?: number;
        unexpected?: number;
        skipped?: number;
      };
      suites?: Array<{
        title?: string;
        specs?: Array<{
          title?: string;
          ok?: boolean;
          tests?: Array<{
            results?: Array<{
              status?: string;
              error?: { message?: string };
            }>;
          }>;
        }>;
      }>;
    };
    passed = json.stats?.expected ?? 0;
    failed = json.stats?.unexpected ?? 0;
    skipped = json.stats?.skipped ?? 0;

    // Extract failures
    for (const suite of json.suites ?? []) {
      for (const spec of suite.specs ?? []) {
        if (!spec.ok) {
          for (const test of spec.tests ?? []) {
            for (const result of test.results ?? []) {
              if (result.status === 'failed') {
                failures.push({
                  suite: 'Playwright',
                  testName: `${suite.title} > ${spec.title}`,
                  error: result.error?.message ?? 'Test failed',
                });
              }
            }
          }
        }
      }
    }
  } catch {
    // JSON parsing failed, fall back to regex
    const summaryMatch = output.match(/(\d+)\s+passed|(\d+)\s+failed|(\d+)\s+skipped/gi);
    if (summaryMatch) {
      for (const match of summaryMatch) {
        const num = parseInt(match, 10);
        if (match.includes('passed')) passed = num;
        if (match.includes('failed')) failed = num;
        if (match.includes('skipped')) skipped = num;
      }
    }
  }

  return { passed, failed, skipped, failures };
}

function parseHealthCheckOutput(output: string, exitCode: number): Partial<SuiteResult> {
  const failures: TestFailure[] = [];

  // Health check uses exit code 0 for healthy/degraded, 1 for unhealthy
  if (exitCode !== 0) {
    // Extract failed components
    const failedMatches = output.matchAll(/✗\s+(.+?)\n\s+(.+?)$/gm);
    for (const match of failedMatches) {
      failures.push({
        suite: 'Health Check',
        testName: match[1] ?? 'Unknown component',
        error: match[2] ?? 'Component check failed',
      });
    }
  }

  const passedMatch = output.match(/Passed:\s+(\d+)/);
  const failedMatch = output.match(/Failed:\s+(\d+)/);
  const warnMatch = output.match(/Warnings:\s+(\d+)/);

  return {
    passed: parseInt(passedMatch?.[1] ?? '0', 10),
    failed: parseInt(failedMatch?.[1] ?? '0', 10),
    skipped: parseInt(warnMatch?.[1] ?? '0', 10),
    failures,
  };
}

function categorizeFailure(failure: TestFailure): string {
  const searchText = `${failure.file ?? ''} ${failure.testName} ${failure.error}`.toLowerCase();

  for (const [component, patterns] of Object.entries(COMPONENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(searchText)) {
        return component;
      }
    }
  }

  return 'Other';
}

function extractSuggestedFix(failure: TestFailure): string {
  const error = failure.error.toLowerCase();

  if (error.includes('cannot find module') || error.includes('module not found')) {
    return 'Check import paths and ensure the module exists';
  }
  if (error.includes('timeout')) {
    return 'Increase timeout or check for async issues';
  }
  if (error.includes('mock') || error.includes('spy')) {
    return 'Verify mock setup and ensure mocks are applied before test runs';
  }
  if (error.includes('undefined') || error.includes('null')) {
    return 'Add null checks or verify data is properly initialized';
  }
  if (error.includes('type error') || error.includes('typescript')) {
    return 'Fix type annotations or add proper type guards';
  }
  if (error.includes('foreign key') || error.includes('constraint')) {
    return 'Check database relationships and ensure referenced records exist';
  }
  if (error.includes('econnrefused') || error.includes('connection')) {
    return 'Verify external service is running or mock the connection';
  }

  return 'Review the error message and stack trace for debugging';
}

function generateReproductionSteps(failure: TestFailure): string[] {
  const steps: string[] = [];
  const suite = failure.suite.toLowerCase();

  // Common setup steps based on suite type
  if (suite === 'vitest' || suite.includes('unit') || suite.includes('integration')) {
    steps.push('1. Clone the repository and install dependencies: `npm install`');
    if (failure.file) {
      steps.push(`2. Run the specific test: \`npx vitest run ${failure.file} -t "${failure.testName}"\``);
    } else {
      steps.push(`2. Run the test suite: \`npm run test\``);
    }
    steps.push('3. Observe the failure in the test output');
  } else if (suite === 'playwright' || suite.includes('e2e')) {
    steps.push('1. Clone the repository and install dependencies: `npm install`');
    steps.push('2. Install Playwright browsers: `npx playwright install`');
    steps.push('3. Start the dev server: `npm run dev`');
    if (failure.testName) {
      steps.push(`4. Run the specific E2E test: \`npx playwright test --grep "${failure.testName}"\``);
    } else {
      steps.push('4. Run E2E tests: `npm run test:e2e`');
    }
    steps.push('5. Observe the failure in Playwright report');
  } else if (suite === 'health check') {
    steps.push('1. Clone the repository and install dependencies: `npm install`');
    steps.push('2. Ensure required services are configured (check .env)');
    steps.push('3. Run health check: `npm run health-check`');
    steps.push(`4. Observe the failure for component: ${failure.testName}`);
  }

  // Add error-specific reproduction context
  const error = failure.error.toLowerCase();
  if (error.includes('econnrefused') || error.includes('connection')) {
    steps.push('Note: Ensure external services (Qdrant, LLM workers) are running');
  }
  if (error.includes('database') || error.includes('sqlite')) {
    steps.push('Note: Database may need to be reset with migrations');
  }
  if (error.includes('timeout')) {
    steps.push('Note: Test may be flaky - try running multiple times');
  }

  return steps;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateMarkdownReport(report: BugReport): string {
  const lines: string[] = [];

  // Header
  lines.push('# Automated Bug Report');
  lines.push('');
  lines.push(`**Generated**: ${report.timestamp}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Suites | ${report.summary.totalSuites} |`);
  lines.push(`| Passed Suites | ${report.summary.passedSuites} |`);
  lines.push(`| Failed Suites | ${report.summary.failedSuites} |`);
  lines.push(`| Total Tests | ${report.summary.totalTests} |`);
  lines.push(`| Passed Tests | ${report.summary.passedTests} |`);
  lines.push(`| Failed Tests | ${report.summary.failedTests} |`);
  lines.push(`| Skipped Tests | ${report.summary.skippedTests} |`);
  lines.push('');

  // Overall status
  if (report.summary.failedTests === 0) {
    lines.push('✅ **All tests passing!**');
    lines.push('');
  } else {
    lines.push(`⚠️ **${report.summary.failedTests} test(s) failing**`);
    lines.push('');
  }

  // Suite Results
  lines.push('## Suite Results');
  lines.push('');

  for (const suite of report.suiteResults) {
    const status = suite.exitCode === 0 ? '✅' : '❌';
    lines.push(`### ${status} ${suite.name}`);
    lines.push('');
    lines.push(`- **Command**: \`${suite.command}\``);
    lines.push(`- **Duration**: ${(suite.duration / 1000).toFixed(2)}s`);
    lines.push(`- **Passed**: ${suite.passed}`);
    lines.push(`- **Failed**: ${suite.failed}`);
    lines.push(`- **Skipped**: ${suite.skipped}`);
    lines.push('');

    if (suite.failures.length > 0) {
      lines.push('**Failures**:');
      lines.push('');
      for (const failure of suite.failures) {
        lines.push(`- \`${failure.testName}\``);
        if (failure.file) {
          lines.push(`  - File: \`${failure.file}\``);
        }
        const truncatedError = failure.error.length > 200
          ? failure.error.slice(0, 200) + '...'
          : failure.error;
        lines.push(`  - Error: ${truncatedError.replace(/\n/g, ' ')}`);
      }
      lines.push('');
    }
  }

  // Issues by Component
  if (Object.keys(report.issuesByComponent).length > 0) {
    lines.push('## Issues by Component');
    lines.push('');

    for (const [component, failures] of Object.entries(report.issuesByComponent)) {
      if (failures.length === 0) continue;

      lines.push(`### ${component} (${failures.length} issue${failures.length > 1 ? 's' : ''})`);
      lines.push('');

      for (const failure of failures) {
        lines.push(`#### ${failure.testName}`);
        lines.push('');
        if (failure.file) {
          lines.push(`**File**: \`${failure.file}${failure.line ? `:${failure.line}` : ''}\``);
          lines.push('');
        }
        lines.push('**Error**:');
        lines.push('```');
        lines.push(failure.error.slice(0, 500));
        lines.push('```');
        lines.push('');
        lines.push(`**Suggested Fix**: ${extractSuggestedFix(failure)}`);
        lines.push('');

        // Add reproduction steps
        const reproSteps = failure.reproductionSteps ?? generateReproductionSteps(failure);
        if (reproSteps.length > 0) {
          lines.push('**Reproduction Steps**:');
          lines.push('');
          for (const step of reproSteps) {
            lines.push(step);
          }
          lines.push('');
        }
      }
    }
  }

  // No issues
  if (report.summary.failedTests === 0) {
    lines.push('## No Issues Found');
    lines.push('');
    lines.push('All test suites passed. The system is healthy.');
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*This report was automatically generated by the bug-report script.*');

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('\n🔍 Running Automated Bug Report Generator\n');
  console.log('═'.repeat(60));

  const suiteResults: SuiteResult[] = [];

  for (const suite of SUITES) {
    console.log(`\n📋 Running ${suite.name}...`);
    const startTime = Date.now();

    const { stdout, stderr, exitCode } = await runCommand(suite.command);
    const duration = Date.now() - startTime;
    const output = stdout + '\n' + stderr;

    let parsed: Partial<SuiteResult>;
    switch (suite.parser) {
      case 'vitest':
        parsed = parseVitestOutput(output);
        break;
      case 'playwright':
        parsed = parsePlaywrightOutput(output);
        break;
      case 'health-check':
        parsed = parseHealthCheckOutput(output, exitCode);
        break;
      default:
        parsed = { passed: 0, failed: 0, skipped: 0, failures: [] };
    }

    const result: SuiteResult = {
      name: suite.name,
      command: suite.command,
      passed: parsed.passed ?? 0,
      failed: parsed.failed ?? 0,
      skipped: parsed.skipped ?? 0,
      duration,
      failures: parsed.failures ?? [],
      exitCode,
      output,
    };

    suiteResults.push(result);

    const status = exitCode === 0 ? '✅' : '❌';
    console.log(`   ${status} ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped (${(duration / 1000).toFixed(1)}s)`);
  }

  // Categorize failures by component
  const issuesByComponent: Record<string, TestFailure[]> = {};
  for (const result of suiteResults) {
    for (const failure of result.failures) {
      const component = categorizeFailure(failure);
      if (!issuesByComponent[component]) {
        issuesByComponent[component] = [];
      }
      issuesByComponent[component].push(failure);
    }
  }

  // Build report
  const report: BugReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalSuites: suiteResults.length,
      passedSuites: suiteResults.filter((s) => s.exitCode === 0).length,
      failedSuites: suiteResults.filter((s) => s.exitCode !== 0).length,
      totalTests: suiteResults.reduce((sum, s) => sum + s.passed + s.failed + s.skipped, 0),
      passedTests: suiteResults.reduce((sum, s) => sum + s.passed, 0),
      failedTests: suiteResults.reduce((sum, s) => sum + s.failed, 0),
      skippedTests: suiteResults.reduce((sum, s) => sum + s.skipped, 0),
    },
    suiteResults,
    issuesByComponent,
  };

  // Generate markdown
  const markdown = generateMarkdownReport(report);

  // Write report
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(reportsDir, `bug-report-${dateStr}.md`);
  fs.writeFileSync(reportPath, markdown, 'utf-8');

  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('\n📊 Bug Report Summary\n');
  console.log(`   Suites: ${report.summary.passedSuites}/${report.summary.totalSuites} passed`);
  console.log(`   Tests:  ${report.summary.passedTests}/${report.summary.totalTests} passed`);
  console.log(`   Report: ${reportPath}`);

  if (report.summary.failedTests > 0) {
    console.log(`\n⚠️  ${report.summary.failedTests} test(s) failing\n`);

    // List issues by component
    for (const [component, failures] of Object.entries(issuesByComponent)) {
      if (failures.length > 0) {
        console.log(`   ${component}: ${failures.length} issue(s)`);
      }
    }
    console.log('');
  } else {
    console.log('\n✅ All tests passing!\n');
  }

  // Exit with appropriate code
  process.exit(report.summary.failedTests > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Bug report generation failed:', error);
  process.exit(1);
});
