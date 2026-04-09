import type { PatternType } from '@/types';
import { listFeedback } from '@/db/models/feedback';
import { createPattern, incrementEvidenceCount, listPatterns } from '@/db/models/patterns';
import { trackedCompletion } from '@/lib/anthropic/cost-tracking';

export interface EditDiff {
  feedbackId: number;
  postId: number;
  before: string;
  after: string;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'addition' | 'deletion' | 'replacement';
  before: string;
  after: string;
  position: number;
}

export interface InferredPreference {
  type: PatternType;
  description: string;
  confidence: number;
  evidence: string[];
  changeType: 'addition' | 'deletion' | 'replacement' | 'structural';
}

export interface EditDiffAnalysisResult {
  editsAnalyzed: number;
  preferencesInferred: number;
  patternsCreated: number;
  patternsReinforced: number;
  preferences: InferredPreference[];
  costUsd: number;
  success: boolean;
  error?: string;
}

export interface EditDiffAnalysisOptions {
  minEditsForAnalysis?: number;
  afterDate?: string;
  limit?: number;
}

const MIN_EDITS_FOR_ANALYSIS = 3;
const SIMILARITY_THRESHOLD = 0.5;

export function collectEditDiffs(options: { limit?: number; afterDate?: string }): EditDiff[] {
  const { limit = 100, afterDate } = options;

  const editFeedback = listFeedback({
    action: 'edit',
    limit,
    orderDir: 'desc',
  });

  const diffs: EditDiff[] = [];

  for (const feedback of editFeedback) {
    if (afterDate && feedback.createdAt <= afterDate) {
      continue;
    }

    if (!feedback.diffBefore || !feedback.diffAfter) {
      continue;
    }

    const changes = computeDiffChanges(feedback.diffBefore, feedback.diffAfter);

    diffs.push({
      feedbackId: feedback.id,
      postId: feedback.postId,
      before: feedback.diffBefore,
      after: feedback.diffAfter,
      changes,
    });
  }

  return diffs;
}

