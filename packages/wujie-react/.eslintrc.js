module.exports = {
  env: {
    node: true,
    browser: true,
    es2021: true,
  },
  extends: ["eslint:recommended", "plugin:react/recommended"],
  // Reuse the workspace's pinned TypeScript parser without adding a new
  // adapter-only lockfile entry.
  parser: require.resolve("../wujie-core/node_modules/@typescript-eslint/parser"),
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["react"],
  settings: {
    react: {
      version: "detect",
    },
  },
  rules: {
    // TypeScript checks source/test symbol usage; the base rule misreads
    // type-only imports and declarations.
    "no-unused-vars": "off",
    "react/prop-types": "off",
  },
  overrides: [
    {
      files: ["*.mjs"],
      rules: { "no-unused-vars": "error" },
    },
  ],
  ignorePatterns: ["esm/*.js"],
};
