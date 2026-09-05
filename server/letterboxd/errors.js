'use strict';

class LetterboxdError extends Error {
  constructor(message, options) {
    super(message);
    this.name = this.constructor.name;
    if (options && options.cause) this.cause = options.cause;
  }
}

// Session rejected. Halts the whole run; never consumes a retry attempt.
class AuthError extends LetterboxdError {}

// Network blip or 5xx. Worth retrying with backoff.
class TransientError extends LetterboxdError {}

// Letterboxd understood the request and refused it. Retrying cannot help.
class PermanentError extends LetterboxdError {}

// The POST left the process but its outcome is unknown — Letterboxd may or may
// not have saved the entry. Never retried: a retry risks a duplicate in a public
// diary, which cannot be undone automatically.
class AmbiguousError extends LetterboxdError {}

module.exports = { LetterboxdError, AuthError, TransientError, PermanentError, AmbiguousError };
