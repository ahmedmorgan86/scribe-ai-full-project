import {
  getActiveFormulas,
  getFormulaByName,
  listFormulas,
  createFormula,
  countFormulas,
} from '@/db/models/formulas';
import { Formula, PostType } from '@/types';

export interface FormulaDefinition {
  name: string;
  template: string;
  description: string;
  bestFor: PostType[];
}

export const STARTER_FORMULAS: FormulaDefinition[] = [
  {
    name: 'Problem → AI Solution',
    template: `"You're probably still doing [common task] manually.
Here's how to automate it with [tool]:
[2-3 steps]
[Result/benefit]"`,
    description:
      'Addresses a common pain point and presents an AI-powered solution with clear steps',
    bestFor: ['single', 'thread'],
  },
  {
    name: 'Hidden Gem Discovery',
    template: `"Found a GitHub repo with only [X] stars that [solves problem].
[What it does]
[How to install - 1-2 lines]
[Example use case]
Link: [url]"`,
    description: 'Surfaces underrated tools/repos with low stars but high quality signals',
    bestFor: ['single'],
  },
  {
    name: 'Contrarian/Surprising Take',
    template: `"Unpopular opinion: [common practice] is wrong.
Here's why:
[Reasoning]
Instead, try [alternative]."`,
    description: 'Challenges conventional wisdom with evidence-backed reasoning',
    bestFor: ['single', 'thread'],
  },
  {
    name: 'Simplifier',
    template: `"[Complex concept] explained simply:
[Simple explanation]
That's it. Not more complicated."`,
    description: 'Breaks down complex concepts into digestible explanations',
    bestFor: ['single'],
  },
  {
    name: 'The Bridge',
    template: `"[Group A] struggles with [problem].
[Group B] has solved this with [solution].
Here's how to apply it:
[Steps]"`,
    description: 'Transfers knowledge from one domain to another for the audience',
    bestFor: ['single', 'thread'],
  },
];

export function loadActiveFormulas(): Formula[] {
  return getActiveFormulas();
}

export function loadAllFormulas(): Formula[] {
  return listFormulas({ limit: 1000 });
}

export function loadFormulaByName(name: string): Formula | null {
  return getFormulaByName(name);
}

export function getFormulasCount(activeOnly?: boolean): number {
  return countFormulas(activeOnly);
}

export function hasMinimumFormulas(): boolean {
  return countFormulas(true) >= 1;
}

export interface SeedResult {
  seeded: number;
  skipped: number;
  errors: string[];
}

export function seedStarterFormulas(): SeedResult {
  const result: SeedResult = { seeded: 0, skipped: 0, errors: [] };

  for (const formulaDef of STARTER_FORMULAS) {
    const existing = getFormulaByName(formulaDef.name);
    if (existing) {
      result.skipped++;
      continue;
    }

    try {
      createFormula({
        name: formulaDef.name,
        template: formulaDef.template,
        active: true,
      });
      result.seeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to seed "${formulaDef.name}": ${message}`);
    }
  }

  return result;
}

export function getFormulaDefinition(name: string): FormulaDefinition | undefined {
  return STARTER_FORMULAS.find((f) => f.name === name);
}

export interface FormulaMatch {
  formula: Formula;
  definition: FormulaDefinition | undefined;
  suitability: 'high' | 'medium' | 'low';
}

export function selectFormulaForContent(
  sourceContent: string,
  postType: PostType = 'single'
): FormulaMatch[] {
  const activeFormulas = loadActiveFormulas();
  const matches: FormulaMatch[] = [];

  for (const formula of activeFormulas) {
    const definition = getFormulaDefinition(formula.name);
    let suitability: 'high' | 'medium' | 'low' = 'medium';

    if (definition) {
      suitability = definition.bestFor.includes(postType) ? 'high' : 'low';
    }

    const contentLower = sourceContent.toLowerCase();

    if (formula.name === 'Problem → AI Solution') {
      if (
        contentLower.includes('manual') ||
        contentLower.includes('automat') ||
        contentLower.includes('tool') ||
        contentLower.includes('workflow')
      ) {
        suitability = 'high';
      }
    } else if (formula.name === 'Hidden Gem Discovery') {
      if (
        contentLower.includes('github') ||
        contentLower.includes('repo') ||
        contentLower.includes('star') ||
        contentLower.includes('discover')
      ) {
        suitability = 'high';
      }
    } else if (formula.name === 'Contrarian/Surprising Take') {
      if (
        contentLower.includes('actually') ||
        contentLower.includes('wrong') ||
        contentLower.includes('instead') ||
        contentLower.includes('but')
      ) {
        suitability = 'high';
      }
    } else if (formula.name === 'Simplifier') {
      if (
        contentLower.includes('explain') ||
        contentLower.includes('simple') ||
        contentLower.includes('complex') ||
        contentLower.includes('understand')
      ) {
        suitability = 'high';
      }
    } else if (formula.name === 'The Bridge') {
      if (
        contentLower.includes('like') ||
        contentLower.includes('similar') ||
        contentLower.includes('apply') ||
        contentLower.includes('transfer')
      ) {
        suitability = 'high';
      }
    }

    matches.push({ formula, definition, suitability });
  }

  return matches.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    const suitabilityDiff = order[a.suitability] - order[b.suitability];
    if (suitabilityDiff !== 0) return suitabilityDiff;
    return b.formula.successRate - a.formula.successRate;
  });
}

export function formatFormulaForPrompt(formula: Formula): string {
  const definition = getFormulaDefinition(formula.name);

  let formatted = `## ${formula.name}\n\n`;
  if (definition) {
    formatted += `**Description:** ${definition.description}\n\n`;
  }
  formatted += `**Template:**\n${formula.template}\n`;

  if (formula.usageCount > 0) {
    formatted += `\n**Performance:** Used ${formula.usageCount} times, ${Math.round(formula.successRate * 100)}% success rate`;
  }

  return formatted;
}
