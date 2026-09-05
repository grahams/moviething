'use strict';

const request = require('supertest');

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

jest.mock('../letterboxd', () => ({ worker: mockWorker, config: { enabled: true } }));
jest.mock('../letterboxd/queries', () => mockQueries);

const { app } = require('../index');

const AUTH = ['X-Authentik-Username', 'testuser'];

describe('letterboxd routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorker.getState.mockReturnValue({
      enabled: true, running: false, paused: false, authOk: true,
      lastRun: '2026-09-05T00:00:00.000Z', lastResult: null, lastError: null
    });
    mockQueries.getCounts.mockResolvedValue({ pending: 2, synced: 10, failed: 1, skipped: 400 });
    mockQueries.getRecentFailures.mockResolvedValue([
      { id: 7, movieTitle: 'Heat', letterboxdError: 'boom', letterboxdAttempts: 5, letterboxdLastAttempt: null }
    ]);
  });

  describe('GET /api/letterboxd/status', () => {
    it('returns worker state, counts and recent failures', async () => {
      const res = await request(app).get('/api/letterboxd/status').set(...AUTH).expect(200);
      expect(res.body.data.enabled).toBe(true);
      expect(res.body.data.authOk).toBe(true);
      expect(res.body.data.counts).toEqual({ pending: 2, synced: 10, failed: 1, skipped: 400 });
      expect(res.body.data.recentFailures).toHaveLength(1);
    });

    it('requires auth', async () => {
      await request(app).get('/api/letterboxd/status').expect(401);
    });
  });

  describe('POST /api/letterboxd/sync', () => {
    it('triggers a run and returns the result', async () => {
      mockWorker.runNow.mockResolvedValue({ ok: true, result: { pushed: 2, failed: 0, skipped: 0, paused: false } });
      const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(200);
      expect(mockWorker.runNow).toHaveBeenCalledWith({ confirm: false });
      expect(res.body.data.pushed).toBe(2);
    });

    it('passes confirm=true through from the query string', async () => {
      mockWorker.runNow.mockResolvedValue({ ok: true, result: { pushed: 200, failed: 0, skipped: 0, paused: false } });
      await request(app).post('/api/letterboxd/sync?confirm=true').set(...AUTH).expect(200);
      expect(mockWorker.runNow).toHaveBeenCalledWith({ confirm: true });
    });

    it('reports 409 when the run paused on the threshold', async () => {
      mockWorker.runNow.mockResolvedValue({ ok: true, result: { pushed: 0, failed: 0, skipped: 0, paused: true, pending: 200 } });
      const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(409);
      expect(res.body.error).toMatch(/confirm=true/);
    });

    it('returns 409 when a run is already in progress', async () => {
      mockWorker.runNow.mockResolvedValue({ ok: false, reason: 'busy' });
      const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(409);
      expect(res.body.error).toMatch(/already in progress/);
    });

    it('returns 500, not 409, when the run itself errored', async () => {
      // A database failure must not be reported to the user as "try again".
      mockWorker.runNow.mockResolvedValue({ ok: false, reason: 'error', error: 'db down' });
      const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(500);
      expect(res.body.error).toMatch(/db down/);
    });

    it('requires auth', async () => {
      await request(app).post('/api/letterboxd/sync').expect(401);
      expect(mockWorker.runNow).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/letterboxd/retry', () => {
    it('resets failed rows and reports the count', async () => {
      mockQueries.resetFailed.mockResolvedValue(3);
      const res = await request(app).post('/api/letterboxd/retry').set(...AUTH).expect(200);
      expect(res.body.data).toEqual({ ok: true, requeued: 3 });
    });

    it('requires auth', async () => {
      await request(app).post('/api/letterboxd/retry').expect(401);
      expect(mockQueries.resetFailed).not.toHaveBeenCalled();
    });
  });
});
