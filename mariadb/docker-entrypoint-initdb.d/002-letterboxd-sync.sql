-- Letterboxd sync state.
-- Safe to re-run: this file runs automatically only on an empty data
-- directory, so an existing database gets it applied by hand.

-- Added with DEFAULT 'skipped' so that every pre-existing row is born
-- 'skipped' and is never pushed to Letterboxd.
ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS letterboxdStatus
    ENUM('pending','synced','failed','skipped') NOT NULL DEFAULT 'skipped';

-- New rows must queue, so flip the default now that existing rows are set.
-- Do NOT replace this pair with an UPDATE ... WHERE letterboxdStatus='pending':
-- that is not safe to re-run, as a second run would skip genuine pending work.
ALTER TABLE movies ALTER COLUMN letterboxdStatus SET DEFAULT 'pending';

ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS letterboxdUri VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS letterboxdAttempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS letterboxdLastAttempt DATETIME NULL,
  ADD COLUMN IF NOT EXISTS letterboxdError VARCHAR(512) NULL;

CREATE INDEX IF NOT EXISTS idx_movies_lbstatus
  ON movies (letterboxdStatus, letterboxdLastAttempt);
