module.exports = {
  rootDir: "../..",
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testMatch: ["<rootDir>/__test__/unit/**/*.test.ts"],
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/__test__/unit/tsconfig.json",
    },
  },
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: ["<rootDir>/index.ts"],
  coverageDirectory: "<rootDir>/coverage/unit",
  coverageReporters: ["text", "text-summary"],
  coverageThreshold: {
    global: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
