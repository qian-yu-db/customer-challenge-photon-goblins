-- Weekly at-risk relationship value — flat baseline → ramp → peak ~3 weeks ago.
-- The drift that started everything. Reads gold_weekly_book_summary.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_banker_retention_cross_sell_radar
SELECT
  week_start,
  CAST(ROUND(SUM(at_risk_balance_usd), 2) AS DOUBLE) AS at_risk_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_weekly_book_summary')
GROUP BY week_start
ORDER BY week_start
