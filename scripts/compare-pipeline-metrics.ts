#!/usr/bin/env npx tsx
/**
 * Pipeline Metrics Comparison Script
 *
 * Compares quality metrics between legacy and LangGraph pipelines
 * using the test generation results JSON files.
 *
 * Usage:
 *   npm run compare-metrics
 *   npm run compare-metrics -- --file ./data/test-generation-2026-01-16.json
 *   npm run compare-metrics -- --latest
 *
 * Prerequisites:
 *   - Run `npm run generate-test-posts` first to generate comparison data
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  index: number;
  pipeline: 'legacy' | 'langgraph';
  status: 'success' | 'rejected' | 'error';
  content: string | null;
  contentType: string;
  rewriteCount: number;
  durationMs: number;
  confidence: {
    voice: number;
    hook: number;
    topic: number;
    originality: number;
    overall: number;
  };
  error?: string;
}

interface PipelineMetrics {
  total: number;
  successes: number;
  rejections: number;
  errors: number;
  avgDurationMs: number;
  avgRewriteCount: number;
  avgConfidence: {
    voice: number;
    hook: number;
    topic: number;
    originality: number;
    overall: number;
  };
  contentTypes: Record<string, number>;
}

interface TestGenerationData {
  generatedAt: string;
  config: {
    count: number;
    legacyOnly: boolean;
    langgraphOnly: boolean;
  };
  langgraph: {
    results: TestResult[];
    metrics: PipelineMetrics | null;
  };
  legacy: {
    results: TestResult[];
    metrics: PipelineMetrics | null;
  };
}

interface ComparisonReport {
  generatedAt: string;
  sourceFile: string;
  summary: {
    legacySuccessRate: number;
    langgraphSuccessRate: number;
    successRateDiff: number;
    legacyAvgDuration: number;
    langgraphAvgDuration: number;
    durationDiff: number;
    recommendation: 'legacy' | 'langgraph' | 'equivalent';
  };
  metrics: {
    legacy: PipelineMetrics | null;
    langgraph: PipelineMetrics | null;
  };
  confidenceComparison: {
    dimension: string;
    legacy: number;
    langgraph: number;
    diff: number;
    winner: 'legacy' | 'langgraph' | 'tie';
  }[];
  qualityIndicators: {
    indicator: string;
    legacy: string;
    langgraph: string;
    assessment: string;
  }[];
  phase15Criteria: {
    criterion: string;
    target: string;
    actual: string;
    passed: boolean;
  }[];
}

function findLatestResultsFile(): string | null {
  const dataDir = './data';
  if (!fs.existsSync(dataDir)) return null;

  const files = fs.readdirSync(dataDir)
    .filter(f => f.startsWith('test-generation-') && f.endsWith('.json'))
    .sort()
    .reverse();

  return files.length > 0 ? path.join(dataDir, files[0]) : null;
}

function loadTestResults(filePath: string): TestGenerationData {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as TestGenerationData;
}

function calculateSuccessRate(metrics: PipelineMetrics | null): number {
  if (!metrics || metrics.total === 0) return 0;
  return (metrics.successes / metrics.total) * 100;
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function generateComparisonReport(data: TestGenerationData, sourceFile: string): ComparisonReport {
  const legacyMetrics = data.legacy.metrics;
  const langgraphMetrics = data.langgraph.metrics;

  const legacySuccessRate = calculateSuccessRate(legacyMetrics);
  const langgraphSuccessRate = calculateSuccessRate(langgraphMetrics);
  const successRateDiff = langgraphSuccessRate - legacySuccessRate;

  const legacyAvgDuration = legacyMetrics?.avgDurationMs ?? 0;
  const langgraphAvgDuration = langgraphMetrics?.avgDurationMs ?? 0;
  const durationDiff = langgraphAvgDuration - legacyAvgDuration;

  let recommendation: 'legacy' | 'langgraph' | 'equivalent' = 'equivalent';
  if (successRateDiff > 10 || (successRateDiff >= 0 && durationDiff < 0)) {
    recommendation = 'langgraph';
  } else if (successRateDiff < -10) {
    recommendation = 'legacy';
  }

  const confDimensions = ['voice', 'hook', 'topic', 'originality', 'overall'] as const;
  const confidenceComparison = confDimensions.map(dim => {
    const legacyVal = legacyMetrics?.avgConfidence[dim] ?? 0;
    const langgraphVal = langgraphMetrics?.avgConfidence[dim] ?? 0;
    const diff = langgraphVal - legacyVal;
    let winner: 'legacy' | 'langgraph' | 'tie' = 'tie';
    if (Math.abs(diff) > 0.05) {
      winner = diff > 0 ? 'langgraph' : 'legacy';
    }
    return {
      dimension: dim,
      legacy: Math.round(legacyVal * 100) / 100,
      langgraph: Math.round(langgraphVal * 100) / 100,
      diff: Math.round(diff * 100) / 100,
      winner,
    };
  });

  const legacyResults = data.legacy.results;
  const langgraphResults = data.langgraph.results;

  const legacyDurations = legacyResults.filter(r => r.status === 'success').map(r => r.durationMs);
  const langgraphDurations = langgraphResults.filter(r => r.status === 'success').map(r => r.durationMs);

  const qualityIndicators = [
    {
      indicator: 'Success Rate',
      legacy: `${legacySuccessRate.toFixed(1)}%`,
      langgraph: `${langgraphSuccessRate.toFixed(1)}%`,
      assessment: successRateDiff > 0 ? 'LangGraph better' : successRateDiff < 0 ? 'Legacy better' : 'Equivalent',
    },
    {
      indicator: 'Avg Duration',
      legacy: `${legacyAvgDuration}ms`,
      langgraph: `${langgraphAvgDuration}ms`,
      assessment: durationDiff < 0 ? 'LangGraph faster' : durationDiff > 0 ? 'Legacy faster' : 'Equivalent',
    },
    {
      indicator: 'Duration Std Dev',
      legacy: `${Math.round(calculateStdDev(legacyDurations))}ms`,
      langgraph: `${Math.round(calculateStdDev(langgraphDurations))}ms`,
      assessment: 'Consistency metric',
    },
    {
      indicator: 'Avg Rewrites',
      legacy: '0 (no rewrites)',
      langgraph: `${langgraphMetrics?.avgRewriteCount ?? 0}`,
      assessment: 'LangGraph self-corrects',
    },
    {
      indicator: 'Error Rate',
      legacy: `${legacyMetrics ? ((legacyMetrics.errors / legacyMetrics.total) * 100).toFixed(1) : 0}%`,
      langgraph: `${langgraphMetrics ? ((langgraphMetrics.errors / langgraphMetrics.total) * 100).toFixed(1) : 0}%`,
      assessment: 'Lower is better',
    },
    {
      indicator: 'Rejection Rate',
      legacy: `${legacyMetrics ? ((legacyMetrics.rejections / legacyMetrics.total) * 100).toFixed(1) : 0}%`,
      langgraph: `${langgraphMetrics ? ((langgraphMetrics.rejections / langgraphMetrics.total) * 100).toFixed(1) : 0}%`,
      assessment: 'Quality filtering',
    },
  ];

  const phase15Criteria = [
    {
      criterion: 'LiteLLM fallback success rate',
      target: '>99% uptime',
      actual: langgraphMetrics ? `${((langgraphMetrics.successes + langgraphMetrics.rejections) / langgraphMetrics.total * 100).toFixed(1)}% (non-error)` : 'N/A',
      passed: langgraphMetrics ? ((langgraphMetrics.successes + langgraphMetrics.rejections) / langgraphMetrics.total) >= 0.99 : false,
    },
    {
      criterion: 'Generation pipeline with cycles',
      target: 'Max 3 rewrites',
      actual: langgraphResults.length > 0 ? `Max ${Math.max(...langgraphResults.map(r => r.rewriteCount))} rewrites` : 'N/A',
      passed: langgraphResults.length === 0 || Math.max(...langgraphResults.map(r => r.rewriteCount)) <= 3,
    },
    {
      criterion: 'Stylometric validation',
      target: '80%+ first-try pass',
      actual: langgraphResults.length > 0 ? `${((langgraphResults.filter(r => r.status === 'success' && r.rewriteCount === 0).length / langgraphResults.filter(r => r.status === 'success').length) * 100).toFixed(1)}%` : 'N/A',
      passed: langgraphResults.length === 0 || (langgraphResults.filter(r => r.status === 'success' && r.rewriteCount === 0).length / Math.max(1, langgraphResults.filter(r => r.status === 'success').length)) >= 0.8,
    },
    {
      criterion: 'Overall confidence threshold',
      target: '>=0.7 avg',
      actual: langgraphMetrics ? `${langgraphMetrics.avgConfidence.overall}` : 'N/A',
      passed: langgraphMetrics ? langgraphMetrics.avgConfidence.overall >= 0.7 : false,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    sourceFile,
    summary: {
      legacySuccessRate,
      langgraphSuccessRate,
      successRateDiff,
      legacyAvgDuration,
      langgraphAvgDuration,
      durationDiff,
      recommendation,
    },
    metrics: {
      legacy: legacyMetrics,
      langgraph: langgraphMetrics,
    },
    confidenceComparison,
    qualityIndicators,
    phase15Criteria,
  };
}

function printReport(report: ComparisonReport): void {
  console.log('\n' + '═'.repeat(70));
  console.log('  PIPELINE QUALITY METRICS COMPARISON REPORT');
  console.log('═'.repeat(70));
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Source:    ${report.sourceFile}`);

  console.log('\n' + '─'.repeat(70));
  console.log('  EXECUTIVE SUMMARY');
  console.log('─'.repeat(70));
  console.log(`\n  Recommendation: ${report.summary.recommendation.toUpperCase()}`);
  console.log(`\n  Success Rate Comparison:`);
  console.log(`    Legacy:    ${report.summary.legacySuccessRate.toFixed(1)}%`);
  console.log(`    LangGraph: ${report.summary.langgraphSuccessRate.toFixed(1)}%`);
  console.log(`    Diff:      ${report.summary.successRateDiff >= 0 ? '+' : ''}${report.summary.successRateDiff.toFixed(1)}%`);
  console.log(`\n  Duration Comparison:`);
  console.log(`    Legacy:    ${report.summary.legacyAvgDuration}ms`);
  console.log(`    LangGraph: ${report.summary.langgraphAvgDuration}ms`);
  console.log(`    Diff:      ${report.summary.durationDiff >= 0 ? '+' : ''}${report.summary.durationDiff}ms`);

  console.log('\n' + '─'.repeat(70));
  console.log('  CONFIDENCE SCORES BY DIMENSION');
  console.log('─'.repeat(70));
  console.log('\n  Dimension      Legacy    LangGraph    Diff      Winner');
  console.log('  ' + '─'.repeat(58));
  for (const conf of report.confidenceComparison) {
    const dim = conf.dimension.padEnd(12);
    const leg = conf.legacy.toFixed(2).padStart(6);
    const lang = conf.langgraph.toFixed(2).padStart(9);
    const diff = (conf.diff >= 0 ? '+' : '') + conf.diff.toFixed(2);
    const winner = conf.winner.padEnd(9);
    console.log(`  ${dim}  ${leg}    ${lang}    ${diff.padStart(6)}    ${winner}`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('  QUALITY INDICATORS');
  console.log('─'.repeat(70));
  console.log('\n  Indicator         Legacy           LangGraph        Assessment');
  console.log('  ' + '─'.repeat(62));
  for (const qi of report.qualityIndicators) {
    const ind = qi.indicator.padEnd(16);
    const leg = qi.legacy.padEnd(15);
    const lang = qi.langgraph.padEnd(15);
    console.log(`  ${ind}  ${leg}  ${lang}  ${qi.assessment}`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('  PHASE 1.5 SUCCESS CRITERIA');
  console.log('─'.repeat(70));
  console.log('\n  Criterion                          Target             Actual                 Pass');
  console.log('  ' + '─'.repeat(78));
  for (const crit of report.phase15Criteria) {
    const criterion = crit.criterion.substring(0, 34).padEnd(34);
    const target = crit.target.padEnd(18);
    const actual = crit.actual.padEnd(20);
    const pass = crit.passed ? '✓' : '✗';
    console.log(`  ${criterion}  ${target}  ${actual}  ${pass}`);
  }

  const passedCount = report.phase15Criteria.filter(c => c.passed).length;
  const totalCriteria = report.phase15Criteria.length;
  console.log(`\n  Overall: ${passedCount}/${totalCriteria} criteria passed`);

  console.log('\n' + '═'.repeat(70));
  console.log('  END OF REPORT');
  console.log('═'.repeat(70) + '\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = args.find(a => a.startsWith('--file='))?.split('=')[1];
  const useLatest = args.includes('--latest') || !fileArg;

  let filePath: string | null = null;

  if (fileArg) {
    filePath = fileArg;
  } else if (useLatest) {
    filePath = findLatestResultsFile();
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error('ERROR: No test generation results found.');
    console.error('');
    console.error('Please run the test generation script first:');
    console.error('  npm run generate-test-posts');
    console.error('');
    console.error('Or specify a file directly:');
    console.error('  npm run compare-metrics -- --file ./data/test-generation-XXXX.json');
    process.exit(1);
  }

  console.log(`Loading results from: ${filePath}`);
  const data = loadTestResults(filePath);

  if (!data.legacy.metrics && !data.langgraph.metrics) {
    console.error('ERROR: No metrics data found in the results file.');
    console.error('The test generation may have failed or produced no results.');
    process.exit(1);
  }

  const report = generateComparisonReport(data, filePath);
  printReport(report);

  const reportPath = filePath.replace('.json', '-comparison.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Comparison report saved to: ${reportPath}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
