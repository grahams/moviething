// Jest setup file

// Set default timeout for tests (optional)
jest.setTimeout(30000);

// Add any global test setup here
beforeAll(() => {
    // Add any setup that should run before all tests
    // For example:
    // - Set up test database
    // - Set environment variables
    // - Initialize test data
});

afterAll(() => {
    // Add any cleanup that should run after all tests
    // For example:
    // - Clean up test database
    // - Remove test files
    // - Reset environment
});

// Add any global mocks here if needed
// For example:
/*
jest.mock('some-module', () => ({
    someFunction: jest.fn()
}));
*/

// Add any global test utilities or helper functions
global.testUtils = {
    // Add helper functions here if needed
}; 