'use strict';

const { runOnce, imdbIdFrom, MAX_ATTEMPTS } = require('../letterboxd/queue');
const { AuthError, TransientError, PermanentError } = require('../letterboxd/errors');

function makeDb(overrides = {}) {
  return {
    getPendingCount: jest.fn().mockResolvedValue(1),
    getEligibleRows: jest.fn().mockResolvedValue([]),
    markSynced: jest.fn().mockResolvedValue(),
    markFailed: jest.fn().mockResolvedValue(),
    markSkipped: jest.fn().mockResolvedValue(),
    recordAttempt: jest.fn().mockResolvedValue(),
    ...overrides
  };
}

function row(over = {}) {
  return {
    id: 1,
    movieTitle: 'Heat',
    viewingDate: new Date('1995-12-15T00:00:00Z'),
    movieURL: 'https://www.imdb.com/title/tt0113277/',
    firstViewing: 1,
    movieReview: 'Great',
    letterboxdAttempts: 0,
    ...over
  };
}

describe('imdbIdFrom', () => {
  it('extracts 7- and 8-digit ids', () => {
    expect(imdbIdFrom('https://www.imdb.com/title/tt0113277/')).toBe('tt0113277');
    expect(imdbIdFrom('https://www.imdb.com/title/tt12345678/')).toBe('tt12345678');
  });

  it('returns null for a festival url with no imdb id', () => {
    expect(imdbIdFrom('https://iffboston.org/events/test-short/')).toBeNull();
  });

  it('returns null for null or empty input', () => {
    expect(imdbIdFrom(null)).toBeNull();
    expect(imdbIdFrom('')).toBeNull();
  });
});

describe('runOnce', () => {
  it('pushes a pending row and marks it synced', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row()]) });
    const client = { logEntry: jest.fn().mockResolvedValue({ uri: 'https://lb/x/1/' }) };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(client.logEntry).toHaveBeenCalledWith({
      imdbId: 'tt0113277',
      watchedDate: '1995-12-15',
      rewatch: false,        // firstViewing === 1 means NOT a rewatch
      review: 'Great'
    });
    expect(db.markSynced).toHaveBeenCalledWith(1, 'https://lb/x/1/');
    expect(result.pushed).toBe(1);
  });

  it('sends rewatch:true when firstViewing is 0', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ firstViewing: 0 })]) });
    const client = { logEntry: jest.fn().mockResolvedValue({ uri: 'u' }) };
    await runOnce({ client, db, limit: 10, pauseThreshold: 25 });
    expect(client.logEntry.mock.calls[0][0].rewatch).toBe(true);
  });

  it('sends an empty review when movieReview is null', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ movieReview: null })]) });
    const client = { logEntry: jest.fn().mockResolvedValue({ uri: 'u' }) };
    await runOnce({ client, db, limit: 10, pauseThreshold: 25 });
    expect(client.logEntry.mock.calls[0][0].review).toBe('');
  });

  it('pauses without pushing when pending exceeds the threshold', async () => {
    const db = makeDb({ getPendingCount: jest.fn().mockResolvedValue(200) });
    const client = { logEntry: jest.fn() };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(result.paused).toBe(true);
    expect(result.pending).toBe(200);
    expect(client.logEntry).not.toHaveBeenCalled();
    expect(db.getEligibleRows).not.toHaveBeenCalled();  // pause precedes selection
  });

  it('does not pause when pending exactly equals the threshold', async () => {
    const db = makeDb({ getPendingCount: jest.fn().mockResolvedValue(25) });
    const client = { logEntry: jest.fn().mockResolvedValue({ uri: 'u' }) };
    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });
    expect(result.paused).toBe(false);
  });

  it('skips (does not fail) a row with no imdb id', async () => {
    const db = makeDb({
      getEligibleRows: jest.fn().mockResolvedValue([row({ movieURL: 'https://iffboston.org/x/' })])
    });
    const client = { logEntry: jest.fn() };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(db.markSkipped).toHaveBeenCalledWith(1, 'no imdb id');
    expect(db.markFailed).not.toHaveBeenCalled();
    expect(client.logEntry).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('halts the whole run on AuthError without consuming an attempt', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ id: 1 }), row({ id: 2 })]) });
    const client = { logEntry: jest.fn().mockRejectedValue(new AuthError('session expired')) };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(result.authFailed).toBe(true);
    expect(client.logEntry).toHaveBeenCalledTimes(1);   // stopped, did not try row 2
    expect(db.recordAttempt).not.toHaveBeenCalled();    // retry budget untouched
    expect(db.markFailed).not.toHaveBeenCalled();       // backlog stays pending
  });

  it('fails a row permanently on PermanentError and continues', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ id: 1 }), row({ id: 2 })]) });
    const client = {
      logEntry: jest.fn()
        .mockRejectedValueOnce(new PermanentError('film not found'))
        .mockResolvedValueOnce({ uri: 'u' })
    };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(db.markFailed).toHaveBeenCalledWith(1, 'film not found');
    expect(db.markSynced).toHaveBeenCalledWith(2, 'u');
    expect(result.failed).toBe(1);
    expect(result.pushed).toBe(1);
  });

  it('records an attempt and stays pending on TransientError', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ letterboxdAttempts: 0 })]) });
    const client = { logEntry: jest.fn().mockRejectedValue(new TransientError('503')) };

    await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(db.recordAttempt).toHaveBeenCalledWith(1, '503');
    expect(db.markFailed).not.toHaveBeenCalled();
  });

  it('gives up on a transient error at the attempt cap', async () => {
    const db = makeDb({
      getEligibleRows: jest.fn().mockResolvedValue([row({ letterboxdAttempts: MAX_ATTEMPTS - 1 })])
    });
    const client = { logEntry: jest.fn().mockRejectedValue(new TransientError('503')) };

    await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(db.markFailed).toHaveBeenCalledWith(1, '503');
    expect(db.recordAttempt).not.toHaveBeenCalled();
  });

  it('treats an unrecognised error as transient rather than crashing the run', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row()]) });
    const client = { logEntry: jest.fn().mockRejectedValue(new TypeError('undefined is not a function')) };

    await expect(runOnce({ client, db, limit: 10, pauseThreshold: 25 })).resolves.toBeDefined();
    expect(db.recordAttempt).toHaveBeenCalled();
  });

  it('passes the batch limit through to the query', async () => {
    const db = makeDb();
    await runOnce({ client: { logEntry: jest.fn() }, db, limit: 3, pauseThreshold: 25 });
    expect(db.getEligibleRows).toHaveBeenCalledWith(3);
  });
});
