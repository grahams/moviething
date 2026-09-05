'use strict';

const request = require('supertest');

// A separate file from letterboxd-routes.test.js because jest.mock is
// file-scoped: that file locks config.enabled to true, so the disabled path
// needs its own module mock.
const mockWorker = {
  getState: jest.fn(),
  runNow: jest.fn(),
  start: jest.fn(),
  stop: jest.fn()
};
const mockQueries = {
  getCounts: jest.fn(),
  getRecentFailures: jest.fn(),
  resetFailed: jest.fn()
};

jest.mock('../letterboxd', () => ({ worker: mockWorker, config: { enabled: false } }));
jest.mock('../letterboxd/queries', () => mockQueries);

const { app } = require('../index');

const AUTH = ['X-Authentik-Username', 'testuser'];

describe('letterboxd routes when the feature is disabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorker.getState.mockReturnValue({
      enabled: false, running: false, paused: false, authOk: true,
      lastRun: null, lastResult: null, lastError: null
    });
    mockQueries.getCounts.mockResolvedValue({ pending: 0, synced: 0, failed: 0, skipped: 0 });
    mockQueries.getRecentFailures.mockResolvedValue([]);
  });

  it('GET /api/letterboxd/status stays reachable and reports enabled:false', async () => {
    const res = await request(app).get('/api/letterboxd/status').set(...AUTH).expect(200);
    expect(res.body.data.enabled).toBe(false);
  });

  it('POST /api/letterboxd/sync returns 409 without touching the worker', async () => {
    const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(409);
    expect(res.body.error).toMatch(/disabled/i);
    expect(mockWorker.runNow).not.toHaveBeenCalled();
  });

  it('POST /api/letterboxd/retry returns 409 without touching the database', async () => {
    const res = await request(app).post('/api/letterboxd/retry').set(...AUTH).expect(409);
    expect(res.body.error).toMatch(/disabled/i);
    expect(mockQueries.resetFailed).not.toHaveBeenCalled();
  });
});
