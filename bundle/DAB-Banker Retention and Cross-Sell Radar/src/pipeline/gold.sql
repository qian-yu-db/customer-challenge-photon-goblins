-- ============ GOLD ============
-- Bare table names resolve to the pipeline's target schema — portable across targets.

-- Per-customer holdings summary (products held, total balance)
CREATE OR REFRESH MATERIALIZED VIEW _holdings AS
SELECT customer_id,
       COUNT(*) AS products_held,
       CONCAT_WS(', ', SORT_ARRAY(COLLECT_SET(account_type))) AS products_list,
       COLLECT_SET(account_type) AS products_set,
       SUM(balance_usd) AS total_balance_usd,
       SUM(CASE WHEN account_type = 'Checking' THEN balance_usd ELSE 0 END) AS checking_balance_usd,
       SUM(CASE WHEN account_type IN ('Checking','Savings','High-Yield Savings') THEN balance_usd ELSE 0 END) AS deposit_balance_usd
FROM silver_accounts
WHERE status = 'open'
GROUP BY customer_id;

-- Latest-week signals per customer
CREATE OR REFRESH MATERIALIZED VIEW _latest_signals AS
WITH ranked AS (
  SELECT customer_id, week_start, runoff_pct, payroll_active,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY week_start DESC) AS rn
  FROM silver_balance_weekly
)
SELECT customer_id, runoff_pct AS balance_runoff_pct, payroll_active AS latest_payroll_active
FROM ranked WHERE rn = 1;

-- Days since last payroll credit
CREATE OR REFRESH MATERIALIZED VIEW _last_payroll AS
SELECT customer_id,
       DATEDIFF(current_date(), MAX(CAST(txn_date AS DATE))) AS days_since_last_payroll
FROM silver_transactions
WHERE txn_type IN ('payroll','direct_deposit')
GROUP BY customer_id;

-- Customer 360 : signals + attrition risk + next-best-action
CREATE OR REFRESH MATERIALIZED VIEW gold_customer_360 AS
WITH base AS (
  SELECT c.customer_id, c.first_name, c.last_name, c.email, c.segment,
         c.home_branch, c.branch_region, c.rm_name, c.tenure_months, c.relationship_value_usd,
         COALESCE(h.products_held, 1) AS products_held,
         COALESCE(h.products_list, 'Checking') AS products_list,
         h.products_set,
         COALESCE(h.total_balance_usd, 0) AS total_balance_usd,
         COALESCE(h.checking_balance_usd, 0) AS checking_balance_usd,
         COALESCE(h.deposit_balance_usd, 0) AS deposit_balance_usd,
         COALESCE(s.balance_runoff_pct, 0) AS balance_runoff_pct,
         COALESCE(lp.days_since_last_payroll, 999) AS days_since_last_payroll,
         (COALESCE(lp.days_since_last_payroll, 999) >= 30) AS payroll_interrupted
  FROM silver_customers c
  LEFT JOIN _holdings h USING (customer_id)
  LEFT JOIN _latest_signals s USING (customer_id)
  LEFT JOIN _last_payroll lp USING (customer_id)
),
scored AS (
  -- The pre-attrition signature = balance draining AND payroll stopped. Runoff is the
  -- dominant signal; payroll interruption only compounds risk once balances are already
  -- draining (a customer who simply never had direct deposit but whose balance is stable
  -- is NOT drifting). This keeps the High band = the ~600 drifting cohort.
  SELECT *,
    LEAST(1.0, GREATEST(0.0,
        0.60 * LEAST(1.0, balance_runoff_pct)
      + 0.30 * (CASE WHEN payroll_interrupted AND balance_runoff_pct >= 0.3 THEN 1 ELSE 0 END)
      + 0.10 * (CASE WHEN products_held <= 2 AND balance_runoff_pct >= 0.3 THEN 1 ELSE 0 END)
    )) AS attrition_risk_score
  FROM base
),
banded AS (
  SELECT *,
    CASE WHEN attrition_risk_score >= 0.6 THEN 'High'
         WHEN attrition_risk_score >= 0.3 THEN 'Medium' ELSE 'Low' END AS risk_band
  FROM scored
),
nba AS (
  SELECT *,
    -- next-best cross-sell product the customer qualifies for but does not hold
    CASE
      WHEN segment = 'Small Business' AND NOT array_contains(products_set, 'Small Business Line')
           AND deposit_balance_usd > 30000 THEN 'Small Business Line'
      WHEN NOT array_contains(products_set, 'High-Yield Savings') AND checking_balance_usd > 30000 THEN 'High-Yield Savings'
      WHEN NOT array_contains(products_set, 'Wealth Management') AND segment = 'Affluent' AND deposit_balance_usd > 60000 THEN 'Wealth Management'
      WHEN NOT array_contains(products_set, 'Credit Card') AND deposit_balance_usd > 15000 THEN 'Credit Card'
      WHEN NOT array_contains(products_set, 'Savings') AND checking_balance_usd > 8000 THEN 'Savings'
      ELSE NULL END AS nba_product
  FROM banded
)
SELECT customer_id, first_name, last_name, email, segment, home_branch, branch_region,
       rm_name, tenure_months, relationship_value_usd, products_held, products_list,
       total_balance_usd, ROUND(balance_runoff_pct, 3) AS balance_runoff_pct,
       days_since_last_payroll, payroll_interrupted,
       ROUND(attrition_risk_score, 3) AS attrition_risk_score, risk_band,
       (risk_band <> 'High' AND nba_product IS NOT NULL) AS cross_sell_eligible,
       CASE WHEN risk_band <> 'High' THEN nba_product ELSE NULL END AS nba_product,
       CASE WHEN risk_band <> 'High' AND nba_product IS NOT NULL THEN
         CASE nba_product
           WHEN 'Checking' THEN 40 WHEN 'Savings' THEN 60 WHEN 'High-Yield Savings' THEN 180
           WHEN 'Credit Card' THEN 220 WHEN 'Auto Loan' THEN 350 WHEN 'Mortgage' THEN 500
           WHEN 'Small Business Line' THEN 900 WHEN 'Wealth Management' THEN 1400 ELSE 0 END
         ELSE 0 END AS cross_sell_opportunity_usd,
       CASE WHEN risk_band = 'High' THEN 'retention'
            WHEN (risk_band <> 'High' AND nba_product IS NOT NULL) THEN 'cross_sell'
            ELSE 'none' END AS nba_type,
       CASE
         WHEN risk_band = 'High' THEN
           CONCAT('Payroll stopped ', CAST(days_since_last_payroll AS STRING),
                  ' days ago; balance down ', CAST(ROUND(balance_runoff_pct*100) AS STRING),
                  '% — offer a retention save package (fee waiver + rate match + RM callback).')
         WHEN nba_product IS NOT NULL THEN
           CONCAT('$', CAST(ROUND(checking_balance_usd) AS STRING),
                  ' in deposits, no ', nba_product, ' — offer ', nba_product, '.')
         ELSE 'No action.' END AS nba_reason
