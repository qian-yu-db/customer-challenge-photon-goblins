# Databricks notebook source
"""
Deploy the mv_book_health metric view — DAB setup-job task.

Metric views have no PySpark API, so this runs the
`CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML` DDL inline via spark.sql,
with catalog/schema resolved from job widgets (so it binds to the deployed target).

Measures (referenced by name in the dashboard datasets + Genie example SQLs — renaming
any is a breaking change downstream): at_risk_balance, at_risk_customers,
total_relationship_value, cross_sell_opportunity, book_customers, attrition_risk_rate.
"""
dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
assert catalog and schema, "catalog + schema are required"

fqn = f"{catalog}.{schema}.mv_book_health"
source = f"{catalog}.{schema}.gold_weekly_book_summary"

ddl = f"""
CREATE OR REPLACE VIEW {fqn}
WITH METRICS
LANGUAGE YAML
AS $$
version: 1.1
source: {source}
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
$$
"""

print(f"Creating metric view: {fqn}")
spark.sql(ddl)
print("Metric view ready.")
