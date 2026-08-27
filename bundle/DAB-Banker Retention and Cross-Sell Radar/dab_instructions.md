# Deploy — Meridian Bank Retention & Cross-Sell Radar

Prerequisites: Databricks CLI **v0.283.0+** (dashboard `dataset_catalog`/`dataset_schema`
rebinding). The setup job's Genie task uses `databricks-sdk>=0.114.0` (wired via the
`sdk_latest` environment — nothing to install locally).

The demo ships an App + Lakebase, so the full deploy is 5 commands. The Genie space id
only exists after the setup job runs, so the app env is finalized last (step 5).

```bash
# 1. Lakebase DB (pre-deploy — the CLI can't declare a Postgres database)
./app/scripts/lakebase_setup_db.sh --db-name dbgen_meridian_radar

# 2. Create the resource shells (schema, raw_data volume, pipeline, dashboard, app) + setup job
databricks bundle deploy \
  --var catalog=solution_builder \
  --var schema=demo_banker_retention_cross_sell_radar \
  --var warehouse_id=<your_warehouse_id>

# 3. Run the setup job: data → pipeline → metric view → Genie → grant app SP → export IDs
databricks bundle run meridian_radar_setup \
  --var catalog=solution_builder \
  --var schema=demo_banker_retention_cross_sell_radar \
  --var warehouse_id=<your_warehouse_id>

# 4. Grant the app SP on the Lakebase (Postgres) schemas
./app/scripts/lakebase_grant_app_credential.sh \
  --app-name dbgen-meridian-radar \
  --project-id dbdemos-asset-generator \
  --db-name dbgen_meridian_radar

# 5. Harvest the resolved IDs (dashboard, pipeline, Genie space) → write app.yaml env → deploy the app
./app/scripts/finalize_app.sh
```

After an **app content** change: re-run steps 2 + 5.
After a **data / resource** change: re-run steps 2 + 3 + 5. Re-runs are idempotent.

## Non-default catalog/schema

The SDP `silver.sql` reads raw parquet via `read_files('/Volumes/solution_builder/demo_banker_retention_cross_sell_radar/raw_data/...')` —
these paths **cannot** interpolate bundle variables. If you deploy to a different catalog/schema
(or use the `dev` target, which prefixes the schema with `dev_<user>_`), edit the four
`/Volumes/...` paths in `src/pipeline/silver.sql` to match before step 3, or deploy with the
default `solution_builder.demo_banker_retention_cross_sell_radar`.

## Teardown

```bash
databricks bundle destroy --auto-approve
```

Does not drop the Lakebase project/DB, the UC tables/volume, or the Genie space.
