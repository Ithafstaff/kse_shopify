CREATE TABLE IF NOT EXISTS linendipity_shopify_sessions (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  state TEXT NOT NULL,
  is_online BOOLEAN NOT NULL,
  scope TEXT,
  expires TIMESTAMPTZ,
  access_token TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS linendipity_one_offline_session_per_shop
  ON linendipity_shopify_sessions (shop)
  WHERE is_online = FALSE;

CREATE TABLE IF NOT EXISTS linendipity_draft_attempts (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type = 'SAVE_CART_DRAFT'),
  idempotency_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATING', 'CREATED', 'FAILED')),
  draft_order_gid TEXT,
  draft_order_name TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop, customer_id, operation_type, idempotency_key)
);
