# Meridian Bank — AI Project Build Plan

**Catalog/Schema:** `vijay_catalog.customer_challenge`  
**Volume:** `/Volumes/vijay_catalog/customer_challenge/raw_data/`  
**Status:** Data generation complete (2026-08-27)

---

## Pre-requisite: Environment Setup ✅ DONE

- [x] Chose catalog/schema: `vijay_catalog.customer_challenge`
- [x] Created schema + `raw_data` UC Volume
- [x] Ran data generation → 6 raw parquet datasets loaded

### Generated Datasets

| Dataset | Rows | Location |
|---------|------|----------|
| raw_customers | 40,000 | `/raw_data/customers/` |
| raw_products | 11 | `/raw_data/products/` |
| raw_holdings | 120,340 | `/raw_data/holdings/` |
| raw_transactions | 3,502,008 | `/raw_data/transactions/` |
| raw_risk_snapshots | 42,860 | `/raw_data/risk_snapshots/` |
| raw_retention_campaigns | 35,000 | `/raw_data/retention_campaigns/` |

### Hero Customer Validated

- **CUST-0000214**: affluent, 12-year tenure, Dallas TX
- Holds $650K 18-Month CD (PROD-DEP-2001), maturing 2026-09-05
- Attrition risk score: 0.86 (critical)
- Servicing note: "large transfer out pending"

---

## Milestone 1 — Data Layer

*Build the governed data layer the whole solution runs on.*

**Learns:** Spark Declarative Pipelines · Medallion model · in-SQL AI (`ai_classify`) · Metric Views · AI/BI dashboards + Genie.

### Step 1.1 — Run data generation ✅ DONE

### Step 1.2 — Data exploration notebook

- Create an EDA notebook to understand distributions, validate the anomaly shape
- Confirm: affected customers have risk 0.7–0.9 vs. baseline 0.05–0.25
- Confirm: balance outflow visible in transactions from RISK_RAMP onward

### Step 1.3 — SDP Pipeline (Silver + Gold)

Build `transformation/` SQL files for a Spark Declarative Pipeline:

**Silver tables** (ingest raw parquet via `read_files()`):
- `silver_customers` — cleaned customer master
- `silver_products` — product catalog
- `silver_holdings` — account holdings with derived fields
- `silver_transactions` — transactions with date parsing
- `silver_risk_snapshots` — risk scores + servicing notes
- `silver_retention_campaigns` — historical campaign outcomes

**Gold tables:**
- `gold_customer_position` — customer-360 aggregate: tier, tenure, total balance, affected deposit balance, min days to maturity, balance-at-risk, revenue-at-risk, risk band (critical/elevated/watch/healthy)
- `gold_open_atrisk` — at-risk accounts with product details + cross-sell candidate
- `gold_nba_recommendations` — heuristic next-best-action ranking per customer (retention offer / cross-sell / RM outreach), scored by predicted retained revenue

**Key transformations:**
- `ai_classify` on `servicing_note_text` to classify churn intent
- Balance-at-risk = affected deposit balance × attrition risk
- Revenue-at-risk = balance-at-risk × NIM (0.025)
- Risk bands: critical (≥0.75), elevated (0.5–0.75), watch (0.3–0.5), healthy (<0.3)
- NBA heuristic ranks actions by net value (retained revenue − cost − margin impact)

### Step 1.4 — Metric View

Create `mv_customer_risk` per `specifications/02-uc-governance.md`:
- Dimensions: tier, risk_band, home_metro, product_type
- Measures: total_balance_at_risk, revenue_at_risk, customer_count, avg_attrition_risk

### Step 1.5 — AI/BI Dashboard + Genie Space

Per `specifications/04-ai-bi.md`:
- **Dashboard:** balance-vs-risk scatter (red/blue clusters), KPI tiles (balance-at-risk ~$159M, revenue-at-risk ~$4M, critical customers ~220), trend charts
- **Genie space:** over the gold tables, answers natural-language questions about at-risk customers

### Step 1.6 — ML NBA Model (Optional)

Per `specifications/03-ml-nba.md`:
- Train on `raw_retention_campaigns` (action × outcome history)
- Feature: balance-at-risk, attrition risk, tier, tenure, action type
- Target: net value (retained_revenue − cost − margin_impact)
- Overwrite `gold_nba_recommendations` with model predictions

---

## Milestone 2 — Lakebase (Low-Latency Serving)

*Serve the data at low latency + add the operational store the app writes to.*

**Learns:** Lakebase (managed Postgres) · syncing UC tables · writable tables · dev branches · Lakebase Search.

### Step 2.1 — Create Lakebase instance

