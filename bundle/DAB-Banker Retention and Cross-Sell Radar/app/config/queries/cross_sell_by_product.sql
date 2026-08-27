-- Cross-sell opportunity by product — ready customers + total annual $.
-- Reads gold_customer_360.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_banker_retention_cross_sell_radar
SELECT
  nba_product,
  CAST(COUNT(*) AS BIGINT) AS ready_customers,
  CAST(SUM(cross_sell_opportunity_usd) AS BIGINT) AS opportunity_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_customer_360')
WHERE cross_sell_eligible AND nba_product IS NOT NULL
GROUP BY nba_product
ORDER BY opportunity_usd DESC
