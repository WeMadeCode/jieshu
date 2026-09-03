// Compatibility bridge for the legacy ESLint loaders used by examples/*.
// The repository itself is linted exclusively through eslint.config.mjs.
module.exports = {
  root: true,
  ignorePatterns: ['packages/*/esm/**', 'packages/*/lib/**'],
};
