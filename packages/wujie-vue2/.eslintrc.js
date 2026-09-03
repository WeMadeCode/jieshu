module.exports = {
  env: {
    node: true,
    browser: true,
    es2021: true,
  },
  extends: ["eslint:recommended", "plugin:vue/essential"],
  parser: require.resolve("../wujie-core/node_modules/@typescript-eslint/parser"),
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module",
  },
  plugins: ["vue"],
  rules: {
    // TypeScript performs the unused-symbol check; the base rule treats type
    // references and interface parameters as runtime variables.
    "no-unused-vars": "off",
  },
  ignorePatterns: ["esm", "lib"],
};
