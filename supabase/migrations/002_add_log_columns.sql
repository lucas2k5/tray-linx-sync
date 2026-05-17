-- sync_logs: contadores separados e timestamp de início do job
ALTER TABLE sync_logs
  ADD COLUMN IF NOT EXISTS not_found_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ;

-- order_queue: campos de acesso rápido sem precisar de query JSONB
ALTER TABLE order_queue
  ADD COLUMN IF NOT EXISTS customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS order_value    NUMERIC,
  ADD COLUMN IF NOT EXISTS items_count    INTEGER,
  ADD COLUMN IF NOT EXISTS payment_method TEXT;
