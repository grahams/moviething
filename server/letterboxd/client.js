'use strict';

const { AuthError, TransientError, PermanentError } = require('./errors');

const BASE = 'https://letterboxd.com';
const LOG_PATH = '/s/save-diary-entry';
// Letterboxd serves a different response to obvious bots.
const USER_AGENT = 'Mozilla/5.0 (compatible; moviething/1.0)';

function createClient(config) {
  // A configured value always wins; otherwise this gets filled in once the
  // film page's Set-Cookie header is harvested.
  let csrfToken = config.csrf;

  function harvestCsrf(res) {
    if (!res.headers || typeof res.headers.getSetCookie !== 'function') return;
    for (const cookie of res.headers.getSetCookie()) {
      const match = cookie.match(/(?:^|;\s*)com\.xk72\.webparts\.csrf=([^;]+)/);
      if (match) csrfToken = match[1];
    }
  }

  function headers(extra) {
    return {
      Cookie: csrfToken
        ? `${config.cookie}; com.xk72.webparts.csrf=${csrfToken}`
        : config.cookie,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
      ...extra
    };
  }

  // Any transport-level failure is retryable; only Letterboxd's own answers
  // are permanent.
  async function request(url, options) {
    try {
      return await fetch(url, options);
    } catch (err) {
      throw new TransientError(`request to ${url} failed: ${err.message}`, { cause: err });
    }
  }

  async function resolveFilmId(imdbId) {
    const res = await request(`${BASE}/imdb/${imdbId}/`, {
      headers: headers(), redirect: 'follow'
    });

    harvestCsrf(res);

    if (res.url && res.url.includes('/sign-in')) {
      throw new AuthError('session rejected: redirected to sign-in');
    }
    if (res.status === 404) {
      throw new PermanentError(`no letterboxd film for ${imdbId}`);
    }
    if (res.status >= 500) {
      throw new TransientError(`film lookup returned ${res.status}`);
    }
    if (!res.ok) {
      throw new PermanentError(`film lookup returned ${res.status}`);
    }

    const html = await res.text();
    const match = html.match(/data-film-id="(\d+)"/);
    if (!match) {
      // Either the markup changed or the page is not a film page. Not
      // retryable either way; a human needs to look.
      throw new PermanentError(`could not find film id for ${imdbId}`);
    }
    return match[1];
  }

  async function logEntry({ imdbId, watchedDate, rewatch, review }) {
    const filmId = await resolveFilmId(imdbId);

    if (!csrfToken) {
      // Never post an empty __csrf — Letterboxd's rejection of that is an
      // opaque, hard-to-diagnose failure.
      throw new AuthError(
        'no CSRF token available: set MOVIETHING_LETTERBOXD_CSRF or ensure the film page sets one'
      );
    }

    const body = new URLSearchParams({
      __csrf: csrfToken,
      filmId,
      specifiedDate: 'true',
      viewingDateStr: watchedDate,
      rewatch: String(rewatch),
      review: review || '',
      tags: '',
      rating: '',
      liked: 'false'
    });

    const res = await request(`${BASE}${LOG_PATH}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: body.toString()
    });

    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`log entry rejected with ${res.status}`);
    }
    if (res.status >= 500) {
      throw new TransientError(`log entry returned ${res.status}`);
    }

    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      // An HTML body here means a maintenance or challenge page, not a
      // rejection of this entry. Retrying is reasonable.
      throw new TransientError('log entry returned a non-JSON response');
    }

    if (!payload.result) {
      const detail = (payload.messages || []).join('; ') || 'unknown error';
      throw new PermanentError(`letterboxd rejected the entry: ${detail}`);
    }

    // The endpoint may return either an absolute URL or a site-root path.
    const uri = payload.url
      ? (payload.url.startsWith('http') ? payload.url : `${BASE}${payload.url}`)
      : BASE;
    return { uri };
  }

  return { logEntry };
}

module.exports = { createClient };