FROM nba;

-- Weekly book summary (dashboard metric-view source)
CREATE OR REFRESH MATERIALIZED VIEW gold_weekly_book_summary AS
WITH wk AS (
  SELECT b.week_start, c.segment, c.home_branch,
         b.customer_id, b.balance_usd, b.weekly_at_risk_flag
  FROM silver_balance_weekly b
  JOIN silver_customers c USING (customer_id)
),
risk AS (
  SELECT week_start, segment, home_branch,
         SUM(CASE WHEN weekly_at_risk_flag THEN balance_usd ELSE 0 END) AS at_risk_balance_usd,
         COUNT(DISTINCT CASE WHEN weekly_at_risk_flag THEN customer_id END) AS at_risk_customers,
         COUNT(DISTINCT customer_id) AS book_customers
  FROM wk GROUP BY week_start, segment, home_branch
),
rv AS (
  SELECT segment, home_branch,
         SUM(relationship_value_usd) AS total_relationship_value_usd,
         SUM(CASE WHEN nba_type = 'cross_sell' THEN cross_sell_opportunity_usd ELSE 0 END) AS cross_sell_opportunity_usd
  FROM gold_customer_360 GROUP BY segment, home_branch
),
maxwk AS (SELECT MAX(week_start) AS mw FROM risk)
-- total_relationship_value + cross_sell_opportunity are customer-level constants; emit them ONLY
-- on the latest week (0 elsewhere) so KPI SUMs over the full window aren't multiplied by 26.
SELECT r.week_start, r.segment, r.home_branch,
       r.at_risk_balance_usd, r.at_risk_customers, r.book_customers,
       CASE WHEN r.week_start = m.mw THEN rv.total_relationship_value_usd ELSE 0 END AS total_relationship_value_usd,
       CASE WHEN r.week_start = m.mw THEN rv.cross_sell_opportunity_usd ELSE 0 END AS cross_sell_opportunity_usd,
       0.0 AS avg_risk_proxy
FROM risk r JOIN rv USING (segment, home_branch) CROSS JOIN maxwk m;

-- RM Radar : actionable queue
CREATE OR REFRESH MATERIALIZED VIEW gold_rm_radar AS
SELECT *,
       CASE WHEN nba_type = 'retention' THEN 1 ELSE 2 END AS priority,
       'pending' AS status
FROM gold_customer_360
WHERE nba_type IN ('retention','cross_sell');
