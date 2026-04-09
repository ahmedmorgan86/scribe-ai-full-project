import type { VoiceGuidelines } from './guidelines';

export interface VoiceCharacteristicsResult {
  passed: boolean;
  score: number;
  issues: VoiceIssue[];
  strengths: string[];
}

export interface VoiceIssue {
  category: 'do' | 'dont';
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestion?: string;
}

interface CheckResult {
  passed: boolean;
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestion?: string;
}

const CORPORATE_PATTERNS = [
  /\bsynergy\b/i,
  /\bleverage\b/i,
  /\bparadigm\b/i,
  /\bstakeholder\b/i,
  /\bactionable insights?\b/i,
  /\bmoving forward\b/i,
  /\bat the end of the day\b/i,
  /\bin terms of\b/i,
  /\bwith respect to\b/i,
  /\bper our discussion\b/i,
  /\bplease be advised\b/i,
  /\bit is important to note\b/i,
  /\bin this regard\b/i,
  /\bgoing forward\b/i,
  /\bplease feel free to\b/i,
];

const FILLER_PHRASES = [
  /^in this thread\b/i,
  /^here'?s? what\b/i,
  /^here'?s? why\b/i,
  /^let me explain\b/i,
  /^let'?s? explore\b/i,
  /^let'?s? dive\b/i,
  /^let'?s? break this down\b/i,
  /^let'?s? unpack\b/i,
  /^let'?s? talk about\b/i,
  /^i'?ll be explaining\b/i,
  /^today i want to\b/i,
  /^in today'?s? thread\b/i,
];

const PREACHY_PATTERNS = [
  /\byou should really\b/i,
  /\byou need to understand\b/i,
  /\bwake up\b.*\bpeople\b/i,
  /\bmost people don'?t realize\b/i,
  /\bif you'?re not doing this\b/i,
  /\bstop doing\b.*\bstart doing\b/i,
  /\bthe harsh truth is\b/i,
  /\bhard pill to swallow\b/i,
  /\bI can'?t stress this enough\b/i,
];

const HEDGE_PATTERNS = [
  /\bI think maybe\b/i,
  /\bpossibly perhaps\b/i,
  /\bI'?m not sure but\b/i,
  /\bit might possibly\b/i,
  /\bperhaps it could be\b/i,
  /\bmaybe I'?m wrong but\b/i,
  /\bI could be mistaken\b/i,
  /\bdon'?t quote me on this\b/i,
  /\bI'?m no expert but\b/i,
  /\btake this with a grain of salt\b/i,
];

const AI_PHRASES = [
  /\blet'?s? dive in\b/i,
  /\bhere'?s? the thing\b/i,
  /\bgame[- ]?changer\b/i,
  /\bmind[- ]?blowing\b/i,
  /\bunleash\b/i,
  /\bunlock your\b/i,
  /\bpro tip\b/i,
  /\bsecret sauce\b/i,
  /\bbuckle up\b/i,
  /\byou won'?t believe\b/i,
  /\bdeep dive\b/i,
  /\bhot take\b/i,
  /\bunpopular opinion\b/i,
];

function checkProblemFirst(content: string): CheckResult {
  const firstSentence = content.split(/[.!?]/)[0].trim().toLowerCase();

  const problemIndicators = [
    /\bproblem\b/,
    /\bissue\b/,
    /\bstruggl/,
    /\bfrustrat/,
    /\bpain\b/,
    /\bstuck\b/,
    /\bhard\b/,
    /\bdifficult/,
    /\btired of\b/,
    /\bwaste/,
    /\bspend.*hours?\b/,
    /\bkeep.*failing\b/,
    /\bdoesn'?t work\b/,
    /\bbroken\b/,
    /\bwhy\b/,
    /\bhow\b.*\bwithout\b/,
    /\?$/,
  ];

  const hasProblemHook = problemIndicators.some((p) => p.test(firstSentence));

  const suggestion = hasProblemHook
    ? undefined
    : "Start with the pain point or problem you're solving";

  return {
    passed: hasProblemHook,
    description: hasProblemHook ? 'Opens with problem/pain point' : 'Missing problem-first hook',
    severity: hasProblemHook ? 'low' : 'medium',
    suggestion,
  };
}

function checkDirectAddress(content: string): CheckResult {
  const youPattern = /\byou\b|\byour\b|\byou'?re\b|\byou'?ve\b|\byou'?ll\b/i;
  const hasYou = youPattern.test(content);

  return {
    passed: hasYou,
    description: hasYou ? 'Uses direct "you" address' : 'Missing direct reader address',
    severity: hasYou ? 'low' : 'low',
    suggestion: hasYou ? undefined : 'Speak directly to the reader using "you"',
  };
}

function checkConfidence(content: string): CheckResult {
  let hedgeCount = 0;
  for (const pattern of HEDGE_PATTERNS) {
    if (pattern.test(content)) {
      hedgeCount++;
    }
  }

  const passed = hedgeCount === 0;
  return {
    passed,
    description: passed
      ? 'Confident tone without over-hedging'
      : `Found ${hedgeCount} hedging pattern(s)`,
    severity: passed ? 'low' : hedgeCount > 1 ? 'high' : 'medium',
    suggestion: passed ? undefined : 'Be more confident - remove excessive qualifiers',
  };
}

function checkStructure(content: string): CheckResult {
  const hasArrow = /→/.test(content);
  const hasNumberedList = /\b[1-9][.)]\s/.test(content);
  const hasBullets = /^[-•]\s/m.test(content);
  const hasColonBreak = /:\s*\n/.test(content);

  const hasStructure = hasArrow || hasNumberedList || hasBullets || hasColonBreak;

  return {
    passed: true,
    description: hasStructure
      ? 'Uses structural elements for clarity'
      : 'No structural formatting used',
    severity: 'low',
  };
}

