const puppeteer_preset = require('jest-puppeteer/jest-preset');

module.exports = {
  ...puppeteer_preset,
  transform: {
    '^.+\\.tsx?$': 'babel-jest',
  },
};
