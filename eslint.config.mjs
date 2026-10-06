// Flat ESLint config (ESLint 9). Two source domains: the React renderer under
// src/ (browser globals) and the Electron main process under electron/ (Node
// globals). Type-checking is left to `tsc` (npm run build) — this lint pass is
// the syntactic/correctness layer that CI runs alongside it.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Project-wide rule tuning. These relaxations are deliberate, not silent:
  // the app decodes an untrusted, loosely-typed protobuf/BLE stream, so a few
  // `any`/`unknown` seams at protocol boundaries are honest, and unused args are
  // often there to document a callback's shape.
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // React renderer.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Electron main process + Node-side tooling/config.
  {
    files: ['electron/**/*.ts', '*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
