// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { featureBoundaryRule } from './packages/tooling/src/lint/feature-boundary.js';

/**
 * Repo-wide lint. Rules that encode architecture invariants:
 *  - ADR-009: `Date.now()` / `new Date()` (no-arg) are banned outside clock modules.
 *  - ADR-013: features import only each other's contract entry, never server/client impl.
 *  - browser packages (client, template-game, admin inspector) may not import node builtins,
 *    the TypeBox runtime, or @foundation/jest-verify.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'infra/pgdata/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { foundation: { rules: { 'feature-boundary': featureBoundaryRule } } },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'ADR-009: Date.now() is banned outside the clock module. Inject a clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'ADR-009: new Date() without arguments is banned outside the clock module.',
        },
      ],
      'foundation/feature-boundary': 'error',
    },
  },
  {
    // The clock modules and test infrastructure are the only places allowed to read wall clock.
    files: [
      'packages/client/src/clock/**',
      'packages/server/src/clock/**',
      'packages/testkit/src/**',
      'packages/tooling/src/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/vitest.config.ts',
      '**/vite.config.ts',
      '**/playwright.config.ts',
      'apps/server/src/cli/**',
      'packages/contracts/scripts/**',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Browser-facing code must never pull node builtins, TypeBox runtime, or verifiers.
    files: [
      'packages/client/src/**',
      'apps/template-game/src/**',
      'apps/server/admin-inspector/src/**',
      'packages/server/src/features/*/client.ts',
      'packages/server/src/features/*/contract.ts',
      'packages/server/src/http/client-fetch.ts',
      'packages/contracts/src/enums.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@sinclair/typebox',
              message: 'Browser code must not include the TypeBox runtime. Import types only.',
              allowTypeImports: true,
            },
            {
              name: '@foundation/jest-verify',
              message: 'Verifiers are node-only.',
            },
            {
              name: '@foundation/server',
              message: 'Browser code must import feature contract/client entry points only.',
              allowTypeImports: true,
            },
          ],
          patterns: [
            { group: ['node:*'], message: 'No node builtins in browser code.' },
            {
              regex: '^@foundation/contracts(/schemas)?$',
              message:
                'Browser code imports contracts as types, or values from @foundation/contracts/enums only.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  prettier,
);
