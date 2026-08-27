-- ============ SILVER ============
-- Raw parquet lives in the raw_data Volume; read in place with read_files (batch).
--
-- ⚠️ read_files() paths CANNOT interpolate bundle/Spark vars, so the Volume path is
--    hardcoded. Pointed at vijay_catalog / banker_retention_cross_sell (the --var values
--    for this deployment). The dev target disables name prefixing (presets.name_prefix: "")
--    so the schema deploys under this exact name. If you deploy to a different catalog/schema,
--    update the four /Volumes/... paths below to match. See dab_instructions.md.

CREATE OR REFRESH MATERIALIZED VIEW silver_customers
  (CONSTRAINT valid_id EXPECT (customer_id IS NOT NULL) ON VIOLATION DROP ROW)
AS SELECT
  customer_id, first_name, last_name, email, ssn_masked, segment,
  home_branch, branch_region, CAST(registration_date AS DATE) AS registration_date,
  tenure_months, relationship_value_usd, rm_name
FROM read_files('/Volumes/vijay_catalog/banker_retention_cross_sell/raw_data/customers', format => 'parquet');

CREATE OR REFRESH MATERIALIZED VIEW silver_accounts AS
SELECT a.account_id, a.customer_id, a.account_type, a.balance_usd,
       CAST(a.open_date AS DATE) AS open_date, a.status,
       c.segment, c.home_branch, c.branch_region
FROM read_files('/Volumes/vijay_catalog/banker_retention_cross_sell/raw_data/accounts', format => 'parquet') a
JOIN silver_customers c USING (customer_id);

CREATE OR REFRESH MATERIALIZED VIEW silver_transactions
  CLUSTER BY (txn_date)
AS SELECT t.transaction_id, t.customer_id, t.account_id,
       CAST(t.txn_date AS TIMESTAMP) AS txn_date,
       t.amount_usd, t.txn_type, t.channel,
       c.segment, c.home_branch
FROM read_files('/Volumes/vijay_catalog/banker_retention_cross_sell/raw_data/transactions', format => 'parquet') t
JOIN silver_customers c USING (customer_id);

-- Customer-grain weekly deposit balance (sum of positive deposit-account balances).
CREATE OR REFRESH MATERIALIZED VIEW _cust_weekly_balance AS
SELECT b.customer_id, CAST(b.week_start AS DATE) AS week_start,
       SUM(CASE WHEN a.account_type IN ('Checking','Savings','High-Yield Savings')
                THEN b.balance_usd ELSE 0 END) AS deposit_balance_usd
FROM read_files('/Volumes/vijay_catalog/banker_retention_cross_sell/raw_data/balance_weekly', format => 'parquet') b
JOIN silver_accounts a USING (account_id)
GROUP BY b.customer_id, CAST(b.week_start AS DATE);

-- Per-customer per-week: trailing-6w peak, runoff_pct, payroll_active, at-risk flag.
CREATE OR REFRESH MATERIALIZED VIEW silver_balance_weekly AS
WITH bal AS (
  SELECT customer_id, week_start, deposit_balance_usd,
         MAX(deposit_balance_usd) OVER (
           PARTITION BY customer_id ORDER BY week_start
           ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS peak_balance_6w
  FROM _cust_weekly_balance
),
payroll AS (
  SELECT DISTINCT customer_id, week_start
  FROM bal b2
  WHERE EXISTS (
    SELECT 1 FROM silver_transactions t
    WHERE t.customer_id = b2.customer_id
      AND t.txn_type IN ('payroll','direct_deposit')
      AND t.txn_date >= CAST(b2.week_start AS TIMESTAMP) - INTERVAL 30 DAYS
      AND t.txn_date <  CAST(b2.week_start AS TIMESTAMP) + INTERVAL 7 DAYS
  )
)
SELECT b.customer_id, b.week_start, b.deposit_balance_usd AS balance_usd,
       b.peak_balance_6w,
       (b.peak_balance_6w - b.deposit_balance_usd) / NULLIF(b.peak_balance_6w, 0) AS runoff_pct,
       (p.customer_id IS NOT NULL) AS payroll_active,
       ((b.peak_balance_6w - b.deposit_balance_usd) / NULLIF(b.peak_balance_6w, 0) >= 0.5
         AND p.customer_id IS NULL) AS weekly_at_risk_flag
FROM bal b
LEFT JOIN payroll p ON b.customer_id = p.customer_id AND b.week_start = p.week_start;
