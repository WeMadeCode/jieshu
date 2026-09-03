import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['**/*.{ts,tsx,mts,cts}'];
const unitTestFiles = ['**/__test__/unit/**/*.{js,ts,mts,cts}'];
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
    name: 'jieshu/ignores',
    ignores: [
      '.pnpm-store/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/build/**',
      '**/esm/**',
      '**/lib/**',
      '**/dist/**',
      'site/**',
      'docs/.vitepress/cache/**',
      'docs/public/**',
      'examples/vue2/public/tinymce/**',
      'packages/*/types/**',
    ],
  },
  {
    name: 'jieshu/base',
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
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
    name: 'jieshu/typescript',
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
    files: ['docs/**/*.vue', 'examples/{main-vue,vite,vue3}/**/*.vue', 'packages/jieshu-vue3/**/*.vue'],
  })),
  ...vue.configs['flat/vue2-essential'].map((config) => ({
    ...config,
    files: ['examples/vue2/**/*.vue'],
  })),
  {
    name: 'jieshu/vue-typescript',
    files: ['docs/**/*.vue', 'examples/**/*.vue', 'packages/jieshu-vue3/**/*.vue'],
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
    name: 'jieshu/unit-tests',
    files: unitTestFiles,
    languageOptions: {
      globals: globals.vitest,
    },
  },
  {
    name: 'jieshu/core-compatibility',
    files: ['packages/jieshu-core/**/*.ts'],
    rules: {
      'no-prototype-builtins': 'off',
      'no-self-assign': 'off',
    },
  },
  {
    name: 'jieshu/examples-javascript-compatibility',
    files: ['examples/**/*.{js,jsx,cjs,mjs}'],
    languageOptions: {
      globals: globals.jest,
    },
    rules: {
      'no-unused-vars': unusedVariablesRule,
      'preserve-caught-error': 'off',
    },
  },
  {
    name: 'jieshu/examples-vue-compatibility',
    files: ['examples/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  prettier,
];
