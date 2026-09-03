module.exports = {
  env: {
    node: true,
    browser: true,
    es2021: true,
  },
  extends: ["eslint:recommended", "plugin:vue/essential"],
  // wujie-vue3 depends on the core workspace package and reuses its pinned
  // TypeScript parser so this adapter does not need an unsynchronised lockfile entry.
  parser: require.resolve("../wujie-core/node_modules/@typescript-eslint/parser"),
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module",
  },
  plugins: ["vue"],
  // TypeScript's noUnusedLocals/noUnusedParameters cover type-only symbols;
  // the base rule cannot distinguish them from runtime variables.
  rules: { "no-unused-vars": "off" },
  ignorePatterns: ["esm/*"],
};
