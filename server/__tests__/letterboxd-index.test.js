'use strict';

// A thrown loadConfig() must not propagate as an uncaught exception at
// require time: server/routes/letterboxd.js requires this module at module
// scope, outside createServer's try/catch, so throwing here would crash the
// whole test suite for anyone with a half-configured .env.
jest.mock('../letterboxd/config', () => ({
  loadConfig: jest.fn(() => {
    throw new Error('MOVIETHING_LETTERBOXD_ENABLED is true but MOVIETHING_LETTERBOXD_COOKIE is not set');
  })
}));

describe('letterboxd/index when loadConfig throws', () => {
  it('surfaces the error as configError instead of throwing', () => {
    let mod;
    expect(() => { mod = require('../letterboxd/index'); }).not.toThrow();
    expect(mod.configError).toMatch(/MOVIETHING_LETTERBOXD_COOKIE/);
    expect(mod.config).toEqual({ enabled: false });
  });
});
