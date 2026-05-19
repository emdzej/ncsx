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
      // `_`-prefixed args are intentional in stub/scaffold code (e.g.
      // packages/inpax-cabi-provider declares the full CABI surface up front;
      // most signatures land in the unimplemented branch until they're built
      // out one-by-one). The `_` prefix is the canonical TS marker for
      // "intentionally unused"; without this opt-in eslint flags every stub.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
