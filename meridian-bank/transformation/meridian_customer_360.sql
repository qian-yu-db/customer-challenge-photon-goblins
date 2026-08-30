-- Databricks notebook source
-- DBTITLE 1,Meridian Bank — Customer 360 SDP Pipeline
-- Meridian Bank — Attrition & Next-Best-Action
-- Spark Declarative Pipeline: raw parquet → silver → gold
--
-- Pipeline configuration required:
--   catalog: the UC catalog (e.g. vijay_catalog)
--   schema: the UC schema (e.g. customer_challenge)
--
-- Raw data lives in: /Volumes/${catalog}/${schema}/raw_data/<dataset>/

-- COMMAND ----------

-- DBTITLE 1,Silver: note_churn_flags — ai_classify dedup MV
-- Deduplicate servicing notes and classify each unique string ONCE via ai_classify.
-- This avoids issuing thousands of LLM calls for repeated note strings.
CREATE OR REFRESH MATERIALIZED VIEW note_churn_flags AS
SELECT
  servicing_note_text,
  CASE ai_classify(servicing_note_text, ARRAY('churn_signal', 'at_risk', 'healthy'))
    WHEN 'churn_signal' THEN 1.0
    WHEN 'at_risk'      THEN 0.6
    ELSE 0.1
  END AS churn_signal_score
FROM (
  SELECT DISTINCT servicing_note_text
  FROM read_files('/Volumes/${catalog}/${schema}/raw_data/risk_snapshots')
  WHERE servicing_note_text IS NOT NULL
);

-- COMMAND ----------

-- DBTITLE 1,Silver: silver_holdings — denormalized customer×account fact
-- Per customer×account denormalized fact with product + customer dimensions.
CREATE OR REFRESH MATERIALIZED VIEW silver_holdings AS
SELECT
  c.customer_id,
  c.customer_display_name,
  c.tier,
  c.tenure_years,
  c.home_metro,
  c.customer_lat,
  c.customer_lng,
  c.profile_summary,
  h.account_id,
  h.product_id,
  p.product_name,
  p.product_type,
  p.segment,
  h.balance_usd,
  h.maturity_date,
  h.rate_apy,
  h.status,
  CASE
    WHEN h.maturity_date IS NOT NULL
    THEN DATEDIFF(h.maturity_date, CURRENT_DATE())
    ELSE NULL
  END AS days_to_maturity
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/holdings') h
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/customers') c
  ON h.customer_id = c.customer_id
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/products') p
  ON h.product_id = p.product_id;

-- COMMAND ----------

-- DBTITLE 1,Silver: silver_risk — risk snapshots with churn signal
-- Current + recent risk position, denormalized with customer dims and churn signal.
CREATE OR REFRESH MATERIALIZED VIEW silver_risk AS
SELECT
  c.customer_id,
  c.customer_display_name,
  c.tier,
  c.tenure_years,
  c.home_metro,
  c.customer_lat,
  c.customer_lng,
  c.profile_summary,
  r.snapshot_date,
  r.attrition_risk_score,
  r.balance_outflow_30d_usd,
  r.servicing_note_text,
  COALESCE(n.churn_signal_score, 0.1) AS churn_signal_score
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/risk_snapshots') r
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/customers') c
  ON r.customer_id = c.customer_id
LEFT JOIN LIVE.note_churn_flags n
  ON r.servicing_note_text = n.servicing_note_text;

-- COMMAND ----------

-- DBTITLE 1,Silver: silver_campaigns — retention action history
-- Retention-action history denormalized with customer + product dimensions.
-- Powers the NBA model training table.
CREATE OR REFRESH MATERIALIZED VIEW silver_campaigns AS
SELECT
  rc.campaign_id,
  rc.customer_id,
  c.tier,
  c.tenure_years,
  rc.product_id,
  p.product_name,
  p.product_type,
  p.segment,
  rc.action_type,
  rc.offered_product_id,
  rc.balance_at_risk_usd,
  rc.attrition_risk_at_action,
  rc.initiated_date,
  rc.days_to_resolve,
  rc.retained,
  rc.retained_revenue_usd,
  rc.margin_impact_usd,
  rc.cost_usd
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/retention_campaigns') rc
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/customers') c
  ON rc.customer_id = c.customer_id
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/products') p
  ON rc.product_id = p.product_id;

