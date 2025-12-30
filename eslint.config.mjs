// eslint.config.mjs
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
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
        // GOOGLE SDK GLOBALS
        gapi: 'readonly',
        google: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
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
];
