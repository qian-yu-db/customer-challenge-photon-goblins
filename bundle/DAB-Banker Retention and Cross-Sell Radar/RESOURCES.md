# Deployed Resources — Meridian Bank Retention & Cross-Sell Radar

**Workspace:** `fevm-vijay` (https://fevm-vijay.cloud.databricks.com, `o=7474659668600833`)
**Catalog / schema:** `vijay_catalog.banker_retention_cross_sell`
**Deployed:** 2026-08-27 (target `dev`)

## Is there a Genie Agent?

Yes — but it is **not** a separately-hosted agent or model-serving endpoint. The agent
lives *inside the Databricks App*: `app/server/agent/retentionops.ts` runs an in-process
LLM agent (via `@openai/agents`) that calls a foundation model through the **AI Gateway**,
and its single data tool is **`ask_genie`** (`app/server/agent/tools/genie.ts`), which drives
the Genie space through the `/api/2.0/genie/spaces/{id}` conversation API.

Topology: **App → agent loop → `ask_genie` tool → Genie space**.

There is **no** Knowledge Assistant, **no** Multi-Agent Supervisor, and **no** registered/served
ML model (the `KA_ENDPOINT_NAME` / `MAS_ENDPOINT_NAME` env vars are empty). The only AI resource
object in the workspace is the Genie space; the agent itself ships as app code.

## Key resources

### Application & AI

1. **[Databricks App — dbgen-meridian-radar](https://dbgen-meridian-radar-7474659668600833.aws.databricksapps.com)** ([manage](https://fevm-vijay.cloud.databricks.com/apps/dbgen-meridian-radar?o=7474659668600833))
   The RM-facing web app: customer 360, next-best-action, and draft retention/cross-sell offers with write-back; hosts the Genie-backed agent.
2. **[Genie space — Meridian Retention & Cross-Sell](https://fevm-vijay.cloud.databricks.com/genie/rooms/01f1a25bc3481bd78367ba5c93c7a886?o=7474659668600833)**
   The natural-language analytics space (over the gold tables + metric view) that the app's `ask_genie` tool queries.

### Analytics

3. **[AI/BI Dashboard](https://fevm-vijay.cloud.databricks.com/dashboardsv3/01f1a254cd2f1144b6d2e1f105431e2d/published?o=7474659668600833)**
   The book-of-business dashboard: at-risk balances, attrition trends, and cross-sell opportunity by segment/branch.
4. **[Metric view — mv_book_health](https://fevm-vijay.cloud.databricks.com/explore/data/vijay_catalog/banker_retention_cross_sell/mv_book_health?o=7474659668600833)**
   Governed metric layer (MEASUREs like `at_risk_balance`, `attrition_risk_rate`, `cross_sell_opportunity`) used by both Genie and the dashboard.

### Data pipeline & orchestration

5. **[Lakeflow pipeline — Meridian Retention Radar Pipeline](https://fevm-vijay.cloud.databricks.com/pipelines/bca0a467-3418-4a95-894b-93496673db82?o=7474659668600833)**
   Serverless + Photon SDP pipeline that builds silver → gold from the raw parquet.
6. **[Setup job — Meridian Retention Radar Setup](https://fevm-vijay.cloud.databricks.com/jobs/947855350108729?o=7474659668600833)**
   The one-shot orchestrator: generate data → run pipeline → deploy metric view + Genie → grant app SP → export IDs.

### Unity Catalog data

7. **[Schema — vijay_catalog.banker_retention_cross_sell](https://fevm-vijay.cloud.databricks.com/explore/data/vijay_catalog/banker_retention_cross_sell?o=7474659668600833)**
   The demo's home schema holding all tables, views, and the volume.
8. **[Volume — raw_data](https://fevm-vijay.cloud.databricks.com/explore/data/volumes/vijay_catalog/banker_retention_cross_sell/raw_data?o=7474659668600833)**
   Raw parquet landing zone (customers, accounts, transactions, balance_weekly).
9. **[gold_customer_360](https://fevm-vijay.cloud.databricks.com/explore/data/vijay_catalog/banker_retention_cross_sell/gold_customer_360?o=7474659668600833)**
   Per-customer risk scores, runoff %, payroll signals, and next-best-action — the app's core read model.
10. **[gold_rm_radar](https://fevm-vijay.cloud.databricks.com/explore/data/vijay_catalog/banker_retention_cross_sell/gold_rm_radar?o=7474659668600833)** & **[gold_weekly_book_summary](https://fevm-vijay.cloud.databricks.com/explore/data/vijay_catalog/banker_retention_cross_sell/gold_weekly_book_summary?o=7474659668600833)**
    RM-level radar and weekly book rollups. *(Plus 4 `silver_*` views and 4 `_`-prefixed intermediate materialized views.)*

### Storage & observability

*(No direct deep-link — identifiers given.)*

11. **Lakebase (Postgres) database — `dbgen_meridian_radar`**
    Project `dbdemos-asset-generator`, branch `production`, host `ep-fragrant-haze-d2l4556c.database.us-east-1.cloud.databricks.com`; the app's transactional store for offers / write-back. Find it under **[Compute → Database instances](https://fevm-vijay.cloud.databricks.com/compute?o=7474659668600833)**.
12. **MLflow experiment — `/Shared/solution_builder/dbgen-meridian-radar-agent-traces`**
    Auto-created at app boot to capture the agent's traces; browse under **[Experiments](https://fevm-vijay.cloud.databricks.com/ml/experiments?o=7474659668600833)**.

## Resolved IDs (from the setup job's `export_resources`)

| Resource | ID |
|---|---|
| Catalog | `vijay_catalog` |
| Schema | `banker_retention_cross_sell` |
| App | `dbgen-meridian-radar` |
| Genie space | `01f1a25bc3481bd78367ba5c93c7a886` |
| Dashboard | `01f1a254cd2f1144b6d2e1f105431e2d` |
| Pipeline | `bca0a467-3418-4a95-894b-93496673db82` |
| Setup job | `947855350108729` |
| SQL warehouse | `79fae613dbebe6d9` |
| Agent MLflow experiment path | `/Shared/solution_builder/dbgen-meridian-radar-agent-traces` |