-- COMMAND ----------

-- DBTITLE 1,Gold: gold_customer_position — customer-360 current state
-- The heart of the demo: one row per customer reflecting the CURRENT position
-- with total balances, top affected holding, risk, and a band flag.
-- All downstream consumers (dashboard, metric view, Genie, app) read this.
CREATE OR REFRESH MATERIALIZED VIEW gold_customer_position AS
WITH current_risk AS (
  SELECT
    customer_id,
    customer_display_name,
    tier,
    tenure_years,
    home_metro,
    customer_lat,
    customer_lng,
    profile_summary,
    attrition_risk_score,
    balance_outflow_30d_usd,
    churn_signal_score
  FROM LIVE.silver_risk
  WHERE snapshot_date = (
    SELECT MAX(snapshot_date) FROM LIVE.silver_risk
  )
),
holdings_agg AS (
  SELECT
    customer_id,
    SUM(CASE WHEN status = 'active' THEN balance_usd ELSE 0 END) AS total_balance_usd,
    SUM(CASE WHEN status = 'active' AND segment = 'deposit' THEN balance_usd ELSE 0 END) AS deposit_balance_usd,
    SUM(CASE WHEN status = 'active' AND product_id IN ('PROD-DEP-2001','PROD-DEP-2002','PROD-DEP-2003') THEN balance_usd ELSE 0 END) AS affected_deposit_balance_usd,
    MIN(CASE WHEN product_id IN ('PROD-DEP-2001','PROD-DEP-2002','PROD-DEP-2003') AND days_to_maturity > 0 THEN days_to_maturity END) AS min_days_to_maturity,
    COUNT(DISTINCT account_id) AS product_count
  FROM LIVE.silver_holdings
  WHERE status = 'active'
  GROUP BY customer_id
)
SELECT
  r.customer_id,
  r.customer_display_name,
  r.tier,
  r.tenure_years,
  r.home_metro,
  r.customer_lat,
  r.customer_lng,
  r.profile_summary,
  COALESCE(h.total_balance_usd, 0) AS total_balance_usd,
  COALESCE(h.deposit_balance_usd, 0) AS deposit_balance_usd,
  COALESCE(h.affected_deposit_balance_usd, 0) AS affected_deposit_balance_usd,
  h.min_days_to_maturity,
  r.attrition_risk_score,
  r.balance_outflow_30d_usd,
  r.churn_signal_score,
  COALESCE(h.product_count, 0) AS product_count,
  -- balance_at_risk: affected deposit balance when risk >= 0.6
  CASE
    WHEN r.attrition_risk_score >= 0.6 THEN COALESCE(h.affected_deposit_balance_usd, 0)
    ELSE 0
  END AS balance_at_risk_usd,
  -- revenue_at_risk: balance * NIM + per-relationship fee value
  CASE
    WHEN r.attrition_risk_score >= 0.6
    THEN COALESCE(h.affected_deposit_balance_usd, 0) * 0.025
         + GREATEST(0, r.tenure_years * 40)
    ELSE 0
  END AS revenue_at_risk_usd,
  -- risk_band: the single column the UI colors by
  CASE
    WHEN r.attrition_risk_score >= 0.75
      AND COALESCE(h.affected_deposit_balance_usd, 0) > 0
      THEN 'critical'
    WHEN r.attrition_risk_score >= 0.6 THEN 'elevated'
    WHEN r.attrition_risk_score >= 0.4 THEN 'watch'
    ELSE 'healthy'
  END AS risk_band
FROM current_risk r
LEFT JOIN holdings_agg h ON r.customer_id = h.customer_id;

-- COMMAND ----------