export function computeDiffChanges(before: string, after: string): DiffChange[] {
  const changes: DiffChange[] = [];

  const beforeWords = tokenize(before);
  const afterWords = tokenize(after);

  const lcs = longestCommonSubsequence(beforeWords, afterWords);

  let beforeIdx = 0;
  let afterIdx = 0;
  let lcsIdx = 0;
  let position = 0;

  while (beforeIdx < beforeWords.length || afterIdx < afterWords.length) {
    const lcsInBounds = lcsIdx < lcs.length;
    const beforeMatchesLcs = beforeWords[beforeIdx] === lcs[lcsIdx];
    const afterMatchesLcs = afterWords[afterIdx] === lcs[lcsIdx];

    if (lcsInBounds && beforeMatchesLcs && afterMatchesLcs) {
      beforeIdx++;
      afterIdx++;
      lcsIdx++;
      position++;
    } else {
      const deletedWords: string[] = [];
      while (
        beforeIdx < beforeWords.length &&
        (lcsIdx >= lcs.length || beforeWords[beforeIdx] !== lcs[lcsIdx])
      ) {
        deletedWords.push(beforeWords[beforeIdx]);
        beforeIdx++;
      }

      const addedWords: string[] = [];
      while (
        afterIdx < afterWords.length &&
        (lcsIdx >= lcs.length || afterWords[afterIdx] !== lcs[lcsIdx])
      ) {
        addedWords.push(afterWords[afterIdx]);
        afterIdx++;
      }

      if (deletedWords.length > 0 && addedWords.length > 0) {
        changes.push({
          type: 'replacement',
          before: deletedWords.join(' '),
          after: addedWords.join(' '),
          position,
        });
      } else if (deletedWords.length > 0) {
        changes.push({
          type: 'deletion',
          before: deletedWords.join(' '),
          after: '',
          position,
        });
      } else if (addedWords.length > 0) {
        changes.push({
          type: 'addition',
          before: '',
          after: addedWords.join(' '),
          position,
        });
      }

      position += Math.max(deletedWords.length, addedWords.length);
    }
  }

  return changes;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array<number>(n + 1).fill(0);
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

export function categorizeChange(change: DiffChange): string {
  const beforeLower = change.before.toLowerCase();
  const afterLower = change.after.toLowerCase();

  if (change.type === 'deletion') {
    if (containsFillerWords(beforeLower)) {
      return 'removed_filler';
    }
    if (containsHedgingWords(beforeLower)) {
      return 'removed_hedging';
    }
    if (containsGenericPhrases(beforeLower)) {
      return 'removed_generic_phrase';
    }
    return 'removed_content';
  }

  if (change.type === 'addition') {
    if (containsSpecificDetails(afterLower)) {
      return 'added_specificity';
    }
    if (containsDirectAddress(afterLower)) {
      return 'added_direct_address';
    }
    if (containsHook(afterLower)) {
      return 'added_hook';
    }
    return 'added_content';
  }

  if (change.type === 'replacement') {
    if (isWeakerToStronger(beforeLower, afterLower)) {
      return 'strengthened_language';
    }
    if (isVagueToSpecific(beforeLower, afterLower)) {
      return 'increased_specificity';
    }
    if (isLongToShort(change.before, change.after)) {
      return 'condensed';
    }
    if (isGenericToPersonal(beforeLower, afterLower)) {
      return 'personalized';
    }
    return 'general_replacement';
  }

  return 'unknown';
}

const FILLER_WORDS = [
  'basically',
  'essentially',
  'literally',
  'honestly',
  'actually',
  'obviously',
  'clearly',
  'really',
  'very',
  'just',
  'simply',
  'definitely',
  'certainly',
  'absolutely',
];

const HEDGING_WORDS = [
  'maybe',
  'perhaps',
  'might',
  'could be',
  'sort of',
  'kind of',
  'somewhat',
  'fairly',
  'rather',
  'seems like',
  'i think',
  'i believe',
  'in my opinion',
  'possibly',
];

const GENERIC_PHRASES = [
  "let's dive in",
  "here's the thing",
  'at the end of the day',
  'game changer',
  'game-changer',
  'next level',
  'take it to the next level',
  'circle back',
  'touch base',
  'low-hanging fruit',
  'best practice',
  'best practices',
  'deep dive',
  'level up',
  'move the needle',
  'unpack',
];

function containsFillerWords(text: string): boolean {
  return FILLER_WORDS.some((filler) => text.includes(filler));
}

function containsHedgingWords(text: string): boolean {
  return HEDGING_WORDS.some((hedge) => text.includes(hedge));
}

function containsGenericPhrases(text: string): boolean {
  return GENERIC_PHRASES.some((phrase) => text.includes(phrase));
}

function containsSpecificDetails(text: string): boolean {
  const hasNumbers = /\d+/.test(text);
  const hasPercentages = /%|percent/.test(text);
  const hasSpecificTerms = /\b(api|sdk|cli|json|sql|http|css|js|ts|react|node)\b/i.test(text);
  return hasNumbers || hasPercentages || hasSpecificTerms;
}

function containsDirectAddress(text: string): boolean {
  return /\byou\b|\byour\b|\byou're\b|\byou'll\b/i.test(text);
}

function containsHook(text: string): boolean {
  return /^(stop|don't|never|why|how|what if|imagine|remember when|the problem|most people)/i.test(
    text
  );
}

function isWeakerToStronger(before: string, after: string): boolean {
  const weakWords = ['good', 'nice', 'okay', 'fine', 'decent'];
  const strongWords = ['great', 'excellent', 'powerful', 'essential', 'critical', 'game-changing'];
  const beforeHasWeak = weakWords.some((w) => before.includes(w));
  const afterHasStrong = strongWords.some((w) => after.includes(w));
  return beforeHasWeak && afterHasStrong;
}

function isVagueToSpecific(before: string, after: string): boolean {
  const vagueWords = ['thing', 'stuff', 'something', 'someone', 'somewhere', 'it', 'they'];
  const beforeHasVague = vagueWords.some((w) => before.includes(w));
  const afterHasSpecific = containsSpecificDetails(after) || after.length > before.length * 1.5;
  return beforeHasVague && afterHasSpecific;
}

function isLongToShort(before: string, after: string): boolean {
  return before.length > after.length * 1.3;
}

function isGenericToPersonal(before: string, after: string): boolean {
  const genericPatterns = ['people', 'developers', 'users', 'everyone', 'anyone'];
  const personalPatterns = ['i ', 'my ', 'we ', "i've", "i'm", 'our '];
  const beforeHasGeneric = genericPatterns.some((p) => before.includes(p));
  const afterHasPersonal = personalPatterns.some((p) => after.includes(p));
  return beforeHasGeneric && afterHasPersonal;
}

export function aggregateChangePatterns(diffs: EditDiff[]): Map<string, number> {
  const patterns = new Map<string, number>();

  for (const diff of diffs) {
    for (const change of diff.changes) {
      const category = categorizeChange(change);
      const currentCount = patterns.get(category);
      patterns.set(category, (currentCount ?? 0) + 1);
    }
  }

  return patterns;
}

function buildEditAnalysisPrompt(diffs: EditDiff[]): string {
  const examples = diffs.slice(0, 10).map((diff, idx) => {
    const changesDesc = diff.changes.map((c) => {
      if (c.type === 'replacement') {
        return `  - Changed "${c.before}" → "${c.after}"`;
      } else if (c.type === 'deletion') {
        return `  - Removed "${c.before}"`;
      } else {
        return `  - Added "${c.after}"`;
      }
    });
    return `Example ${idx + 1}:\nBefore: "${diff.before}"\nAfter: "${diff.after}"\nChanges:\n${changesDesc.join('\n')}`;
  });

  return examples.join('\n\n');
}

export async function analyzeEditDiffsWithLlm(
  diffs: EditDiff[],
  aggregatedPatterns: Map<string, number>
): Promise<{ preferences: InferredPreference[]; costUsd: number }> {
  const systemPrompt = `You are analyzing user edits to AI-generated content to infer their preferences.

Your task is to identify PATTERNS in what the user changes, and infer WHY they make those changes.

Focus on:
1. What types of content does the user consistently remove?
2. What types of content does the user consistently add?
3. What language/tone changes does the user make?
4. What structural changes does the user prefer?

Output JSON with this structure:
{
  "preferences": [
    {
      "type": "voice|hook|topic|edit",
      "description": "Clear description of the preference pattern",
      "confidence": 50-100,
      "evidence": ["specific example from edits"],
      "changeType": "addition|deletion|replacement|structural"
    }
  ]
}

Rules:
- Only include preferences with confidence >= 60%
- Each preference must be supported by at least 2 examples
- Be specific about what the user prefers, not vague
- Focus on actionable patterns that can improve future content generation`;

  const aggregatedStr = Array.from(aggregatedPatterns.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([pattern, count]) => `${pattern}: ${count} occurrences`)
    .join('\n');

  const userPrompt = `Analyze these user edits to infer their content preferences.

## Aggregated Change Patterns
${aggregatedStr}

## Edit Examples
${buildEditAnalysisPrompt(diffs)}

Based on these edits, what are the user's content preferences? Return JSON.`;

  const result = await trackedCompletion(userPrompt, {
    model: 'sonnet',
    systemPrompt,
    maxTokens: 2048,
    temperature: 0.3,
  });

  const preferences = parsePreferencesResponse(result.content);

  return {
    preferences,
    costUsd: result.costUsd,
  };
}

function parsePreferencesResponse(content: string): InferredPreference[] {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as { preferences?: unknown[] };
    if (!parsed.preferences || !Array.isArray(parsed.preferences)) {
      return [];
    }

    return parsed.preferences
      .filter((p): p is Record<string, unknown> => {
        if (typeof p !== 'object' || p === null) return false;
        const pref = p as Record<string, unknown>;
        return (
          typeof pref.type === 'string' &&
          typeof pref.description === 'string' &&
          typeof pref.confidence === 'number' &&
          Array.isArray(pref.evidence)
        );
      })
      .filter((p) => (p.confidence as number) >= 60)
      .map((p) => {
        const evidenceArr = p.evidence as unknown[];
        const filteredEvidence = evidenceArr.filter((e): e is string => typeof e === 'string');
        const changeTypeValue = p.changeType as InferredPreference['changeType'] | undefined;
        return {
          type: p.type as PatternType,
          description: p.description as string,
          confidence: p.confidence as number,
          evidence: filteredEvidence,
          changeType: changeTypeValue ?? 'replacement',
        };
      });
  } catch {
    return [];
  }
}

