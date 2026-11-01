/**
 * Unit tests for constants.js
 * These tests verify that the STRONG_WARNING_FOLLOWUP constant is defined.
 */

const fs = require('fs');

describe('constants.js', () => {
  let fileContent;

  beforeAll(() => {
    // Read the constants.js file
    fileContent = fs.readFileSync(__dirname + '/../utils/constants.js', 'utf8');
  });

  test('STRONG_WARNING_FOLLOWUP constant should be defined in the file', () => {
    // Check that the constant is present in the file content
    expect(fileContent).toMatch(/STRONG_WARNING_FOLLOWUP\s*=\s*300/);
  });
});