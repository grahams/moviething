const { query } = require('../db');

describe('db.query()', () => {
  let mockConnection;

  beforeEach(() => {
    mockConnection = {
      query: jest.fn(),
      release: jest.fn(),
    };
    global.mockPool.getConnection.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns rows on success', async () => {
    const mockRows = [{ id: 1 }];
    mockConnection.query.mockResolvedValueOnce(mockRows);
    const rows = await query('SELECT 1', []);
    expect(rows).toEqual(mockRows);
    expect(mockConnection.release).toHaveBeenCalled();
  });

  it('wraps DB errors with context and still releases the connection', async () => {
    mockConnection.query.mockRejectedValueOnce(new Error('disk failure'));
    await expect(query('SELECT 1', [])).rejects.toThrow('DB query failed: disk failure');
    expect(mockConnection.release).toHaveBeenCalled();
  });
});