function findSimilarEditPattern(
  preference: InferredPreference,
  existingPatterns: { type: string; description: string }[]
): { type: string; description: string } | null {
  const normalizedDesc = preference.description.toLowerCase();

  for (const pattern of existingPatterns) {
    if (pattern.type !== preference.type) {
      continue;
    }

    const existingNormalized = pattern.description.toLowerCase();
    const prefWords = new Set(normalizedDesc.split(/\s+/).filter((w) => w.length > 3));
    const existingWords = new Set(existingNormalized.split(/\s+/).filter((w) => w.length > 3));

    const intersection = [...prefWords].filter((w) => existingWords.has(w));
    const union = new Set([...prefWords, ...existingWords]);

    const similarity = intersection.length / union.size;
    if (similarity >= SIMILARITY_THRESHOLD) {
      return pattern;
    }
  }

  return null;
}

export function storeInferredPreferences(preferences: InferredPreference[]): {
  created: number;
  reinforced: number;
} {
  let created = 0;
  let reinforced = 0;

  const existingPatterns = listPatterns({ limit: 500 });
  const existingForComparison = existingPatterns.map((p) => ({
    id: p.id,
    type: p.patternType,
    description: p.description,
  }));

  for (const preference of preferences) {
    const similar = findSimilarEditPattern(preference, existingForComparison);

    if (similar) {
      const dbPattern = existingPatterns.find(
        (p) => p.patternType === similar.type && p.description === similar.description
      );
      if (dbPattern) {
        incrementEvidenceCount(dbPattern.id);
        reinforced++;
      }
    } else {
      createPattern({
        patternType: preference.type,
        description: preference.description,
        evidenceCount: preference.evidence.length,
      });
      created++;

      existingForComparison.push({
        id: -1,
        type: preference.type,
        description: preference.description,
      });
    }
  }

  return { created, reinforced };
}

