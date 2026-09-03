import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['**/*.{ts,mts,cts}'];
const testFiles = ['**/__test__/**/*.{js,ts,mts,cts}', '**/*.test.{js,ts}'];
const unusedVariablesRule = [
  'warn',
  {
    argsIgnorePattern: '^_',
    caughtErrors: 'none',
    varsIgnorePattern: '^_',
  },
];

export default [
  {
    name: 'wujie/ignores',
    ignores: [
      'examples/**',
      '.pnpm-store/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/esm/**',
      '**/lib/**',
      '**/dist/**',
      'docs/.vitepress/cache/**',
      'docs/public/**',
      'packages/wujie-react/types/**',
      'packages/wujie-vue2/index.d.ts',
      'packages/wujie-vue3/index.d.ts',
    ],
  },
  {
    name: 'wujie/base',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-debugger': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    name: 'wujie/typescript',
    files: typescriptFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unusedVariablesRule,
    },
  },
  ...vue.configs['flat/essential'].map((config) => ({
    ...config,
    files: ['docs/**/*.vue'],
  })),
  {
    name: 'wujie/vue-typescript',
    files: ['docs/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unusedVariablesRule,
    },
  },
  {
    name: 'wujie/tests',
    files: testFiles,
    languageOptions: {
      globals: {
        ...globals.jest,
        page: 'readonly',
      },
    },
  },
  {
    name: 'wujie/core-compatibility',
    files: ['packages/wujie-core/**/*.ts'],
    rules: {
      'no-prototype-builtins': 'off',
      'no-self-assign': 'off',
    },
  },
  prettier,
];
