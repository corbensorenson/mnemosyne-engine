-- Indexes for first-party worker job leasing over the JSONB record store.
--
-- The claim query still owns correctness through row locks and SKIP LOCKED;
-- these indexes keep queue/type/status scans practical as job volume grows.

CREATE INDEX IF NOT EXISTS idx_mnemosyne_records_job_queue_status
  ON mnemosyne_records (
    (payload->>'queue'),
    (payload->>'status'),
    (payload->>'run_after')
  )
  WHERE record_type = 'job';

CREATE INDEX IF NOT EXISTS idx_mnemosyne_records_job_handler_key
  ON mnemosyne_records (
    ((payload->>'queue') || ':' || (payload->>'type'))
  )
  WHERE record_type = 'job';
