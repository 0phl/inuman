import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// src/core must stay pure and portable: a future room server runs it unchanged,
// and reducers must be deterministic (all randomness comes from the seeded RNG).
const coreImportBan = [
  'react',
  'react-dom',
  'react-*',
  'three',
  'three/*',
  '@react-three/*',
  'zustand',
  'zustand/*',
  'i18next',
  'idb-keyval',
  'detect-gpu',
  'maath',
  'maath/*',
  'qrcode',
  'tunnel-rat',
  '@use-gesture/*',
  '@/app/*',
  '@/stage/*',
  '@/three/*',
  '@/physics/*',
  '@/games/*',
  '@/ui/*',
  '@/store/*',
  '@/i18n/*',
];

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: coreImportBan, message: 'src/core must stay pure (no UI, 3D, storage, or DOM).' }] }],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'indexedDB', 'Date', 'performance', 'crypto'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded RNG from ctx.' }],
    },
  },
  {
    files: ['vite.config.ts', 'playwright.config.ts', 'scripts/**', 'e2e/**'],
    languageOptions: { globals: globals.node },
  },
]);
