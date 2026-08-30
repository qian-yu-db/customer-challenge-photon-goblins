-- Migration: 001_initial_schema
-- Project: meridian-bank
-- Branch: production
-- Applied: 2026-08-24
-- Author: q.yu@databricks.com
-- Description: Initial operational schema for RM retention desk agent

-- Schema setup
CREATE SCHEMA IF NOT EXISTS app;

-- Products reference table (BM25-indexed)
CREATE TABLE app.products (
    product_id   TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    segment      TEXT NOT NULL,
    rate_apy     NUMERIC(6,4) NOT NULL,
    min_balance_usd NUMERIC(14,2),
    description  TEXT,
    is_active    BOOLEAN DEFAULT TRUE,
    search_vector tsvector
);

-- BM25 index for natural-language product search
CREATE INDEX products_search_bm25 ON app.products USING bm25 (search_vector);

-- RM Actions table (agent-writable, FK-constrained)
CREATE TABLE app.rm_actions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id           TEXT NOT NULL,
    action_type           TEXT NOT NULL,
    offered_product_id    TEXT REFERENCES app.products(product_id),
    rate_apy              NUMERIC(6,4),
    drafted_note          TEXT,
    predicted_retained_usd NUMERIC(14,2),
    status                TEXT NOT NULL DEFAULT 'pending',
    approved_by           TEXT,
    audit_trail           JSONB DEFAULT '[]'::jsonb,
    created_at            TIMESTAMPTZ DEFAULT now(),
    decided_at            TIMESTAMPTZ,
    memo                  TEXT
);

-- FK to synced customer position (cross-schema)
ALTER TABLE app.rm_actions
    ADD CONSTRAINT fk_rm_actions_customer
    FOREIGN KEY (customer_id) REFERENCES customer_challenge.synced_customer_position(customer_id);

-- What-if scenarios table (agent-writable)
CREATE TABLE app.what_if_scenarios (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id      TEXT NOT NULL,
    scenario_inputs  JSONB NOT NULL,
    predicted_outcomes JSONB NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app.what_if_scenarios
    ADD CONSTRAINT fk_whatif_customer
    FOREIGN KEY (customer_id) REFERENCES customer_challenge.synced_customer_position(customer_id);

-- Views for app-layer access to synced UC data
CREATE VIEW app.customer_position AS
    SELECT * FROM customer_challenge.synced_customer_position;

CREATE VIEW app.open_atrisk AS
    SELECT * FROM customer_challenge.synced_open_atrisk;

CREATE VIEW app.nba_recommendations AS
    SELECT * FROM customer_challenge.synced_nba_recommendations;
