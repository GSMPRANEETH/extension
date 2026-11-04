/**
 * Jest configuration for Doom Scroll Blocker extension tests
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/test/**/*.test.js'
  ],
  collectCoverageFrom: [
    'background/**/*.js',
    'content/**/*.js',
    'popup/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
    '!**/build/**',
    '!**/test/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  // Reset the module registry between every test
  resetModules: true,
  // Reset mock state between every test
  resetMocks: true
};