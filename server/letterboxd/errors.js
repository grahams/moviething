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

module.exports = { LetterboxdError, AuthError, TransientError, PermanentError };