export async function analyzeEditDiffs(
  options: EditDiffAnalysisOptions = {}
): Promise<EditDiffAnalysisResult> {
  const { minEditsForAnalysis = MIN_EDITS_FOR_ANALYSIS, afterDate, limit = 100 } = options;

  try {
    const diffs = collectEditDiffs({ limit, afterDate });

    if (diffs.length < minEditsForAnalysis) {
      return {
        editsAnalyzed: 0,
        preferencesInferred: 0,
        patternsCreated: 0,
        patternsReinforced: 0,
        preferences: [],
        costUsd: 0,
        success: true,
        error: `Not enough edits for analysis (have ${diffs.length}, need ${minEditsForAnalysis})`,
      };
    }

    const aggregatedPatterns = aggregateChangePatterns(diffs);

    const { preferences, costUsd } = await analyzeEditDiffsWithLlm(diffs, aggregatedPatterns);

    const { created, reinforced } = storeInferredPreferences(preferences);

    return {
      editsAnalyzed: diffs.length,
      preferencesInferred: preferences.length,
      patternsCreated: created,
      patternsReinforced: reinforced,
      preferences,
      costUsd,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      editsAnalyzed: 0,
      preferencesInferred: 0,
      patternsCreated: 0,
      patternsReinforced: 0,
      preferences: [],
      costUsd: 0,
      success: false,
      error: message,
    };
  }
}

export function getEditStats(): {
  totalEdits: number;
  editsWithDiffs: number;
  avgChangesPerEdit: number;
  topChangeTypes: { type: string; count: number }[];
} {
  const editFeedback = listFeedback({ action: 'edit', limit: 500 });
  const totalEdits = editFeedback.length;

  const editsWithDiffs = editFeedback.filter((f) => f.diffBefore && f.diffAfter).length;

  const diffs = collectEditDiffs({ limit: 500 });
  const totalChanges = diffs.reduce((sum, d) => sum + d.changes.length, 0);
  const avgChangesPerEdit = diffs.length > 0 ? totalChanges / diffs.length : 0;

  const aggregated = aggregateChangePatterns(diffs);
  const topChangeTypes = Array.from(aggregated.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));

  return {
    totalEdits,
    editsWithDiffs,
    avgChangesPerEdit: Math.round(avgChangesPerEdit * 100) / 100,
    topChangeTypes,
  };
}

export function formatEditDiffAnalysisResult(result: EditDiffAnalysisResult): string {
  const lines: string[] = [];

  lines.push('=== Edit Diff Analysis Result ===');
  lines.push(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);

  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  lines.push(`Edits analyzed: ${result.editsAnalyzed}`);
  lines.push(`Preferences inferred: ${result.preferencesInferred}`);
  lines.push(`Patterns created: ${result.patternsCreated}`);
  lines.push(`Patterns reinforced: ${result.patternsReinforced}`);
  lines.push(`Cost: $${result.costUsd.toFixed(4)}`);

  if (result.preferences.length > 0) {
    lines.push('\n--- Inferred Preferences ---');
    for (const pref of result.preferences) {
      lines.push(`\n[${pref.type.toUpperCase()}] ${pref.description}`);
      lines.push(`  Change type: ${pref.changeType}`);
      lines.push(`  Confidence: ${pref.confidence}%`);
      lines.push(`  Evidence: ${pref.evidence.length} examples`);
      if (pref.evidence.length > 0) {
        lines.push(`  Example: "${pref.evidence[0]}"`);
      }
    }
  }

  return lines.join('\n');
}
