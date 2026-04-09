import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import { createFormula } from '@/db/models/formulas';

import {
  STARTER_FORMULAS,
  loadActiveFormulas,
  loadAllFormulas,
  loadFormulaByName,
  getFormulasCount,
  hasMinimumFormulas,
  seedStarterFormulas,
  getFormulaDefinition,
  selectFormulaForContent,
  formatFormulaForPrompt,
} from './loader';

describe('Content Formula Selection', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    const db = getDb();
    db.exec('DELETE FROM formulas');
  });

  describe('STARTER_FORMULAS', () => {
    it('contains exactly 5 formulas', () => {
      expect(STARTER_FORMULAS).toHaveLength(5);
    });

    it('contains Problem → AI Solution formula', () => {
      const formula = STARTER_FORMULAS.find((f) => f.name === 'Problem → AI Solution');
      expect(formula).toBeDefined();
      expect(formula?.bestFor).toContain('single');
      expect(formula?.bestFor).toContain('thread');
    });

    it('contains Hidden Gem Discovery formula', () => {
      const formula = STARTER_FORMULAS.find((f) => f.name === 'Hidden Gem Discovery');
      expect(formula).toBeDefined();
      expect(formula?.bestFor).toContain('single');
    });

    it('contains Contrarian/Surprising Take formula', () => {
      const formula = STARTER_FORMULAS.find((f) => f.name === 'Contrarian/Surprising Take');
      expect(formula).toBeDefined();
      expect(formula?.bestFor).toContain('single');
      expect(formula?.bestFor).toContain('thread');
    });

    it('contains Simplifier formula', () => {
      const formula = STARTER_FORMULAS.find((f) => f.name === 'Simplifier');
      expect(formula).toBeDefined();
      expect(formula?.bestFor).toContain('single');
    });

    it('contains The Bridge formula', () => {
      const formula = STARTER_FORMULAS.find((f) => f.name === 'The Bridge');
      expect(formula).toBeDefined();
      expect(formula?.bestFor).toContain('single');
      expect(formula?.bestFor).toContain('thread');
    });

    it('all formulas have required fields', () => {
      for (const formula of STARTER_FORMULAS) {
        expect(formula.name).toBeTruthy();
        expect(formula.template).toBeTruthy();
        expect(formula.description).toBeTruthy();
        expect(formula.bestFor.length).toBeGreaterThan(0);
      }
    });
  });

  describe('seedStarterFormulas', () => {
    it('seeds all 5 formulas into empty database', () => {
      const result = seedStarterFormulas();

      expect(result.seeded).toBe(5);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('is idempotent - skips existing formulas', () => {
      const firstResult = seedStarterFormulas();
      expect(firstResult.seeded).toBe(5);

      const secondResult = seedStarterFormulas();
      expect(secondResult.seeded).toBe(0);
      expect(secondResult.skipped).toBe(5);
    });

    it('seeds only missing formulas', () => {
      createFormula({ name: 'Simplifier', template: 'test', active: true });

      const result = seedStarterFormulas();

      expect(result.seeded).toBe(4);
      expect(result.skipped).toBe(1);
    });
  });

  describe('loadActiveFormulas', () => {
    it('returns empty array when no formulas exist', () => {
      const result = loadActiveFormulas();
      expect(result).toHaveLength(0);
    });

    it('returns only active formulas', () => {
      createFormula({ name: 'Active 1', template: 't1', active: true });
      createFormula({ name: 'Active 2', template: 't2', active: true });
      createFormula({ name: 'Inactive', template: 't3', active: false });

      const result = loadActiveFormulas();

      expect(result).toHaveLength(2);
      expect(result.every((f) => f.active)).toBe(true);
    });
  });

  describe('loadAllFormulas', () => {
    it('returns all formulas including inactive', () => {
      createFormula({ name: 'Active', template: 't1', active: true });
      createFormula({ name: 'Inactive', template: 't2', active: false });

      const result = loadAllFormulas();

      expect(result).toHaveLength(2);
    });
  });

  describe('loadFormulaByName', () => {
    it('returns formula when found', () => {
      createFormula({ name: 'Test Formula', template: 'template', active: true });

      const result = loadFormulaByName('Test Formula');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Formula');
    });

    it('returns null when not found', () => {
      const result = loadFormulaByName('Nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getFormulasCount', () => {
    it('returns 0 for empty database', () => {
      expect(getFormulasCount()).toBe(0);
    });

    it('returns total count by default', () => {
      createFormula({ name: 'Active', template: 't1', active: true });
      createFormula({ name: 'Inactive', template: 't2', active: false });

      expect(getFormulasCount()).toBe(2);
    });

    it('returns only active count when specified', () => {
      createFormula({ name: 'Active', template: 't1', active: true });
      createFormula({ name: 'Inactive', template: 't2', active: false });

      expect(getFormulasCount(true)).toBe(1);
    });
  });

  describe('hasMinimumFormulas', () => {
    it('returns false when no active formulas', () => {
      expect(hasMinimumFormulas()).toBe(false);
    });

    it('returns true when at least 1 active formula exists', () => {
      createFormula({ name: 'Test', template: 't', active: true });
      expect(hasMinimumFormulas()).toBe(true);
    });

    it('returns false when only inactive formulas exist', () => {
      createFormula({ name: 'Test', template: 't', active: false });
      expect(hasMinimumFormulas()).toBe(false);
    });
  });

  describe('getFormulaDefinition', () => {
    it('returns definition for starter formula', () => {
      const definition = getFormulaDefinition('Problem → AI Solution');

      expect(definition).toBeDefined();
      expect(definition?.description).toContain('pain point');
    });

    it('returns undefined for non-starter formula', () => {
      const definition = getFormulaDefinition('Custom Formula');
      expect(definition).toBeUndefined();
    });
  });

  describe('selectFormulaForContent', () => {
    beforeEach(() => {
      seedStarterFormulas();
    });

    it('returns all active formulas ranked by suitability', () => {
      const result = selectFormulaForContent('Some content about tools.', 'single');

      expect(result.length).toBe(5);
      expect(result[0].suitability).toBe('high');
    });

    it('ranks Problem → AI Solution high for automation content', () => {
      const content = 'I still do this task manually every day. Time to automate it.';
      const result = selectFormulaForContent(content, 'single');

      const problemFormula = result.find((m) => m.formula.name === 'Problem → AI Solution');
      expect(problemFormula?.suitability).toBe('high');
    });

    it('ranks Hidden Gem Discovery high for GitHub repo content', () => {
      const content = 'Found this GitHub repo with only 50 stars that does amazing things.';
      const result = selectFormulaForContent(content, 'single');

      const gemFormula = result.find((m) => m.formula.name === 'Hidden Gem Discovery');
      expect(gemFormula?.suitability).toBe('high');
    });

    it('ranks Contrarian high for content challenging conventional wisdom', () => {
      const content = 'Everyone thinks this is right, but actually it is wrong.';
      const result = selectFormulaForContent(content, 'single');

      const contrarianFormula = result.find((m) => m.formula.name === 'Contrarian/Surprising Take');
      expect(contrarianFormula?.suitability).toBe('high');
    });

    it('ranks Simplifier high for explanation content', () => {
      const content = 'Let me explain this complex concept in simple terms.';
      const result = selectFormulaForContent(content, 'single');

      const simplifierFormula = result.find((m) => m.formula.name === 'Simplifier');
      expect(simplifierFormula?.suitability).toBe('high');
    });

    it('ranks The Bridge high for knowledge transfer content', () => {
      const content = 'This approach is similar to what we apply in other domains.';
      const result = selectFormulaForContent(content, 'single');

      const bridgeFormula = result.find((m) => m.formula.name === 'The Bridge');
      expect(bridgeFormula?.suitability).toBe('high');
    });

    it('considers postType in suitability', () => {
      const content = 'Generic content.';

      const singleResult = selectFormulaForContent(content, 'single');
      const threadResult = selectFormulaForContent(content, 'thread');

      const gemSingle = singleResult.find((m) => m.formula.name === 'Hidden Gem Discovery');
      const gemThread = threadResult.find((m) => m.formula.name === 'Hidden Gem Discovery');

      expect(gemSingle?.suitability).toBe('high');
      expect(gemThread?.suitability).toBe('low');
    });

    it('sorts by suitability then success rate', () => {
      const db = getDb();
      db.prepare('UPDATE formulas SET success_rate = 0.9 WHERE name = ?').run('Simplifier');
      db.prepare('UPDATE formulas SET success_rate = 0.5 WHERE name = ?').run(
        'Hidden Gem Discovery'
      );

      const result = selectFormulaForContent('Generic content.', 'single');

      const highSuitabilityFormulas = result.filter((m) => m.suitability === 'high');
      expect(highSuitabilityFormulas.length).toBeGreaterThan(0);

      for (let i = 1; i < highSuitabilityFormulas.length; i++) {
        expect(highSuitabilityFormulas[i - 1].formula.successRate).toBeGreaterThanOrEqual(
          highSuitabilityFormulas[i].formula.successRate
        );
      }
    });

    it('includes formula definition when available', () => {
      const result = selectFormulaForContent('Some content.', 'single');

      const withDefinition = result.find((m) => m.definition !== undefined);
      expect(withDefinition).toBeDefined();
      expect(withDefinition?.definition?.description).toBeTruthy();
    });

    it('handles custom formulas without definitions', () => {
      createFormula({ name: 'Custom Formula', template: 'custom template', active: true });

      const result = selectFormulaForContent('Some content.', 'single');

      const customMatch = result.find((m) => m.formula.name === 'Custom Formula');
      expect(customMatch).toBeDefined();
      expect(customMatch?.definition).toBeUndefined();
      expect(customMatch?.suitability).toBe('medium');
    });

    it('returns empty array when no active formulas', () => {
      const db = getDb();
      db.exec('DELETE FROM formulas');

      const result = selectFormulaForContent('Some content.', 'single');
      expect(result).toHaveLength(0);
    });
  });

  describe('formatFormulaForPrompt', () => {
    beforeEach(() => {
      seedStarterFormulas();
    });

    it('formats formula with name and template', () => {
      const formula = loadFormulaByName('Problem → AI Solution');
      expect(formula).not.toBeNull();
      if (!formula) return;

      const formatted = formatFormulaForPrompt(formula);

      expect(formatted).toContain('## Problem → AI Solution');
      expect(formatted).toContain('**Template:**');
    });

    it('includes description for starter formulas', () => {
      const formula = loadFormulaByName('Simplifier');
      expect(formula).not.toBeNull();
      if (!formula) return;

      const formatted = formatFormulaForPrompt(formula);

      expect(formatted).toContain('**Description:**');
      expect(formatted).toContain('digestible');
    });

    it('includes performance stats when available', () => {
      const db = getDb();
      db.prepare('UPDATE formulas SET usage_count = 10, success_rate = 0.85 WHERE name = ?').run(
        'Simplifier'
      );

      const formula = loadFormulaByName('Simplifier');
      expect(formula).not.toBeNull();
      if (!formula) return;

      const formatted = formatFormulaForPrompt(formula);

      expect(formatted).toContain('**Performance:**');
      expect(formatted).toContain('Used 10 times');
      expect(formatted).toContain('85% success rate');
    });

    it('omits performance stats when not used', () => {
      const formula = loadFormulaByName('Simplifier');
      expect(formula).not.toBeNull();
      if (!formula) return;

      const formatted = formatFormulaForPrompt(formula);

      expect(formatted).not.toContain('**Performance:**');
    });

    it('handles custom formulas without definition', () => {
      createFormula({ name: 'Custom', template: 'My template', active: true });

      const formula = loadFormulaByName('Custom');
      expect(formula).not.toBeNull();
      if (!formula) return;

      const formatted = formatFormulaForPrompt(formula);

      expect(formatted).toContain('## Custom');
      expect(formatted).toContain('My template');
      expect(formatted).not.toContain('**Description:**');
    });
  });

  describe('keyword detection heuristics', () => {
    beforeEach(() => {
      seedStarterFormulas();
    });

    it('detects workflow keyword for Problem → AI Solution', () => {
      const result = selectFormulaForContent('My workflow is inefficient.', 'single');
      const formula = result.find((m) => m.formula.name === 'Problem → AI Solution');
      expect(formula?.suitability).toBe('high');
    });

    it('detects tool keyword for Problem → AI Solution', () => {
      const result = selectFormulaForContent('This tool saves hours.', 'single');
      const formula = result.find((m) => m.formula.name === 'Problem → AI Solution');
      expect(formula?.suitability).toBe('high');
    });

    it('detects discover keyword for Hidden Gem', () => {
      const result = selectFormulaForContent('I discovered something amazing.', 'single');
      const formula = result.find((m) => m.formula.name === 'Hidden Gem Discovery');
      expect(formula?.suitability).toBe('high');
    });

    it('detects star keyword for Hidden Gem', () => {
      const result = selectFormulaForContent('This has 100 stars on GitHub.', 'single');
      const formula = result.find((m) => m.formula.name === 'Hidden Gem Discovery');
      expect(formula?.suitability).toBe('high');
    });

    it('detects instead keyword for Contrarian', () => {
      const result = selectFormulaForContent('Instead of doing X, try Y.', 'single');
      const formula = result.find((m) => m.formula.name === 'Contrarian/Surprising Take');
      expect(formula?.suitability).toBe('high');
    });

    it('detects understand keyword for Simplifier', () => {
      const result = selectFormulaForContent('To understand this concept...', 'single');
      const formula = result.find((m) => m.formula.name === 'Simplifier');
      expect(formula?.suitability).toBe('high');
    });

    it('detects transfer keyword for The Bridge', () => {
      const result = selectFormulaForContent('We can transfer this knowledge.', 'single');
      const formula = result.find((m) => m.formula.name === 'The Bridge');
      expect(formula?.suitability).toBe('high');
    });
  });
});
