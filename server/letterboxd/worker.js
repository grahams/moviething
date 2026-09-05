'use strict';

/**
 * Interval-driven queue drainer.
 *
 * `runOnce` is injected so the scheduling behaviour (overlap, pause, auth
 * halt) can be tested with fake timers and no network.
 */
function createWorker({ config, db, client, runOnce }) {
  let timer = null;
  let running = false;
  const state = {
    paused: false,
    authOk: true,
    lastRun: null,
    lastResult: null,
    lastError: null
  };

  async function execute({ confirm = false } = {}) {
    if (running) return { ok: false, reason: 'busy' };
    running = true;
    try {
      const result = await runOnce({
        client,
        db,
        limit: config.batchLimit,
        // A confirmed manual run is the operator saying "yes, push the backlog".
        pauseThreshold: confirm ? Infinity : config.pauseThreshold
      });
      state.lastResult = result;
      state.paused = result.paused;
      state.authOk = !result.authFailed;
      state.lastError = null;
      if (result.authFailed) stop();
      return { ok: true, result };
    } catch (err) {
      state.lastError = err.message;
      return { ok: false, reason: 'error', error: err.message };
    } finally {
      state.lastRun = new Date().toISOString();
      running = false;
    }
  }

  function start() {
    if (!config.enabled || timer) return;
    timer = setInterval(() => { execute(); }, config.intervalSeconds * 1000);
    // Do not hold the event loop open; the HTTP server governs process life.
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // A manual run always executes, even after start() halted on an auth
  // failure — that is how a freshly pasted cookie gets tried.
  async function runNow(options = {}) {
    const outcome = await execute(options);
    if (outcome.ok && !outcome.result.authFailed && !timer && config.enabled) start();
    return outcome;
  }

  function getState() {
    return { enabled: config.enabled, running, ...state };
  }

  return { start, stop, runNow, getState };
}

module.exports = { createWorker };
