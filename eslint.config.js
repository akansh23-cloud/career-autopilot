import js from '@eslint/js';
import globals from 'globals';

/* Flat ESLint config (ESLint 9). Focused on catching real bugs (undefined
   references, duplicate keys, unreachable code) while staying pragmatic about
   an existing large codebase — unused vars and empty catches are warnings. */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'web/dist/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
    },
  },
];
