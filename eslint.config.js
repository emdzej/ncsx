import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.test.ts',
      '**/scripts/**',
      // Vite writes ephemeral compiled-config files next to vite.config.ts
      // during dev/build; they vanish at the end and ESLint racing against
      // the cleanup yields ENOENT on the temp file. Ignore them outright.
      '**/vite.config.ts.timestamp-*',
      // The web apps' SPA-only entry-style configs and build outputs live
      // under apps/*/dist and apps/*/public; nothing user-authored there.
      'apps/*/dist/**',
      'apps/*/public/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
