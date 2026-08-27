# Databricks notebook source
"""
Deploy the Meridian Retention & Cross-Sell Radar Genie Space — DAB setup-job task.

Loads src/genie/genie_space.json (curated questions + curated SQLs + story
instructions), substitutes the authored catalog.schema with the deployed one,
then creates or updates the space via the SDK. Idempotent: searches by title.

REQUIRES: databricks-sdk>=0.114.0 (environment_key: sdk_latest).

Parameters (base_parameters): catalog, schema, warehouse_id
Outputs (taskValues): genie_space_id (consumed by export_resources)
"""

# COMMAND ----------

SPACE_TITLE = "Meridian Retention & Cross-Sell Radar"
SPACE_DESCRIPTION = (
    "Meridian Bank's live customer 360 for relationship managers: which accounts are "
    "drifting (payroll stopped, balances draining ~3 weeks ago, concentrated in the Affluent "
    "segment and Harbor/Bayview/Highland branches) and who's ready for a next-best-action offer "
    "(~$3-4M/yr). Start with the suggested questions in order."
)

# The catalog.schema baked into the committed genie_space.json — literal-replaced
# with the deployed catalog.schema below.
SRC_QUALIFIER = "solution_builder.demo_banker_retention_cross_sell_radar"

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema",  "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")

catalog      = dbutils.widgets.get("catalog")
schema       = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")
assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

print(f"Deploying Genie Space: '{SPACE_TITLE}'  →  {catalog}.{schema}  (warehouse {warehouse_id})")

# COMMAND ----------

import json, os
from databricks.sdk import WorkspaceClient

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root   = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
config_path   = f"/Workspace{bundle_root}/src/genie/genie_space.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    serialized = f.read()

DST_QUALIFIER = f"{catalog}.{schema}"
n = serialized.count(SRC_QUALIFIER)
substituted = serialized.replace(SRC_QUALIFIER, DST_QUALIFIER)
print(f"Substituted {n} occurrences of {SRC_QUALIFIER} → {DST_QUALIFIER}")

space_payload = json.loads(substituted)  # validate it still parses
print(f"data_sources.tables: {len(space_payload['data_sources']['tables'])}")
print(f"sample_questions:    {len(space_payload['config']['sample_questions'])}")

# COMMAND ----------

w = WorkspaceClient()

existing_id = None
page_token = None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in (resp.spaces or []):
        if sp.title == SPACE_TITLE:
            existing_id = sp.space_id
            print(f"Found existing space: {existing_id}")
            break
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating space {existing_id}…")
    w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id, serialized_space=substituted)
    space_id = existing_id
else:
    print("Creating new space…")
    created = w.genie.create_space(
        warehouse_id=warehouse_id, title=SPACE_TITLE,
        description=SPACE_DESCRIPTION, serialized_space=substituted)
    space_id = created.space_id

print(f"Genie space ready: {space_id}")

# COMMAND ----------

dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
print(f"task value set: genie_space_id = {space_id}")
