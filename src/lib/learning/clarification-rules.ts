import type { Rule, RuleType } from '@/types';
import {
  createRule,
  listRules,
  deactivateRule,
  findRuleByDescription,
  getActiveRulesForGeneration,
} from '@/db/models/rules';
import { deletePattern, getPatternById } from '@/db/models/patterns';
import type { ClarificationRequest, DetectedContradiction } from './contradictions';

export type ClarificationResolution =
  | 'follow_pattern_a'
  | 'follow_pattern_b'
  | 'context_dependent'
  | 'remove_both';

export interface ClarificationResponse {
  clarificationId: string;
  resolution: ClarificationResolution;
  customContext?: string;
}

export interface StoreClarificationResult {
  success: boolean;
  rulesCreated: Rule[];
  patternsDeactivated: number[];
  error?: string;
}

function contradictionTypeToRuleType(contradiction: DetectedContradiction): RuleType {
  const patternType = contradiction.patternA.type;
  switch (patternType) {
    case 'voice':
      return 'voice';
    case 'hook':
      return 'hook';
    case 'topic':
      return 'topic';
    case 'edit':
      return 'style';
    case 'rejection':
      return 'general';
    default:
      return 'general';
  }
}

function buildRuleDescription(
  resolution: ClarificationResolution,
  contradiction: DetectedContradiction,
  customContext?: string
): string {
  const { patternA, patternB } = contradiction;

  switch (resolution) {
    case 'follow_pattern_a':
      return patternA.description;

    case 'follow_pattern_b':
      return patternB.description;

    case 'context_dependent':
      if (customContext) {
        return `Context-dependent: ${patternA.description} OR ${patternB.description}. Rule: ${customContext}`;
      }
      return `Context-dependent: Use "${patternA.description}" in some contexts, "${patternB.description}" in others.`;

    case 'remove_both':
      return `Neither "${patternA.description}" nor "${patternB.description}" should be followed.`;

    default:
      return patternA.description;
  }
}

function buildRuleContext(
  resolution: ClarificationResolution,
  contradiction: DetectedContradiction,
  customContext?: string
): string {
  const parts: string[] = [];

  parts.push(`Resolved contradiction between patterns:`);
  parts.push(`- Pattern A: "${contradiction.patternA.description}"`);
  parts.push(`- Pattern B: "${contradiction.patternB.description}"`);
  parts.push(`- Contradiction type: ${contradiction.contradictionType}`);
  parts.push(`- Resolution: ${resolution}`);

  if (customContext) {
    parts.push(`- User context: ${customContext}`);
  }

  return parts.join('\n');
}

export function storeClarificationAsRule(
  clarification: ClarificationRequest,
  resolution: ClarificationResolution,
  customContext?: string
): StoreClarificationResult {
  const rulesCreated: Rule[] = [];
  const patternsDeactivated: number[] = [];

  try {
    const { contradiction } = clarification;
    const ruleType = contradictionTypeToRuleType(contradiction);
    const description = buildRuleDescription(resolution, contradiction, customContext);
    const context = buildRuleContext(resolution, contradiction, customContext);

    const existingRule = findRuleByDescription(description);
    if (existingRule) {
      return {
        success: true,
        rulesCreated: [existingRule],
        patternsDeactivated: [],
      };
    }

    const priority =
      clarification.priority === 'high' ? 3 : clarification.priority === 'medium' ? 2 : 1;

    const rule = createRule({
      ruleType,
      description,
      source: 'clarification',
      priority,
      context,
    });
    rulesCreated.push(rule);

    if (resolution === 'follow_pattern_a' && contradiction.patternB.id !== undefined) {
      const patternBId = contradiction.patternB.id;
      if (getPatternById(patternBId) !== null) {
        deletePattern(patternBId);
        patternsDeactivated.push(patternBId);
      }
    } else if (resolution === 'follow_pattern_b' && contradiction.patternA.id !== undefined) {
      const patternAId = contradiction.patternA.id;
      if (getPatternById(patternAId) !== null) {
        deletePattern(patternAId);
        patternsDeactivated.push(patternAId);
      }
    } else if (resolution === 'remove_both') {
      if (
        contradiction.patternA.id !== undefined &&
        getPatternById(contradiction.patternA.id) !== null
      ) {
        deletePattern(contradiction.patternA.id);
        patternsDeactivated.push(contradiction.patternA.id);
      }
      if (
        contradiction.patternB.id !== undefined &&
        getPatternById(contradiction.patternB.id) !== null
      ) {
        deletePattern(contradiction.patternB.id);
        patternsDeactivated.push(contradiction.patternB.id);
      }
    }

    return {
      success: true,
      rulesCreated,
      patternsDeactivated,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      rulesCreated,
      patternsDeactivated,
      error: errorMessage,
    };
  }
}

