// @ts-check
const tseslint = require('typescript-eslint')

module.exports = tseslint.config(
  { ignores: ['.claude/**', '.tsbuild/**', 'out/**', 'dist/**', 'node_modules/**', 'release/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // SEC-146: no shell execution. Named spawn/execFile imports only, never shell: true.
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value=/^(node:)?child_process$/] > :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)",
          message: 'Import named spawn/execFile from child_process (no default/namespace import).'
        },
        { selector: "Property[key.name='shell'][value.value=true]", message: 'Never spawn with shell: true.' },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value=/^(node:)?child_process$/]",
          message: 'Import named spawn/execFile from child_process instead of require().'
        }
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'child_process', importNames: ['exec', 'execSync'], message: 'Use spawn/execFile with an args array (no shell).' },
            { name: 'node:child_process', importNames: ['exec', 'execSync'], message: 'Use spawn/execFile with an args array (no shell).' }
          ]
        }
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
            { name: 'child_process', importNames: ['exec', 'execSync'], message: 'Use spawn/execFile with an args array (no shell).' },
            { name: 'node:child_process', importNames: ['exec', 'execSync'], message: 'Use spawn/execFile with an args array (no shell).' }
          ]
        }
      ]
    }
  },
  { files: ['**/*.js', '**/*.cjs', '**/*.mjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } }
)
