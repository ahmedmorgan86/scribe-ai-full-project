/**
 * LLM Config Validation Script
 *
 * Validates that Python workers/langgraph/config.py mirrors TypeScript src/lib/llm/config.ts.
 * This ensures model routing is consistent between TypeScript and Python codepaths.
 *
 * Usage: npm run validate:llm-config
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { getConfigAsJson } from '../src/lib/llm/config';

interface LLMConfig {
  models: Record<string, string>;
  routing: Record<string, { primary: string; fallbacks: string[]; maxTokens: number; temperature: number }>;
  costs: Record<string, { input: number; output: number }>;
}

async function getPythonConfig(): Promise<LLMConfig> {
  const workersDir = path.join(process.cwd(), 'workers', 'langgraph');

  const pythonCode = `
import sys
import json
sys.path.insert(0, '${workersDir.replace(/\\/g, '\\\\')}')
from config import get_config_as_json
print(json.dumps(get_config_as_json()))
`;

  return new Promise((resolve, reject) => {
    const python = spawn('python', ['-c', pythonCode], {
      cwd: workersDir,
      env: { ...process.env, PYTHONPATH: workersDir },
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout}`));
      }
    });

    python.on('error', (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

function compareConfigs(ts: LLMConfig, py: LLMConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Compare models
  for (const [key, value] of Object.entries(ts.models)) {
    if (py.models[key] !== value) {
      errors.push(`Model mismatch: ${key} - TS: "${value}", Python: "${py.models[key] || 'MISSING'}"`);
    }
  }
  for (const key of Object.keys(py.models)) {
    if (!(key in ts.models)) {
      errors.push(`Extra model in Python: ${key}`);
    }
  }

  // Compare routing
  for (const [taskType, tsConfig] of Object.entries(ts.routing)) {
    const pyConfig = py.routing[taskType];
    if (!pyConfig) {
      errors.push(`Missing routing for task type: ${taskType}`);
      continue;
    }

    if (tsConfig.primary !== pyConfig.primary) {
      errors.push(`Routing primary mismatch for ${taskType}: TS: "${tsConfig.primary}", Python: "${pyConfig.primary}"`);
    }
    if (tsConfig.maxTokens !== pyConfig.maxTokens) {
      errors.push(`Routing maxTokens mismatch for ${taskType}: TS: ${tsConfig.maxTokens}, Python: ${pyConfig.maxTokens}`);
    }
    if (tsConfig.temperature !== pyConfig.temperature) {
      errors.push(`Routing temperature mismatch for ${taskType}: TS: ${tsConfig.temperature}, Python: ${pyConfig.temperature}`);
    }

    const tsFallbacks = tsConfig.fallbacks.sort();
    const pyFallbacks = pyConfig.fallbacks.sort();
    if (JSON.stringify(tsFallbacks) !== JSON.stringify(pyFallbacks)) {
      errors.push(`Routing fallbacks mismatch for ${taskType}: TS: [${tsFallbacks.join(', ')}], Python: [${pyFallbacks.join(', ')}]`);
    }
  }
  for (const taskType of Object.keys(py.routing)) {
    if (!(taskType in ts.routing)) {
      errors.push(`Extra routing in Python: ${taskType}`);
    }
  }

  // Compare costs
  for (const [model, tsCosts] of Object.entries(ts.costs)) {
    const pyCosts = py.costs[model];
    if (!pyCosts) {
      errors.push(`Missing cost for model: ${model}`);
      continue;
    }
    if (tsCosts.input !== pyCosts.input) {
      errors.push(`Cost input mismatch for ${model}: TS: ${tsCosts.input}, Python: ${pyCosts.input}`);
    }
    if (tsCosts.output !== pyCosts.output) {
      errors.push(`Cost output mismatch for ${model}: TS: ${tsCosts.output}, Python: ${pyCosts.output}`);
    }
  }
  for (const model of Object.keys(py.costs)) {
    if (!(model in ts.costs)) {
      errors.push(`Extra cost in Python: ${model}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

async function main(): Promise<void> {
  console.log('🔍 Validating LLM configuration consistency...\n');
  console.log('TypeScript config: src/lib/llm/config.ts');
  console.log('Python config: workers/langgraph/config.py\n');

  try {
    const tsConfig = getConfigAsJson();
    console.log('✓ Loaded TypeScript config');

    const pyConfig = await getPythonConfig();
    console.log('✓ Loaded Python config\n');

    const { valid, errors } = compareConfigs(tsConfig, pyConfig);

    if (valid) {
      console.log('✅ LLM configurations are consistent!\n');
      console.log('Models:', Object.keys(tsConfig.models).length);
      console.log('Task types:', Object.keys(tsConfig.routing).length);
      console.log('Cost entries:', Object.keys(tsConfig.costs).length);
      process.exit(0);
    } else {
      console.log('❌ LLM configuration mismatch detected!\n');
      console.log('Errors:');
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
      console.log('\n⚠️  TypeScript config.ts is the source of truth.');
      console.log('   Update Python config.py to match TypeScript values.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Validation failed:', error instanceof Error ? error.message : error);
    console.log('\nMake sure Python 3 is installed and workers/langgraph/config.py is valid.');
    process.exit(1);
  }
}

main();
