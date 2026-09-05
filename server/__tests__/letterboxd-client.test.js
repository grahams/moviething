'use strict';

const { createClient } = require('../letterboxd/client');
const { AuthError, TransientError, PermanentError } = require('../letterboxd/errors');

const config = { enabled: true, cookie: 'sess=abc', csrf: 'tok123' };

// Native fetch, not the node-fetch mock in __tests__/setup.js.
function mockFetch(...responses) {
  const fn = jest.fn();
  responses.forEach(r => fn.mockResolvedValueOnce(r));
  global.fetch = fn;
  return fn;
}

function filmPage(id = '51234') {
  return {
    ok: true, status: 200, url: 'https://letterboxd.com/film/heat/',
    text: async () => `<div data-film-id="${id}"></div>`,
    headers: new Map()
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300, status,
    url: 'https://letterboxd.com/s/save-diary-entry',
    text: async () => JSON.stringify(body),
    headers: new Map()
  };
}

const entry = { imdbId: 'tt0113277', watchedDate: '1995-12-15', rewatch: false, review: 'Great' };

afterEach(() => { delete global.fetch; jest.clearAllMocks(); });

describe('logEntry', () => {
  it('resolves the film id then posts the diary entry', async () => {
    const fetchMock = mockFetch(
      filmPage('51234'),
      jsonResponse(200, { result: true, url: '/user/film/heat/' })
    );

    const result = await createClient(config).logEntry(entry);

    expect(fetchMock.mock.calls[0][0]).toContain('/imdb/tt0113277');
    const [url, opts] = fetchMock.mock.calls[1];
    expect(url).toContain('/s/save-diary-entry');
    expect(opts.method).toBe('POST');
    const body = new URLSearchParams(opts.body);
    expect(body.get('filmId')).toBe('51234');
    expect(body.get('viewingDateStr')).toBe('1995-12-15');
    expect(body.get('rewatch')).toBe('false');
    expect(body.get('review')).toBe('Great');
    expect(body.get('__csrf')).toBe('tok123');
    expect(result.uri).toContain('/user/film/heat/');
  });

  it('sends the session cookie on both requests', async () => {
    const fetchMock = mockFetch(filmPage(), jsonResponse(200, { result: true, url: '/x/' }));
    await createClient(config).logEntry(entry);
    fetchMock.mock.calls.forEach(([, opts]) => {
      expect(opts.headers.Cookie).toContain('sess=abc');
    });
  });

  it('throws AuthError when redirected to sign-in', async () => {
    mockFetch({
      ok: true, status: 200, url: 'https://letterboxd.com/sign-in/',
      text: async () => '<html>sign in</html>', headers: new Map()
    });
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(AuthError);
  });

  it('throws AuthError on a 403 from the log endpoint', async () => {
    mockFetch(filmPage(), jsonResponse(403, { result: false, messages: ['Not signed in'] }));
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(AuthError);
  });

  it('throws PermanentError when the imdb id resolves to no film', async () => {
    mockFetch({
      ok: false, status: 404, url: 'https://letterboxd.com/imdb/tt9999999/',
      text: async () => 'Not found', headers: new Map()
    });
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(PermanentError);
  });

  it('throws PermanentError when the film page carries no film id', async () => {
    mockFetch({
      ok: true, status: 200, url: 'https://letterboxd.com/film/heat/',
      text: async () => '<html>no id here</html>', headers: new Map()
    });
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(PermanentError);
  });

  it('throws PermanentError when the endpoint reports result:false', async () => {
    mockFetch(filmPage(), jsonResponse(200, { result: false, messages: ['Invalid date'] }));
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(PermanentError);
  });

  it('throws TransientError on a 5xx', async () => {
    mockFetch(filmPage(), jsonResponse(503, {}));
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(TransientError);
  });

  it('throws TransientError on a network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(TransientError);
  });

  it('throws TransientError when the response is not JSON', async () => {
    mockFetch(filmPage(), {
      ok: true, status: 200, url: 'https://letterboxd.com/s/save-diary-entry',
      text: async () => '<html>maintenance</html>', headers: new Map()
    });
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(TransientError);
  });

  it('sends rewatch=true when rewatch is set', async () => {
    const fetchMock = mockFetch(filmPage(), jsonResponse(200, { result: true, url: '/x/' }));
    await createClient(config).logEntry({ ...entry, rewatch: true });
    expect(new URLSearchParams(fetchMock.mock.calls[1][1].body).get('rewatch')).toBe('true');
  });

  it('uses the configured csrf token when one is supplied', async () => {
    const fetchMock = mockFetch(filmPage(), jsonResponse(200, { result: true, url: '/x/' }));
    await createClient(config).logEntry(entry);
    expect(new URLSearchParams(fetchMock.mock.calls[1][1].body).get('__csrf')).toBe('tok123');
  });

  it('harvests the csrf token from the film page when none is configured', async () => {
    const page = filmPage();
    page.headers = { getSetCookie: () => ['com.xk72.webparts.csrf=harvested; Path=/'] };
    const fetchMock = mockFetch(page, jsonResponse(200, { result: true, url: '/x/' }));
    await createClient({ ...config, csrf: '' }).logEntry(entry);
    expect(new URLSearchParams(fetchMock.mock.calls[1][1].body).get('__csrf')).toBe('harvested');
  });

  it('throws AuthError rather than posting an empty csrf token', async () => {
    mockFetch(filmPage(), jsonResponse(200, { result: true, url: '/x/' }));
    await expect(createClient({ ...config, csrf: '' }).logEntry(entry))
      .rejects.toThrow(/MOVIETHING_LETTERBOXD_CSRF/);
  });
});
