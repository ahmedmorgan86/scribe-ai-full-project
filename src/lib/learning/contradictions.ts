import type { PatternType } from '@/types';
import { listPatterns } from '@/db/models/patterns';
import { findSimilarPatterns, type StoredPattern } from './patterns';

export interface DetectedContradiction {
  patternA: ContradictingPattern;
  patternB: ContradictingPattern;
  contradictionType: ContradictionType;
  severity: 'high' | 'medium' | 'low';
  explanation: string;
}

export interface ContradictingPattern {
  id?: number;
  type: PatternType;
  description: string;
  evidenceCount: number;
  isNew: boolean;
}

export type ContradictionType = 'direct_opposite' | 'implicit_conflict' | 'scope_overlap';

export interface ContradictionCheckResult {
  hasContradictions: boolean;
  contradictions: DetectedContradiction[];
  requiresClarification: boolean;
}

export interface ContradictionCheckOptions {
  includeTypes?: PatternType[];
  minEvidenceToConsider?: number;
  checkNewPattern?: {
    type: PatternType;
    description: string;
  };
}

const OPPOSITE_PATTERN_PAIRS: [RegExp, RegExp][] = [
  [/\buse\b/i, /\bavoid\b/i],
  [/\bshort\b/i, /\blong\b/i],
  [/\bstart with\b/i, /\bdon't start with\b|never start with/i],
  [/\binclude\b/i, /\bexclude\b|don't include/i],
  [/\bmore\b/i, /\bless\b|fewer/i],
  [/\bformal\b/i, /\binformal\b|casual/i],
  [/\bdirect\b/i, /\bindirect\b|subtle/i],
  [/\bspecific\b/i, /\bgeneral\b|vague/i],
  [/\bquestions?\b/i, /\bno questions?\b|avoid questions?/i],
];

const IMPLICIT_CONFLICT_PATTERNS: {
  pattern1: RegExp;
  pattern2: RegExp;
  explanation: string;
}[] = [
  {
    pattern1: /\bconcise\b|brief\b|short\b/i,
    pattern2: /\bdetail(ed)?\b|comprehensive\b|thorough\b/i,
    explanation: 'Conciseness conflicts with comprehensiveness',
  },
  {
    pattern1: /\bproblem.?first\b|start.+problem/i,
    pattern2: /\bsolution.?first\b|start.+solution/i,
    explanation: 'Problem-first conflicts with solution-first framing',
  },
  {
    pattern1: /\bdirect address\b|use.+"you"/i,
    pattern2: /\bthird.?person\b|avoid.+"you"/i,
    explanation: 'Direct address conflicts with third-person style',
  },
  {
    pattern1: /\bemoji\b.*\buse\b|\buse\b.*\bemoji/i,
    pattern2: /\bno emoji\b|\bavoid emoji/i,
    explanation: 'Emoji usage conflicts with no-emoji rule',
  },
];

function extractKeyTerms(description: string): string[] {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'and',
    'or',
    'but',
  ]);
  return description
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

function checkDirectOpposite(desc1: string, desc2: string): boolean {
  for (const [pattern1, pattern2] of OPPOSITE_PATTERN_PAIRS) {
    if (
      (pattern1.test(desc1) && pattern2.test(desc2)) ||
      (pattern2.test(desc1) && pattern1.test(desc2))
    ) {
      const terms1 = extractKeyTerms(desc1);
      const terms2 = extractKeyTerms(desc2);
      const commonTerms = terms1.filter((t) => terms2.includes(t));
      if (commonTerms.length >= 1) {
        return true;
      }
    }
  }
  return false;
}

function checkImplicitConflict(
  desc1: string,
  desc2: string
): { conflicts: boolean; explanation: string } {
  for (const { pattern1, pattern2, explanation } of IMPLICIT_CONFLICT_PATTERNS) {
    if (
      (pattern1.test(desc1) && pattern2.test(desc2)) ||
      (pattern2.test(desc1) && pattern1.test(desc2))
    ) {
      return { conflicts: true, explanation };
    }
  }
  return { conflicts: false, explanation: '' };
}

function checkScopeOverlap(
  desc1: string,
  desc2: string,
  type1: PatternType,
  type2: PatternType
): boolean {
  if (type1 !== type2) {
    return false;
  }

  const terms1 = extractKeyTerms(desc1);
  const terms2 = extractKeyTerms(desc2);
  const commonTerms = terms1.filter((t) => terms2.includes(t));
  const overlapRatio = commonTerms.length / Math.min(terms1.length, terms2.length);

  if (overlapRatio < 0.5) {
    return false;
  }

  const hasNegation1 = /\bdon't\b|\bnot\b|\bnever\b|\bavoid\b|\bno\b/i.test(desc1);
  const hasNegation2 = /\bdon't\b|\bnot\b|\bnever\b|\bavoid\b|\bno\b/i.test(desc2);

  return hasNegation1 !== hasNegation2;
}

function determineSeverity(
  patternA: ContradictingPattern,
  patternB: ContradictingPattern,
  contradictionType: ContradictionType
): 'high' | 'medium' | 'low' {
  const totalEvidence = patternA.evidenceCount + patternB.evidenceCount;

  if (contradictionType === 'direct_opposite' && totalEvidence >= 4) {
    return 'high';
  }

  if (patternA.isNew || patternB.isNew) {
    return 'medium';
  }

  if (totalEvidence >= 6 || contradictionType === 'direct_opposite') {
    return 'high';
  }

  if (totalEvidence >= 3 || contradictionType === 'implicit_conflict') {
    return 'medium';
  }

  return 'low';
}

function buildExplanation(
  patternA: ContradictingPattern,
  patternB: ContradictingPattern,
  contradictionType: ContradictionType,
  implicitExplanation?: string
): string {
  const typeLabel = {
    direct_opposite: 'directly contradicts',
    implicit_conflict: 'implicitly conflicts with',
    scope_overlap: 'overlaps in scope with opposite intent from',
  }[contradictionType];

  let explanation = `Pattern "${patternA.description}" ${typeLabel} "${patternB.description}"`;

  if (implicitExplanation) {
    explanation += `. ${implicitExplanation}`;
  }

  if (!patternA.isNew && !patternB.isNew) {
    explanation += `. Both have accumulated evidence (${patternA.evidenceCount} vs ${patternB.evidenceCount}).`;
  } else if (patternA.isNew) {
    explanation += `. New pattern conflicts with established pattern (${patternB.evidenceCount} evidence).`;
  } else if (patternB.isNew) {
    explanation += `. New pattern conflicts with established pattern (${patternA.evidenceCount} evidence).`;
  }

  return explanation;
}

export function detectContradictionBetweenPatterns(
  patternA: ContradictingPattern,
  patternB: ContradictingPattern
): DetectedContradiction | null {
  const desc1 = patternA.description;
  const desc2 = patternB.description;

  if (checkDirectOpposite(desc1, desc2)) {
    const severity = determineSeverity(patternA, patternB, 'direct_opposite');
    return {
      patternA,
      patternB,
      contradictionType: 'direct_opposite',
      severity,
      explanation: buildExplanation(patternA, patternB, 'direct_opposite'),
    };
  }

  const implicitResult = checkImplicitConflict(desc1, desc2);
  if (implicitResult.conflicts) {
    const severity = determineSeverity(patternA, patternB, 'implicit_conflict');
    return {
      patternA,
      patternB,
      contradictionType: 'implicit_conflict',
      severity,
      explanation: buildExplanation(
        patternA,
        patternB,
        'implicit_conflict',
        implicitResult.explanation
      ),
    };
  }

  if (checkScopeOverlap(desc1, desc2, patternA.type, patternB.type)) {
    const severity = determineSeverity(patternA, patternB, 'scope_overlap');
    return {
      patternA,
      patternB,
      contradictionType: 'scope_overlap',
      severity,
      explanation: buildExplanation(patternA, patternB, 'scope_overlap'),
    };
  }

  return null;
}

export function checkForContradictions(
  options: ContradictionCheckOptions = {}
): ContradictionCheckResult {
  const {
    includeTypes = ['voice', 'hook', 'topic', 'rejection', 'edit'],
    minEvidenceToConsider = 1,
    checkNewPattern,
  } = options;

  const contradictions: DetectedContradiction[] = [];

  const existingPatterns: StoredPattern[] = [];
  for (const patternType of includeTypes) {
    const patterns = listPatterns({
      patternType,
      minEvidenceCount: minEvidenceToConsider,
      limit: 100,
    });
    for (const p of patterns) {
      existingPatterns.push({
        id: p.id,
        type: p.patternType,
        description: p.description,
        evidenceCount: p.evidenceCount,
        editEvidenceCount: p.editEvidenceCount,
        rejectionEvidenceCount: p.rejectionEvidenceCount,
        lastAccessedAt: p.lastAccessedAt,
        accessCount: p.accessCount,
        decayScore: p.decayScore,
        status: p.status,
        weightedScore: p.editEvidenceCount * 3 + p.rejectionEvidenceCount * 1,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    }
  }

  if (checkNewPattern) {
    const newPatternContradicting: ContradictingPattern = {
      type: checkNewPattern.type,
      description: checkNewPattern.description,
      evidenceCount: 1,
      isNew: true,
    };

    for (const existing of existingPatterns) {
      const existingContradicting: ContradictingPattern = {
        id: existing.id,
        type: existing.type,
        description: existing.description,
        evidenceCount: existing.evidenceCount,
        isNew: false,
      };

      const contradiction = detectContradictionBetweenPatterns(
        newPatternContradicting,
        existingContradicting
      );
      if (contradiction) {
        contradictions.push(contradiction);
      }
    }
  }

  for (let i = 0; i < existingPatterns.length; i++) {
    for (let j = i + 1; j < existingPatterns.length; j++) {
      const patternA: ContradictingPattern = {
        id: existingPatterns[i].id,
        type: existingPatterns[i].type,
        description: existingPatterns[i].description,
        evidenceCount: existingPatterns[i].evidenceCount,
        isNew: false,
      };

      const patternB: ContradictingPattern = {
        id: existingPatterns[j].id,
        type: existingPatterns[j].type,
        description: existingPatterns[j].description,
        evidenceCount: existingPatterns[j].evidenceCount,
        isNew: false,
      };

      const contradiction = detectContradictionBetweenPatterns(patternA, patternB);
      if (contradiction) {
        contradictions.push(contradiction);
      }
    }
  }

  const requiresClarification = contradictions.some(
    (c) => c.severity === 'high' || c.severity === 'medium'
  );

  return {
    hasContradictions: contradictions.length > 0,
    contradictions,
    requiresClarification,
  };
}

export function checkNewPatternForContradictions(
  newPatternType: PatternType,
  newPatternDescription: string
): ContradictionCheckResult {
  const similarPatterns = findSimilarPatterns(newPatternDescription, newPatternType, 0.3);

  const contradictions: DetectedContradiction[] = [];

  const newPattern: ContradictingPattern = {
    type: newPatternType,
    description: newPatternDescription,
    evidenceCount: 1,
    isNew: true,
  };

  for (const match of similarPatterns) {
    const existingPattern: ContradictingPattern = {
      id: match.pattern.id,
      type: match.pattern.type,
      description: match.pattern.description,
      evidenceCount: match.pattern.evidenceCount,
      isNew: false,
    };

    const contradiction = detectContradictionBetweenPatterns(newPattern, existingPattern);
    if (contradiction) {
      contradictions.push(contradiction);
    }
  }

  const requiresClarification = contradictions.some(
    (c) => c.severity === 'high' || c.severity === 'medium'
  );

  return {
    hasContradictions: contradictions.length > 0,
    contradictions,
    requiresClarification,
  };
}

export function getHighSeverityContradictions(
  result: ContradictionCheckResult
): DetectedContradiction[] {
  return result.contradictions.filter((c) => c.severity === 'high');
}

export function getContradictionSummary(result: ContradictionCheckResult): string {
  if (!result.hasContradictions) {
    return 'No contradictions detected.';
  }

  const highCount = result.contradictions.filter((c) => c.severity === 'high').length;
  const mediumCount = result.contradictions.filter((c) => c.severity === 'medium').length;
  const lowCount = result.contradictions.filter((c) => c.severity === 'low').length;

  const parts: string[] = [];
  parts.push(`Found ${result.contradictions.length} contradiction(s)`);

  const severityParts: string[] = [];
  if (highCount > 0) severityParts.push(`${highCount} high`);
  if (mediumCount > 0) severityParts.push(`${mediumCount} medium`);
  if (lowCount > 0) severityParts.push(`${lowCount} low`);

  if (severityParts.length > 0) {
    parts.push(`(${severityParts.join(', ')})`);
  }

  if (result.requiresClarification) {
    parts.push('- clarification required');
  }

  return parts.join(' ');
}

export function formatContradictionsForPrompt(contradictions: DetectedContradiction[]): string {
  if (contradictions.length === 0) {
    return '';
  }

  const lines: string[] = ['## Detected Contradictions', ''];

  for (const contradiction of contradictions) {
    const typeLabel = contradiction.contradictionType.replace('_', ' ');
    lines.push(`### ${typeLabel} (${contradiction.severity})`);
    lines.push(`- Pattern A: "${contradiction.patternA.description}"`);
    lines.push(`- Pattern B: "${contradiction.patternB.description}"`);
    lines.push(`- Explanation: ${contradiction.explanation}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatContradictionCheckResult(result: ContradictionCheckResult): string {
  const lines: string[] = [];

  lines.push('=== Contradiction Check Result ===');
  lines.push(`Contradictions found: ${result.hasContradictions ? 'Yes' : 'No'}`);
  lines.push(`Total: ${result.contradictions.length}`);
  lines.push(`Requires clarification: ${result.requiresClarification ? 'Yes' : 'No'}`);

  if (result.contradictions.length > 0) {
    lines.push('');
    lines.push('Details:');
    for (const c of result.contradictions) {
      lines.push(`  [${c.severity.toUpperCase()}] ${c.contradictionType}`);
      lines.push(`    A: ${c.patternA.description}`);
      lines.push(`    B: ${c.patternB.description}`);
    }
  }

  return lines.join('\n');
}

export interface ClarificationRequest {
  question: string;
  context: string;
  options: string[];
  contradiction: DetectedContradiction;
  priority: 'high' | 'medium' | 'low';
}

export interface ClarificationGenerationResult {
  clarifications: ClarificationRequest[];
  totalContradictions: number;
  requiresUserInput: boolean;
}

function generateQuestionForContradiction(contradiction: DetectedContradiction): string {
  const { patternA, patternB, contradictionType } = contradiction;

  switch (contradictionType) {
    case 'direct_opposite':
      return `Which approach should I follow: "${patternA.description}" OR "${patternB.description}"?`;

    case 'implicit_conflict':
      return `These patterns seem to conflict. Which should take priority: "${patternA.description}" or "${patternB.description}"?`;

    case 'scope_overlap':
      return `For similar content, should I: "${patternA.description}" or "${patternB.description}"?`;

    default:
      return `How should I reconcile: "${patternA.description}" vs "${patternB.description}"?`;
  }
}

function generateContextForContradiction(contradiction: DetectedContradiction): string {
  const { patternA, patternB, contradictionType, explanation } = contradiction;
  const parts: string[] = [];

  parts.push(explanation);

  if (!patternA.isNew && !patternB.isNew) {
    parts.push(
      `Both patterns are established: "${patternA.description}" (${patternA.evidenceCount} evidence) and "${patternB.description}" (${patternB.evidenceCount} evidence).`
    );
  } else if (patternA.isNew) {
    parts.push(
      `New feedback suggests "${patternA.description}" but this conflicts with established pattern "${patternB.description}" (${patternB.evidenceCount} evidence).`
    );
  } else if (patternB.isNew) {
    parts.push(
      `New feedback suggests "${patternB.description}" but this conflicts with established pattern "${patternA.description}" (${patternA.evidenceCount} evidence).`
    );
  }

  if (contradictionType === 'direct_opposite') {
    parts.push('These patterns are directly opposite and cannot both be followed.');
  } else if (contradictionType === 'implicit_conflict') {
    parts.push('These patterns may work in different contexts. Please clarify when to use each.');
  } else if (contradictionType === 'scope_overlap') {
    parts.push('These patterns apply to similar content but suggest opposite approaches.');
  }

  return parts.join(' ');
}

function generateOptionsForContradiction(contradiction: DetectedContradiction): string[] {
  const { patternA, patternB, contradictionType } = contradiction;
  const options: string[] = [];

  options.push(`Always follow: "${patternA.description}"`);
  options.push(`Always follow: "${patternB.description}"`);

  if (contradictionType === 'implicit_conflict' || contradictionType === 'scope_overlap') {
    options.push('Use both depending on context (please specify when each applies)');
  }

  options.push('Neither - remove both patterns');

  return options;
}

export function generateClarificationRequest(
  contradiction: DetectedContradiction
): ClarificationRequest {
  return {
    question: generateQuestionForContradiction(contradiction),
    context: generateContextForContradiction(contradiction),
    options: generateOptionsForContradiction(contradiction),
    contradiction,
    priority: contradiction.severity,
  };
}

export function generateClarificationRequests(
  result: ContradictionCheckResult
): ClarificationGenerationResult {
  if (!result.hasContradictions) {
    return {
      clarifications: [],
      totalContradictions: 0,
      requiresUserInput: false,
    };
  }

  const clarifiableContradictions = result.contradictions.filter(
    (c) => c.severity === 'high' || c.severity === 'medium'
  );

  const clarifications = clarifiableContradictions
    .map(generateClarificationRequest)
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

  return {
    clarifications,
    totalContradictions: result.contradictions.length,
    requiresUserInput: clarifications.length > 0,
  };
}

export function generateClarificationsFromContradictions(
  contradictions: DetectedContradiction[]
): ClarificationRequest[] {
  return contradictions
    .filter((c) => c.severity === 'high' || c.severity === 'medium')
    .map(generateClarificationRequest)
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
}

export function formatClarificationRequest(clarification: ClarificationRequest): string {
  const lines: string[] = [];

  lines.push(`## Clarification Needed [${clarification.priority.toUpperCase()}]`);
  lines.push('');
  lines.push(`**Question:** ${clarification.question}`);
  lines.push('');
  lines.push(`**Context:** ${clarification.context}`);
  lines.push('');
  lines.push('**Options:**');
  clarification.options.forEach((option, i) => {
    lines.push(`${i + 1}. ${option}`);
  });

  return lines.join('\n');
}

export function formatClarificationRequests(clarifications: ClarificationRequest[]): string {
  if (clarifications.length === 0) {
    return 'No clarifications needed.';
  }

  const lines: string[] = [];
  lines.push('# Clarification Requests');
  lines.push('');
  lines.push(`Found ${clarifications.length} contradiction(s) requiring clarification.`);
  lines.push('');

  for (const clarification of clarifications) {
    lines.push(formatClarificationRequest(clarification));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export function formatClarificationGenerationResult(result: ClarificationGenerationResult): string {
  const lines: string[] = [];

  lines.push('=== Clarification Generation Result ===');
  lines.push(`Total contradictions: ${result.totalContradictions}`);
  lines.push(`Clarifications generated: ${result.clarifications.length}`);
  lines.push(`Requires user input: ${result.requiresUserInput ? 'Yes' : 'No'}`);

  if (result.clarifications.length > 0) {
    lines.push('');
    lines.push('Questions by priority:');

    const highPriority = result.clarifications.filter((c) => c.priority === 'high');
    const mediumPriority = result.clarifications.filter((c) => c.priority === 'medium');

    if (highPriority.length > 0) {
      lines.push(`  HIGH (${highPriority.length}):`);
      for (const c of highPriority) {
        lines.push(`    - ${c.question}`);
      }
    }

    if (mediumPriority.length > 0) {
      lines.push(`  MEDIUM (${mediumPriority.length}):`);
      for (const c of mediumPriority) {
        lines.push(`    - ${c.question}`);
      }
    }
  }

  return lines.join('\n');
}
