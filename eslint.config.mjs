// eslint.config.mjs
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/',
      'bin/**',
      'build/**',
      '**/*.min.js',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        gapi: 'readonly',
        google: 'readonly',
      },
    },
    rules: {
      // You can adjust these based on your preference
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], // Allows variables starting with _
      'no-empty': ['error', { allowEmptyCatch: true }], // Allows empty catch blocks
      'no-console': 'off', // Useful for node scripts
    },
  },
  {
    files: ['**/main.js'],
    languageOptions: {
      globals: {
        ...globals.node, // This defines require, __dirname, and process
      },
    },
  },

  {
    files: ['**/*.test.js', '**/__tests__/**'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
