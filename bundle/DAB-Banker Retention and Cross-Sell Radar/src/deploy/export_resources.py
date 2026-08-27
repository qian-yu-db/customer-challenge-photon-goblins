# Databricks notebook source
"""
Export the resolved Meridian demo resource IDs as the job's exit value — FINAL setup-job task.

Collects the bundle-resolved IDs (base_parameters) plus the SDK-created Genie space id
(task value) and emits them as one JSON via dbutils.notebook.exit(). finalize_app.sh reads
this back through `databricks jobs get-run-output` → notebook_output.result, then writes the
app's env + redeploys.

This demo has NO Knowledge Assistant / Multi-Agent Supervisor / ML model, so those IDs are
absent — the app is Genie-backed single-agent.

Parameters: catalog, schema, app_name, dashboard_id, pipeline_id, warehouse_id, genie_space_id
"""

# COMMAND ----------

import json

names = [
    "catalog", "schema", "app_name",
    "dashboard_id", "pipeline_id", "warehouse_id", "genie_space_id",
]
for n in names:
    dbutils.widgets.text(n, "", n)

vals = {n: dbutils.widgets.get(n) for n in names}

# Guard: if task-value substitution didn't fire, the value is the literal template string.
v = vals["genie_space_id"]
if v.startswith("{{") and v.endswith("}}"):
    raise RuntimeError(f"genie_space_id={v!r} — task value substitution didn't fire.")

resources = {
    "catalog":                      vals["catalog"],
    "schema":                       vals["schema"],
    "app_name":                     vals["app_name"],
    "dashboard_id":                 vals["dashboard_id"],
    "pipeline_id":                  vals["pipeline_id"],
    "warehouse_id":                 vals["warehouse_id"],
    "genie_space_id":               vals["genie_space_id"],
    "agent_mlflow_experiment_path": f"/Shared/solution_builder/{vals['app_name']}-agent-traces",
}

print("Exporting resources:")
for k, val in resources.items():
    print(f"  {k} = {val}")

# COMMAND ----------

dbutils.notebook.exit(json.dumps(resources))