-- DBTITLE 1,Gold: gold_open_atrisk — at-risk customers with action context
-- Current at-risk customers the app + model act on.
-- Enriched with their maturing affected deposit + candidate cross-sell product.
CREATE OR REFRESH MATERIALIZED VIEW gold_open_atrisk AS
WITH atrisk_customers AS (
  SELECT *
  FROM LIVE.gold_customer_position
  WHERE risk_band IN ('critical', 'elevated', 'watch')
),
-- Find the highest-balance affected holding per customer
ranked_holdings AS (
  SELECT
    customer_id,
    product_id AS atrisk_product_id,
    balance_usd AS atrisk_balance_usd,
    days_to_maturity,
    rate_apy AS current_rate_apy,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY balance_usd DESC
    ) AS rn
  FROM LIVE.silver_holdings
  WHERE product_id IN ('PROD-DEP-2001', 'PROD-DEP-2002', 'PROD-DEP-2003')
    AND status = 'active'
),
-- Determine cross-sell candidate: product they qualify for but don't hold
customer_segments_held AS (
  SELECT customer_id, COLLECT_SET(segment) AS segments_held
  FROM LIVE.silver_holdings
  WHERE status = 'active'
  GROUP BY customer_id
)
SELECT
  a.customer_id,
  a.customer_display_name,
  a.tier,
  a.tenure_years,
  a.home_metro,
  a.customer_lat,
  a.customer_lng,
  a.attrition_risk_score,
  a.balance_at_risk_usd,
  a.revenue_at_risk_usd,
  rh.atrisk_product_id,
  rh.atrisk_balance_usd,
  rh.days_to_maturity,
  rh.current_rate_apy,
  -- Cross-sell candidate: first segment they lack
  CASE
    WHEN NOT array_contains(cs.segments_held, 'investment') THEN 'PROD-INV-3001'
    WHEN NOT array_contains(cs.segments_held, 'lending') THEN 'PROD-CRD-4001'
    ELSE 'PROD-LN-5001'
  END AS candidate_cross_sell_product_id
FROM atrisk_customers a
LEFT JOIN ranked_holdings rh
  ON a.customer_id = rh.customer_id AND rh.rn = 1
LEFT JOIN customer_segments_held cs
  ON a.customer_id = cs.customer_id;

-- COMMAND ----------

-- DBTITLE 1,Gold: gold_campaign_outcomes — NBA training data
-- Retention-action history with situational features + outcome.
-- Used by the heuristic to derive coefficients AND as training data for the optional ML model.
CREATE OR REFRESH MATERIALIZED VIEW gold_campaign_outcomes AS
SELECT
  campaign_id,
  customer_id,
  tier,
  tenure_years,
  product_id,
  product_name,
  product_type,
  segment,
  action_type,
  offered_product_id,
  balance_at_risk_usd,
  attrition_risk_at_action,
  initiated_date,
  days_to_resolve,
  retained,
  retained_revenue_usd,
  margin_impact_usd,
  cost_usd,
  -- Net value: the label the model optimizes
  retained_revenue_usd - cost_usd - margin_impact_usd AS net_value_usd
FROM LIVE.silver_campaigns;

-- COMMAND ----------

