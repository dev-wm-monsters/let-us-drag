// @ts-check
const tseslint = require('typescript-eslint')

module.exports = tseslint.config(
  { ignores: ['.tsbuild/**', 'out/**', 'dist/**', 'node_modules/**', 'release/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'child_process', importNames: ['exec', 'execSync'], message: 'Use spawn/execFile with an args array (no shell).' }] }
      ]
    }
  },
  {
    files: ['src/engine/**/*.ts'],
    ignores: ['src/engine/worker.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The engine must stay pure Node (see docs/PLAN.md §3).' },
            { name: 'child_process', importNames: ['exec', 'execSync'], message: 'Use spawn/execFile with an args array (no shell).' }
          ]
        }
      ]
    }
  },
  { files: ['**/*.js', '**/*.cjs', '**/*.mjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } }
)
