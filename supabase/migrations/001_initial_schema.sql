-- Fila de pedidos recebidos via webhook da Tray
CREATE TABLE IF NOT EXISTS order_queue (
  id BIGSERIAL PRIMARY KEY,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  tray_order_data JSONB,
  linx_response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(scope_id)
);

CREATE INDEX IF NOT EXISTS idx_order_queue_status ON order_queue(status);
CREATE INDEX IF NOT EXISTS idx_order_queue_created ON order_queue(created_at);

-- Tokens da Tray (substitui tray-token.json em disco)
CREATE TABLE IF NOT EXISTS tray_tokens (
  id SERIAL PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  api_host TEXT NOT NULL,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log de sincronizações de estoque
CREATE TABLE IF NOT EXISTS sync_logs (
  id BIGSERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  total_items INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  duration_ms INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_queue_updated_at
  BEFORE UPDATE ON order_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tray_tokens_updated_at
  BEFORE UPDATE ON tray_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