-- DBTITLE 1,Gold: gold_nba_recommendations — heuristic next-best-action
-- Ranked next-best-action per open at-risk customer.
-- Built with a hardcoded heuristic (no ML needed; ML is an optional swap).
-- For each at-risk customer, constructs 3 candidate actions and ranks by net value.
CREATE OR REFRESH MATERIALIZED VIEW gold_nba_recommendations AS
WITH atrisk AS (
  SELECT
    customer_id,
    attrition_risk_score,
    balance_at_risk_usd,
    atrisk_product_id,
    atrisk_balance_usd,
    days_to_maturity,
    current_rate_apy,
    candidate_cross_sell_product_id,
    -- eff_bal: use account balance so watch-band customers (balance_at_risk=0) still rank
    GREATEST(COALESCE(atrisk_balance_usd, 0), balance_at_risk_usd) AS eff_bal
  FROM LIVE.gold_open_atrisk
),
scored AS (
  SELECT
    customer_id,
    attrition_risk_score,
    atrisk_product_id,
    current_rate_apy,
    candidate_cross_sell_product_id,
    eff_bal,

    -- RETENTION OFFER: rate-match on the maturing deposit
    LEAST(0.9, 0.45 + attrition_risk_score * 0.4) AS p_retain_retention,
    eff_bal * 0.025 * 3 * LEAST(0.9, 0.45 + attrition_risk_score * 0.4) AS retained_rev_retention,
    eff_bal * GREATEST(0.001, 0.0385 - COALESCE(current_rate_apy, 0.03)) AS cost_retention,

    -- CROSS SELL: offer a product they don't hold
    GREATEST(0.1, 0.6 - attrition_risk_score * 0.5) AS p_retain_cross_sell,
    eff_bal * 0.025 * 3 * GREATEST(0.1, 0.6 - attrition_risk_score * 0.5) + 1200 AS retained_rev_cross_sell,
    50.0 AS cost_cross_sell,

    -- RM OUTREACH: a call, no offer
    GREATEST(0.05, 0.4 - attrition_risk_score * 0.35) AS p_retain_outreach,
    eff_bal * 0.025 * 3 * GREATEST(0.05, 0.4 - attrition_risk_score * 0.35) AS retained_rev_outreach,
    40.0 AS cost_outreach
  FROM atrisk
),
net_values AS (
  SELECT
    customer_id,
    attrition_risk_score,
    atrisk_product_id,
    current_rate_apy,
    candidate_cross_sell_product_id,
    eff_bal,

    retained_rev_retention - cost_retention AS net_retention,
    retained_rev_cross_sell - cost_cross_sell AS net_cross_sell,
    retained_rev_outreach - cost_outreach AS net_outreach,

    retained_rev_retention,
    retained_rev_cross_sell,
    retained_rev_outreach,
    cost_retention,
    cost_cross_sell,
    cost_outreach
  FROM scored
)
SELECT
  customer_id,
  -- recommended_action = argmax net_value
  CASE
    WHEN net_retention >= net_cross_sell AND net_retention >= net_outreach THEN 'retention_offer'
    WHEN net_cross_sell >= net_retention AND net_cross_sell >= net_outreach THEN 'cross_sell'
    ELSE 'rm_outreach'
  END AS recommended_action,
  -- recommended product
  CASE
    WHEN net_retention >= net_cross_sell AND net_retention >= net_outreach THEN atrisk_product_id
    WHEN net_cross_sell >= net_retention AND net_cross_sell >= net_outreach THEN candidate_cross_sell_product_id
    ELSE NULL
  END AS recommended_offer_product_id,
  -- recommended rate (only for retention)
  CASE
    WHEN net_retention >= net_cross_sell AND net_retention >= net_outreach THEN 0.0385
    ELSE NULL
  END AS recommended_rate_apy,
  -- predicted values
  CASE
    WHEN net_retention >= net_cross_sell AND net_retention >= net_outreach THEN retained_rev_retention
    WHEN net_cross_sell >= net_retention AND net_cross_sell >= net_outreach THEN retained_rev_cross_sell
    ELSE retained_rev_outreach
  END AS predicted_retained_usd,
  CASE
    WHEN net_retention >= net_cross_sell AND net_retention >= net_outreach THEN net_retention
    WHEN net_cross_sell >= net_retention AND net_cross_sell >= net_outreach THEN net_cross_sell
    ELSE net_outreach
  END AS predicted_net_value_usd,
  -- Full ranking as JSON for the app's tradeoff view
  TO_JSON(NAMED_STRUCT(
    'retention_offer', NAMED_STRUCT('net_value', ROUND(net_retention, 2), 'predicted_retained', ROUND(retained_rev_retention, 2), 'cost', ROUND(cost_retention, 2)),
    'cross_sell', NAMED_STRUCT('net_value', ROUND(net_cross_sell, 2), 'predicted_retained', ROUND(retained_rev_cross_sell, 2), 'cost', ROUND(cost_cross_sell, 2)),
    'rm_outreach', NAMED_STRUCT('net_value', ROUND(net_outreach, 2), 'predicted_retained', ROUND(retained_rev_outreach, 2), 'cost', ROUND(cost_outreach, 2))
  )) AS action_ranking
FROM net_values;
