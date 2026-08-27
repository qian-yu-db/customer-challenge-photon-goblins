-- At-risk customers by branch — Harbor / Bayview / Highland lead.
-- Reads gold_weekly_book_summary.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_banker_retention_cross_sell_radar
SELECT
  home_branch,
  CAST(SUM(at_risk_customers) AS BIGINT) AS at_risk_customers,
  CAST(ROUND(SUM(at_risk_balance_usd), 2) AS DOUBLE) AS at_risk_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_weekly_book_summary')
GROUP BY home_branch
ORDER BY at_risk_customers DESC
