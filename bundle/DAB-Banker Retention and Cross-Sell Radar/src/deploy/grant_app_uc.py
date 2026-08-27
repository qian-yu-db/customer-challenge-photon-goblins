# Databricks notebook source
"""
Grant the Retention Radar app's service principal UC read privileges — DAB setup-job task.

The app reads gold_rm_radar / silver_balance_weekly / silver_transactions via the SQL
warehouse and mirrors them into Lakebase. Without these grants the app's first /api/config
crashes with INSUFFICIENT_PERMISSIONS.

Granted to the app SP (resolved from the app name):
  - USE_CATALOG on the catalog
  - USE_SCHEMA + SELECT on the schema (covers gold_*/silver_*/mv_* reads)
  - READ_VOLUME on the raw_data volume

This demo has no ML model/function, so no EXECUTE grant. Idempotent.

Parameters: catalog, schema, app_name
"""

# COMMAND ----------

DEMO_VOLUMES = ["raw_data"]

# COMMAND ----------

dbutils.widgets.text("catalog",  "", "Catalog")
dbutils.widgets.text("schema",   "", "Schema")
dbutils.widgets.text("app_name", "", "App name")

catalog  = dbutils.widgets.get("catalog")
schema   = dbutils.widgets.get("schema")
app_name = dbutils.widgets.get("app_name")
assert catalog and schema and app_name

# COMMAND ----------

from databricks.sdk import WorkspaceClient
w = WorkspaceClient()

app = w.apps.get(name=app_name)
sp_client_id = app.service_principal_client_id
assert sp_client_id, f"App '{app_name}' has no service_principal_client_id"
print(f"App SP: {sp_client_id}")

# COMMAND ----------

grants = [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp_client_id}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp_client_id}`",
]
grants += [
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.{vol} TO `{sp_client_id}`"
    for vol in DEMO_VOLUMES
]

for stmt in grants:
    print(f"  {stmt}")
    spark.sql(stmt)

print("Grants applied.")