function checkConciseness(content: string): CheckResult {
  const words = content.split(/\s+/).length;
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  const avgWordsPerSentence = sentences > 0 ? words / sentences : 0;

  const isConcise = avgWordsPerSentence <= 25;

  return {
    passed: isConcise,
    description: isConcise
      ? 'Concise sentences'
      : `Sentences average ${Math.round(avgWordsPerSentence)} words (aim for ≤25)`,
    severity: isConcise ? 'low' : 'medium',
    suggestion: isConcise ? undefined : 'Break up long sentences for better readability',
  };
}

function checkCorporateTone(content: string): CheckResult {
  const found: string[] = [];
  for (const pattern of CORPORATE_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      found.push(match[0]);
    }
  }

  const passed = found.length === 0;
  return {
    passed,
    description: passed
      ? 'No corporate/formal language detected'
      : `Found corporate language: "${found.slice(0, 3).join('", "')}"`,
    severity: passed ? 'low' : 'high',
    suggestion: passed ? undefined : 'Replace corporate jargon with simpler, direct language',
  };
}

function checkFillerWords(content: string): CheckResult {
  const found: string[] = [];
  for (const pattern of FILLER_PHRASES) {
    const match = content.match(pattern);
    if (match) {
      found.push(match[0]);
    }
  }

  const passed = found.length === 0;
  return {
    passed,
    description: passed
      ? 'No filler phrases detected'
      : `Found filler phrases: "${found.join('", "')}"`,
    severity: passed ? 'low' : 'high',
    suggestion: passed ? undefined : 'Remove filler phrases and get straight to the point',
  };
}

function checkPreachyTone(content: string): CheckResult {
  const found: string[] = [];
  for (const pattern of PREACHY_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      found.push(match[0]);
    }
  }

  const passed = found.length === 0;
  return {
    passed,
    description: passed
      ? 'No preachy/condescending tone detected'
      : `Found preachy language: "${found.slice(0, 2).join('", "')}"`,
    severity: passed ? 'low' : 'medium',
    suggestion: passed ? undefined : 'Share information without lecturing the reader',
  };
}

function checkAIPhrases(content: string): CheckResult {
  const found: string[] = [];
  for (const pattern of AI_PHRASES) {
    const match = content.match(pattern);
    if (match) {
      found.push(match[0]);
    }
  }

  const passed = found.length === 0;
  return {
    passed,
    description: passed
      ? 'No generic AI phrases detected'
      : `Found AI-typical phrases: "${found.slice(0, 3).join('", "')}"`,
    severity: passed ? 'low' : 'high',
    suggestion: passed ? undefined : 'Replace generic AI phrases with authentic language',
  };
}

export function checkVoiceCharacteristics(
  content: string,
  _guidelines?: VoiceGuidelines
): VoiceCharacteristicsResult {
  const issues: VoiceIssue[] = [];
  const strengths: string[] = [];

  const doChecks = [
    { fn: checkProblemFirst, category: 'do' as const },
    { fn: checkDirectAddress, category: 'do' as const },
    { fn: checkConfidence, category: 'do' as const },
    { fn: checkStructure, category: 'do' as const },
    { fn: checkConciseness, category: 'do' as const },
  ];

  const dontChecks = [
    { fn: checkCorporateTone, category: 'dont' as const },
    { fn: checkFillerWords, category: 'dont' as const },
    { fn: checkPreachyTone, category: 'dont' as const },
    { fn: checkAIPhrases, category: 'dont' as const },
  ];

  let totalScore = 0;
  let maxScore = 0;

  for (const { fn, category } of doChecks) {
    const result = fn(content);
    const weight = result.severity === 'high' ? 20 : result.severity === 'medium' ? 15 : 10;
    maxScore += weight;

    if (result.passed) {
      totalScore += weight;
      strengths.push(result.description);
    } else {
      issues.push({
        category,
        description: result.description,
        severity: result.severity,
        suggestion: result.suggestion,
      });
    }
  }

  for (const { fn, category } of dontChecks) {
    const result = fn(content);
    const weight = result.severity === 'high' ? 25 : result.severity === 'medium' ? 15 : 10;
    maxScore += weight;

    if (result.passed) {
      totalScore += weight;
      strengths.push(result.description);
    } else {
      issues.push({
        category,
        description: result.description,
        severity: result.severity,
        suggestion: result.suggestion,
      });
    }
  }

  const score = Math.round((totalScore / maxScore) * 100);
  const hasHighSeverityIssue = issues.some((i) => i.severity === 'high');
  const passed = score >= 70 && !hasHighSeverityIssue;

  return {
    passed,
    score,
    issues,
    strengths,
  };
}

export function formatVoiceCheckReport(result: VoiceCharacteristicsResult): string {
  const lines: string[] = [];

  lines.push(`Voice Check: ${result.passed ? 'PASSED' : 'FAILED'} (${result.score}%)`);
  lines.push('');

  if (result.strengths.length > 0) {
    lines.push('Strengths:');
    for (const strength of result.strengths) {
      lines.push(`  ✓ ${strength}`);
    }
  }

  if (result.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of result.issues) {
      const severity = issue.severity === 'high' ? '⚠' : issue.severity === 'medium' ? '!' : '·';
      lines.push(`  ${severity} [${issue.category.toUpperCase()}] ${issue.description}`);
      if (issue.suggestion) {
        lines.push(`    → ${issue.suggestion}`);
      }
    }
  }

  return lines.join('\n');
}
