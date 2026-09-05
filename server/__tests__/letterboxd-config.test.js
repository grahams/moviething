'use strict';

const { loadConfig } = require('../letterboxd/config');

describe('loadConfig', () => {
  it('is disabled when the flag is absent', () => {
    expect(loadConfig({})).toEqual({ enabled: false });
  });

  it('is disabled for any value other than the string "true"', () => {
    expect(loadConfig({ MOVIETHING_LETTERBOXD_ENABLED: '1' })).toEqual({ enabled: false });
    expect(loadConfig({ MOVIETHING_LETTERBOXD_ENABLED: 'yes' })).toEqual({ enabled: false });
    expect(loadConfig({ MOVIETHING_LETTERBOXD_ENABLED: 'false' })).toEqual({ enabled: false });
  });

  it('does not require a cookie while disabled', () => {
    expect(() => loadConfig({})).not.toThrow();
  });

  it('throws when enabled without a cookie', () => {
    expect(() => loadConfig({ MOVIETHING_LETTERBOXD_ENABLED: 'true' }))
      .toThrow(/MOVIETHING_LETTERBOXD_COOKIE/);
  });

  it('applies documented defaults when enabled', () => {
    const c = loadConfig({
      MOVIETHING_LETTERBOXD_ENABLED: 'true',
      MOVIETHING_LETTERBOXD_COOKIE: 'sess=abc'
    });
    expect(c).toEqual({
      enabled: true, cookie: 'sess=abc', csrf: '',
      intervalSeconds: 300, batchLimit: 10, pauseThreshold: 25
    });
  });

  it('parses numeric overrides', () => {
    const c = loadConfig({
      MOVIETHING_LETTERBOXD_ENABLED: 'true',
      MOVIETHING_LETTERBOXD_COOKIE: 'sess=abc',
      MOVIETHING_LETTERBOXD_INTERVAL: '60',
      MOVIETHING_LETTERBOXD_BATCH_LIMIT: '3',
      MOVIETHING_LETTERBOXD_PAUSE_THRESHOLD: '50'
    });
    expect(c.intervalSeconds).toBe(60);
    expect(c.batchLimit).toBe(3);
    expect(c.pauseThreshold).toBe(50);
  });

  it('rejects a non-numeric override rather than silently defaulting', () => {
    expect(() => loadConfig({
      MOVIETHING_LETTERBOXD_ENABLED: 'true',
      MOVIETHING_LETTERBOXD_COOKIE: 'sess=abc',
      MOVIETHING_LETTERBOXD_BATCH_LIMIT: 'ten'
    })).toThrow(/MOVIETHING_LETTERBOXD_BATCH_LIMIT/);
  });

  it('rejects a zero or negative override', () => {
    expect(() => loadConfig({
      MOVIETHING_LETTERBOXD_ENABLED: 'true',
      MOVIETHING_LETTERBOXD_COOKIE: 'sess=abc',
      MOVIETHING_LETTERBOXD_INTERVAL: '0'
    })).toThrow(/MOVIETHING_LETTERBOXD_INTERVAL/);
  });
});
