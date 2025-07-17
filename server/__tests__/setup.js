// Set test environment
process.env.NODE_ENV = 'test';

// Set required environment variables
process.env.MOVIETHING_SQL_HOST = 'localhost';
process.env.MOVIETHING_SQL_USER = 'test';
process.env.MOVIETHING_SQL_PASS = 'test';
process.env.MOVIETHING_SQL_DB = 'test';
process.env.MOVIETHING_OMDB_API_KEY = 'test_key';
process.env.MOVIETHING_VALID_API_KEY = 'test_api_key';

// Mock node-fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ Search: [] })
  })
);

// Mock MariaDB with a more complete implementation
const mockPool = {
  getConnection: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue([]),
    release: jest.fn()
  }),
  end: jest.fn()
};

jest.mock('mariadb', () => ({
  createPool: jest.fn(() => mockPool)
}));

// Export mock pool for tests to use
global.mockPool = mockPool; 