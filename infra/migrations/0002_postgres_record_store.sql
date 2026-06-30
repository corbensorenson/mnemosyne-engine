-- Driver-friendly JSONB record store for production API persistence.
--
-- 0001 keeps the long-term relational foundation. This table gives every
-- MnemosyneStore entity an immediately durable Postgres home while the
-- normalized projections continue to mature.

CREATE TABLE IF NOT EXISTS mnemosyne_records (
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  owner_id TEXT,
  sort_key TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (record_type, record_id)
);

CREATE INDEX IF NOT EXISTS idx_mnemosyne_records_owner
  ON mnemosyne_records(record_type, owner_id, sort_key DESC);

CREATE INDEX IF NOT EXISTS idx_mnemosyne_records_updated
  ON mnemosyne_records(record_type, updated_at DESC);
