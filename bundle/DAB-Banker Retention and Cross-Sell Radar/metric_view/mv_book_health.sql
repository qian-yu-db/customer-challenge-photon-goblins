CREATE OR REPLACE VIEW solution_builder.demo_banker_retention_cross_sell_radar.mv_book_health
WITH METRICS
LANGUAGE YAML
AS $$
version: 1.1
source: solution_builder.demo_banker_retention_cross_sell_radar.gold_weekly_book_summary
comment: "Meridian Bank book health — at-risk relationship value, attrition risk rate, and cross-sell opportunity by week, segment, and branch."
dimensions:
  - name: week_start
    expr: week_start
    comment: "Week (Monday-aligned)"
  - name: segment
    expr: segment
    comment: "Customer segment: Mass Market / Affluent / Small Business"
  - name: home_branch
    expr: home_branch
    comment: "Home branch"
measures:
  - name: at_risk_balance
    expr: SUM(at_risk_balance_usd)
    comment: "Relationship value tied up in at-risk (drifting) customers"
  - name: at_risk_customers
    expr: SUM(at_risk_customers)
    comment: "Count of at-risk customers"
  - name: total_relationship_value
    expr: SUM(total_relationship_value_usd)
    comment: "Total annual relationship value of the book"
  - name: cross_sell_opportunity
    expr: SUM(cross_sell_opportunity_usd)
    comment: "Annual revenue of unoffered next-best-action products"
  - name: book_customers
    expr: SUM(book_customers)
    comment: "Distinct customers in the book that week"
  - name: attrition_risk_rate
    expr: SUM(at_risk_customers) / NULLIF(SUM(book_customers), 0)
    comment: "Share of the book flagged at-risk"
$$;
