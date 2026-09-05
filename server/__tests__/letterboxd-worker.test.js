'use strict';

const { createWorker } = require('../letterboxd/worker');

const config = { enabled: true, intervalSeconds: 300, batchLimit: 10, pauseThreshold: 25 };
const ok = { pushed: 1, failed: 0, skipped: 0, paused: false, authFailed: false, pending: 1 };

function makeWorker(runOnce, cfg = config) {
  return createWorker({ config: cfg, db: {}, client: {}, runOnce });
}

describe('createWorker', () => {
  afterEach(() => jest.useRealTimers());

  it('does not schedule anything when disabled', () => {
    jest.useFakeTimers();
    const runOnce = jest.fn();
    const w = makeWorker(runOnce, { enabled: false });
    w.start();
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(runOnce).not.toHaveBeenCalled();
    expect(w.getState().enabled).toBe(false);
  });

  it('runs on the configured interval once started', async () => {
    jest.useFakeTimers();
    const runOnce = jest.fn().mockResolvedValue(ok);
    const w = makeWorker(runOnce);
    w.start();
    expect(runOnce).not.toHaveBeenCalled();       // no immediate run on boot
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    w.stop();
  });

  it('stop() prevents further runs', async () => {
    jest.useFakeTimers();
    const runOnce = jest.fn().mockResolvedValue(ok);
    const w = makeWorker(runOnce);
    w.start();
    w.stop();
    await jest.advanceTimersByTimeAsync(900 * 1000);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('never overlaps runs', async () => {
    jest.useFakeTimers();
    let release;
    const runOnce = jest.fn(() => new Promise(r => { release = () => r(ok); }));
    const w = makeWorker(runOnce);
    w.start();
    await jest.advanceTimersByTimeAsync(300 * 1000);
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(1);   // second tick skipped while busy
    release();
    w.stop();
  });

  it('records authOk:false after an auth failure and stops the timer', async () => {
    jest.useFakeTimers();
    const runOnce = jest.fn().mockResolvedValue({ ...ok, authFailed: true });
    const w = makeWorker(runOnce);
    w.start();
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(w.getState().authOk).toBe(false);
    // Hammering a dead session helps nobody; a new cookie needs a restart or
    // an explicit runNow().
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('surfaces the paused flag in state', async () => {
    const runOnce = jest.fn().mockResolvedValue({ ...ok, paused: true, pending: 200 });
    const w = makeWorker(runOnce);
    await w.runNow();
    expect(w.getState().paused).toBe(true);
  });

  it('runNow({confirm:true}) overrides the pause threshold for one run', async () => {
    const runOnce = jest.fn().mockResolvedValue(ok);
    const w = makeWorker(runOnce);
    await w.runNow({ confirm: true });
    expect(runOnce.mock.calls[0][0].pauseThreshold).toBe(Infinity);
  });

  it('runNow() without confirm uses the configured threshold', async () => {
    const runOnce = jest.fn().mockResolvedValue(ok);
    const w = makeWorker(runOnce);
    await w.runNow();
    expect(runOnce.mock.calls[0][0].pauseThreshold).toBe(25);
  });

  it('runNow() clears a prior auth failure so a new cookie takes effect', async () => {
    const runOnce = jest.fn()
      .mockResolvedValueOnce({ ...ok, authFailed: true })
      .mockResolvedValueOnce(ok);
    const w = makeWorker(runOnce);
    await w.runNow();
    expect(w.getState().authOk).toBe(false);
    await w.runNow();
    expect(w.getState().authOk).toBe(true);
  });

  it('survives a thrown error and records it', async () => {
    const runOnce = jest.fn().mockRejectedValue(new Error('db down'));
    const w = makeWorker(runOnce);
    await expect(w.runNow()).resolves.toBeDefined();
    expect(w.getState().lastError).toMatch(/db down/);
  });
});
