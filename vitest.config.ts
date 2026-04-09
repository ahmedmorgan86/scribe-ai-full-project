import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    // Run test files sequentially to avoid SQLite database conflicts
    // Tests within a file still run in parallel unless otherwise configured
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.ts', 'src/db/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'node_modules'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
