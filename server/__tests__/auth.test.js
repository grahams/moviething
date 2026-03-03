const { requireAuth } = require('../middleware/auth');

function makeReq(headers = {}) {
  return { headers };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requireAuth middleware', () => {
  const next = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MOVIETHING_VALID_API_KEY = 'test_api_key';
  });

  it('calls next() when X-Authentik-Username is present', () => {
    requireAuth(makeReq({ 'x-authentik-username': 'alice' }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when X-Api-Key matches the env var', () => {
    requireAuth(makeReq({ 'x-api-key': 'test_api_key' }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when neither header is present', () => {
    const res = makeRes();
    requireAuth(makeReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Authentik-Username is whitespace-only', () => {
    const res = makeRes();
    requireAuth(makeReq({ 'x-authentik-username': '   ' }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