- Create an autoscaling Lakebase project
- Create a `dev` branch for safe iteration

### Step 2.2 — Sync gold tables (read-only mirrors)

Sync into Lakebase as low-latency read-only copies:
- `app.customer_position` ← `gold_customer_position`
- `app.open_atrisk` ← `gold_open_atrisk`
- `app.nba_recommendations` ← `gold_nba_recommendations`
- `app.products` ← `raw_products`

### Step 2.3 — Writable `rm_actions` table

Create in Lakebase (not synced — app-owned):
```sql
CREATE TABLE app.rm_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  offered_product_id TEXT,
  rate_apy NUMERIC,
  drafted_note TEXT,
  predicted_retained_usd NUMERIC,
  status TEXT DEFAULT 'pending',
  approved_by TEXT,
  audit_trail JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ
);
```

### Step 2.4 — Enable Lakebase Search

- Enable hybrid text/vector search on `app.products` over `product_name` + `description`
- Powers the cross-sell NBA tool in the app

---

## Milestone 3 — Databricks App

*Build the internal tool the person actually uses.*

**Learns:** Databricks Apps · Lakebase + analytics plugins · agent loop · human-in-the-loop.

### Step 3.1 — Bootstrap (already provided)

- Layer 1 — Visualize: at-risk scatter plot, KPI surface (ships with the template)
- Agent loop + `ask_data` tool (Genie/MAS investigation) — already wired

### Step 3.2 — Layer 2: Assist (implement stubbed tools)

In `server/agent/relationshipdesk.ts`:
- **`find_atrisk_customer`** — reads `app.open_atrisk` + `app.customer_position`; returns the worst at-risk position for a customer_id (or the worst overall)
- **`search_products`** — queries Lakebase Search on `app.products`; returns ranked cross-sell candidates
- **`rank_next_best_actions`** — reads `app.nba_recommendations`; returns the three ranked options with predicted values

### Step 3.3 — Layer 3: Act (human-in-the-loop write-back)

- **`draft_action`** — agent proposes an action (retention offer / cross-sell / RM outreach) with a drafted outreach note; inserts into `rm_actions` with status `pending`
- **`approve_action`** — human clicks approve → updates `rm_actions` status to `approved`, records `approved_by` + timestamp; triggers SSE to update the queue live

### Step 3.4 — Deploy + end-to-end test

Acceptance: Marcus sees at-risk customers → asks "why is CUST-0000214 at risk?" → gets ranked NBA → approves retention offer → `rm_actions` row written → queue updates live.

---

## Milestone 4 — Unity AI Gateway

*Govern the AI the app calls.*

**Learns:** Unity AI Gateway · spend caps · guardrails · inference logging · per-entity attribution.

### Step 4.1 — Create the AI Gateway

- Set a spend cap (~$300K/yr bounded for the line of business)
- Enable content-filter guardrails (block PII leakage, inappropriate content)
- Enable inference logging to a UC table for auditability

### Step 4.2 — Route app through Gateway

- Update `config/app.json` (`agentModel`) to point at the Gateway endpoint
- All LLM calls are now: capped, guardrailed, logged, and attributable per line of business

---

## Dependency Graph

```
M1.1 (data gen) ✅
  └─→ M1.2 (EDA notebook)
  └─→ M1.3 (SDP pipeline) ─→ M1.4 (metric view)
        │                   └─→ M1.5 (dashboard + Genie)
        │                   └─→ M1.6 (ML model, optional)
        └─→ M2.1–2.4 (Lakebase) ─→ M3.1–3.4 (App) ─→ M4.1–4.2 (Gateway)
```

**Parallelizable after M1.3:**
- M1.4/M1.5 (dashboard + Genie) can run in parallel with M2 (Lakebase)
- M3 (App) depends on M2 being ready
- M4 (Gateway) wraps up last

---

## Key References

| Resource | Path |
|----------|------|
| Full spec: SDP pipeline | `specifications/01-lakeflow.md` |
| Full spec: UC governance + metric view | `specifications/02-uc-governance.md` |
| Full spec: ML NBA model | `specifications/03-ml-nba.md` |
| Full spec: Dashboard + Genie | `specifications/04-ai-bi.md` |
| App workshop guide | `app/APP_WORKSHOP.md` |
| App operations spec | `specifications/app/01_OPERATIONS.md` |
| App analytics spec | `specifications/app/02_ANALYTICS.md` |
| App data model spec | `specifications/app/03_DATA_MODEL.md` |
| Data generation script | `data_generation/generate_data.py` |
| Transformation code (to be built) | `transformation/` |
