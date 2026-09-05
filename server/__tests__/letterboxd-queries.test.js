'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');
const q = require('../letterboxd/queries');

describe('letterboxd queries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getPendingCount returns a Number, not a BigInt', async () => {
    // mariadb returns BigInt for COUNT(*); arithmetic against Number throws.
    query.mockResolvedValue([{ n: 7n }]);
    const n = await q.getPendingCount();
    expect(n).toBe(7);
    expect(typeof n).toBe('number');
  });

  it('getEligibleRows only selects pending rows and honours the limit', async () => {
    query.mockResolvedValue([]);
    await q.getEligibleRows(10);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/letterboxdStatus = 'pending'/);
    expect(sql).toMatch(/ORDER BY viewingDate ASC/);
    expect(params).toEqual([10]);
  });

  it('getEligibleRows applies exponential backoff by attempt count', async () => {
    query.mockResolvedValue([]);
    await q.getEligibleRows(10);
    const [sql] = query.mock.calls[0];
    // Never attempted -> always eligible.
    expect(sql).toMatch(/letterboxdLastAttempt IS NULL/);
    // Otherwise 60 * 5^attempts seconds must have elapsed.
    expect(sql).toMatch(/POW\(5, letterboxdAttempts\)/);
  });

  it('markSynced stores the uri and clears the error', async () => {
    query.mockResolvedValue({});
    await q.markSynced(3, 'https://letterboxd.com/x/1/');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/letterboxdStatus = 'synced'/);
    expect(sql).toMatch(/letterboxdError = NULL/);
    expect(params).toEqual(['https://letterboxd.com/x/1/', 3]);
  });

  it('recordAttempt increments attempts and leaves the row pending', async () => {
    query.mockResolvedValue({});
    await q.recordAttempt(4, 'boom');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/letterboxdAttempts = letterboxdAttempts \+ 1/);
    expect(sql).not.toMatch(/letterboxdStatus/);
    expect(params).toEqual(['boom', 4]);
  });

  it('markSkipped records the reason without counting as a failure', async () => {
    query.mockResolvedValue({});
    await q.markSkipped(5, 'no imdb id');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/letterboxdStatus = 'skipped'/);
    expect(params).toEqual(['no imdb id', 5]);
  });

  it('getCounts returns every status, defaulting absent ones to 0', async () => {
    query.mockResolvedValue([
      { letterboxdStatus: 'pending', n: 2n },
      { letterboxdStatus: 'synced', n: 5n }
    ]);
    expect(await q.getCounts()).toEqual({ pending: 2, synced: 5, failed: 0, skipped: 0 });
  });

  it('resetFailed only touches failed rows and zeroes attempts', async () => {
    query.mockResolvedValue({ affectedRows: 3 });
    const n = await q.resetFailed();
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE letterboxdStatus = 'failed'/);
    expect(sql).toMatch(/letterboxdAttempts = 0/);
    expect(n).toBe(3);
  });

  it('truncates an over-long error message to fit VARCHAR(512)', async () => {
    query.mockResolvedValue({});
    await q.markFailed(1, 'x'.repeat(900));
    const [, params] = query.mock.calls[0];
    expect(params[0]).toHaveLength(512);
  });
});