export interface BatchClarificationResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  rulesCreated: Rule[];
  patternsDeactivated: number[];
  errors: string[];
}

export function storeClarificationsAsRules(
  responses: Array<{
    clarification: ClarificationRequest;
    resolution: ClarificationResolution;
    customContext?: string;
  }>
): BatchClarificationResult {
  const result: BatchClarificationResult = {
    totalProcessed: responses.length,
    successful: 0,
    failed: 0,
    rulesCreated: [],
    patternsDeactivated: [],
    errors: [],
  };

  for (const { clarification, resolution, customContext } of responses) {
    const storeResult = storeClarificationAsRule(clarification, resolution, customContext);

    if (storeResult.success) {
      result.successful++;
      result.rulesCreated.push(...storeResult.rulesCreated);
      result.patternsDeactivated.push(...storeResult.patternsDeactivated);
    } else {
      result.failed++;
      if (storeResult.error) {
        result.errors.push(storeResult.error);
      }
    }
  }

  return result;
}

export function createManualRule(
  ruleType: RuleType,
  description: string,
  context?: string,
  priority?: number
): Rule {
  return createRule({
    ruleType,
    description,
    source: 'manual',
    priority: priority ?? 2,
    context: context ?? null,
  });
}

export function createBootstrapRule(
  ruleType: RuleType,
  description: string,
  context?: string
): Rule {
  return createRule({
    ruleType,
    description,
    source: 'bootstrap',
    priority: 1,
    context: context ?? null,
  });
}

export interface RulesForGeneration {
  rules: Rule[];
  byType: Record<RuleType, Rule[]>;
  formatted: string;
}

export function getRulesForGeneration(): RulesForGeneration {
  const rules = getActiveRulesForGeneration();

  const byType: Record<RuleType, Rule[]> = {
    voice: [],
    hook: [],
    topic: [],
    style: [],
    format: [],
    general: [],
  };

  for (const rule of rules) {
    byType[rule.ruleType].push(rule);
  }

  return {
    rules,
    byType,
    formatted: formatRulesForPrompt(rules),
  };
}

export function formatRulesForPrompt(rules: Rule[]): string {
  if (rules.length === 0) {
    return '';
  }

  const lines: string[] = ['## Explicit Rules (MUST follow)', ''];

  const groupedByType: Record<string, Rule[]> = {};
  for (const rule of rules) {
    if (groupedByType[rule.ruleType] === undefined) {
      groupedByType[rule.ruleType] = [];
    }
    groupedByType[rule.ruleType].push(rule);
  }

  for (const [ruleType, typeRules] of Object.entries(groupedByType)) {
    if (typeRules.length === 0) continue;

    lines.push(`### ${ruleType.charAt(0).toUpperCase() + ruleType.slice(1)} Rules`);
    for (const rule of typeRules) {
      const priorityLabel = rule.priority >= 3 ? ' [HIGH PRIORITY]' : '';
      lines.push(`- ${rule.description}${priorityLabel}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function getRuleStats(): {
  total: number;
  active: number;
  byType: Record<RuleType, number>;
  bySource: Record<string, number>;
} {
  const allRules = listRules({ limit: 1000 });
  const activeRules = allRules.filter((r) => r.isActive);

  const byType: Record<RuleType, number> = {
    voice: 0,
    hook: 0,
    topic: 0,
    style: 0,
    format: 0,
    general: 0,
  };

  const bySource: Record<string, number> = {
    clarification: 0,
    manual: 0,
    bootstrap: 0,
  };

  for (const rule of activeRules) {
    byType[rule.ruleType]++;
    bySource[rule.source]++;
  }

  return {
    total: allRules.length,
    active: activeRules.length,
    byType,
    bySource,
  };
}

export function formatRuleStats(stats: ReturnType<typeof getRuleStats>): string {
  const lines: string[] = [];

  lines.push('=== Rule Statistics ===');
  lines.push(`Total rules: ${stats.total}`);
  lines.push(`Active rules: ${stats.active}`);
  lines.push('');
  lines.push('By type:');
  for (const [type, count] of Object.entries(stats.byType)) {
    if (count > 0) {
      lines.push(`  ${type}: ${count}`);
    }
  }
  lines.push('');
  lines.push('By source:');
  for (const [source, count] of Object.entries(stats.bySource)) {
    if (count > 0) {
      lines.push(`  ${source}: ${count}`);
    }
  }

  return lines.join('\n');
}

export function deactivateRuleById(id: number): Rule | null {
  return deactivateRule(id);
}
