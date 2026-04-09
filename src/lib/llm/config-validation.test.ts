/**
 * LLM Config Validation Tests
 *
 * PRD Section 29.2.9: Test that changing model in config is reflected
 * in both TypeScript and Python codepaths.
 *
 * These tests verify:
 * 1. TypeScript config exports valid structure
 * 2. All task types have valid routing
 * 3. All models have cost entries
 * 4. Config JSON export matches expected structure
 */

import { describe, it, expect } from 'vitest';
import {
  MODELS,
  MODEL_ROUTING,
  MODEL_COSTS,
  getModelForTask,
  getPrimaryModel,
  getFallbackModels,
  estimateCost,
  getConfigAsJson,
  type TaskType,
  type ModelId,
} from './config';

describe('LLM Config - TypeScript Source of Truth (PRD 29.2.8-29.2.9)', () => {
  describe('MODELS constant', () => {
    it('should have all required model identifiers', () => {
      expect(MODELS.GPT_4O_MINI).toBe('gpt-4o-mini');
      expect(MODELS.CLAUDE_SONNET).toBe('claude-sonnet-4-20250514');
      expect(MODELS.CLAUDE_OPUS).toBe('claude-opus-4-20250514');
      expect(MODELS.CLAUDE_HAIKU).toBe('claude-3-5-haiku-20241022');
      expect(MODELS.GPT_4O).toBe('gpt-4o');
    });

    it('should have exactly 5 model identifiers', () => {
      expect(Object.keys(MODELS)).toHaveLength(5);
    });
  });

  describe('MODEL_ROUTING configuration', () => {
    const taskTypes: TaskType[] = [
      'classification',
      'parsing',
      'evaluation',
      'generation',
      'analysis',
      'rewrite',
    ];

    it('should have routing for all task types', () => {
      for (const taskType of taskTypes) {
        expect(MODEL_ROUTING[taskType]).toBeDefined();
      }
    });

    it('should have valid structure for each task type', () => {
      for (const taskType of taskTypes) {
        const tier = MODEL_ROUTING[taskType];
        expect(tier).toHaveProperty('primary');
        expect(tier).toHaveProperty('fallbacks');
        expect(tier).toHaveProperty('maxTokens');
        expect(tier).toHaveProperty('temperature');
        expect(Array.isArray(tier.fallbacks)).toBe(true);
        expect(typeof tier.maxTokens).toBe('number');
        expect(typeof tier.temperature).toBe('number');
      }
    });

    it('should use fast models for classification/parsing tasks', () => {
      expect(MODEL_ROUTING.classification.primary).toBe(MODELS.GPT_4O_MINI);
      expect(MODEL_ROUTING.parsing.primary).toBe(MODELS.GPT_4O_MINI);
    });

    it('should use quality models for generation tasks', () => {
      expect(MODEL_ROUTING.generation.primary).toBe(MODELS.CLAUDE_SONNET);
      expect(MODEL_ROUTING.analysis.primary).toBe(MODELS.CLAUDE_SONNET);
      expect(MODEL_ROUTING.rewrite.primary).toBe(MODELS.CLAUDE_SONNET);
    });
  });

  describe('MODEL_COSTS configuration', () => {
    it('should have cost entries for all models', () => {
      const modelValues = Object.values(MODELS);
      for (const model of modelValues) {
        expect(MODEL_COSTS[model as ModelId]).toBeDefined();
        expect(MODEL_COSTS[model as ModelId]).toHaveProperty('input');
        expect(MODEL_COSTS[model as ModelId]).toHaveProperty('output');
      }
    });

    it('should have positive cost values', () => {
      for (const model of Object.keys(MODEL_COSTS)) {
        const costs = MODEL_COSTS[model as ModelId];
        expect(costs.input).toBeGreaterThanOrEqual(0);
        expect(costs.output).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Helper functions', () => {
    it('getModelForTask should return valid tier', () => {
      const tier = getModelForTask('generation');
      expect(tier.primary).toBe(MODELS.CLAUDE_SONNET);
    });

    it('getPrimaryModel should return correct model', () => {
      expect(getPrimaryModel('classification')).toBe(MODELS.GPT_4O_MINI);
      expect(getPrimaryModel('generation')).toBe(MODELS.CLAUDE_SONNET);
    });

    it('getFallbackModels should return array', () => {
      const fallbacks = getFallbackModels('generation');
      expect(Array.isArray(fallbacks)).toBe(true);
      expect(fallbacks.length).toBeGreaterThan(0);
    });

    it('estimateCost should calculate correctly', () => {
      const cost = estimateCost(MODELS.GPT_4O_MINI, 1000, 500);
      expect(cost).toBeGreaterThan(0);
      expect(typeof cost).toBe('number');
    });
  });

  describe('getConfigAsJson export', () => {
    it('should export valid JSON structure', () => {
      const config = getConfigAsJson();

      expect(config).toHaveProperty('models');
      expect(config).toHaveProperty('routing');
      expect(config).toHaveProperty('costs');
    });

    it('should export all models', () => {
      const config = getConfigAsJson();
      expect(Object.keys(config.models)).toHaveLength(Object.keys(MODELS).length);
    });

    it('should export all routing configs', () => {
      const config = getConfigAsJson();
      expect(Object.keys(config.routing)).toHaveLength(Object.keys(MODEL_ROUTING).length);
    });

    it('should export routing with correct structure', () => {
      const config = getConfigAsJson();
      for (const [_taskType, routing] of Object.entries(config.routing)) {
        expect(routing).toHaveProperty('primary');
        expect(routing).toHaveProperty('fallbacks');
        expect(routing).toHaveProperty('maxTokens');
        expect(routing).toHaveProperty('temperature');
      }
    });

    it('should export all costs', () => {
      const config = getConfigAsJson();
      expect(Object.keys(config.costs)).toHaveLength(Object.keys(MODEL_COSTS).length);
    });

    it('should match MODEL_ROUTING values', () => {
      const config = getConfigAsJson();

      expect(config.routing.generation.primary).toBe(MODEL_ROUTING.generation.primary);
      expect(config.routing.generation.maxTokens).toBe(MODEL_ROUTING.generation.maxTokens);
      expect(config.routing.generation.temperature).toBe(MODEL_ROUTING.generation.temperature);
      expect(config.routing.generation.fallbacks).toEqual([...MODEL_ROUTING.generation.fallbacks]);
    });
  });

  describe('Config consistency checks', () => {
    it('all routing primaries should exist in MODELS', () => {
      const modelValues = new Set(Object.values(MODELS));
      for (const tier of Object.values(MODEL_ROUTING)) {
        expect(modelValues.has(tier.primary)).toBe(true);
      }
    });

    it('all routing fallbacks should exist in MODELS', () => {
      const modelValues = new Set(Object.values(MODELS));
      for (const tier of Object.values(MODEL_ROUTING)) {
        for (const fallback of tier.fallbacks) {
          expect(modelValues.has(fallback)).toBe(true);
        }
      }
    });

    it('all MODELS should have cost entries', () => {
      for (const model of Object.values(MODELS)) {
        expect(MODEL_COSTS[model as ModelId]).toBeDefined();
      }
    });
  });
});
