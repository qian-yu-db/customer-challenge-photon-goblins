# Analytics & Dashboard Pages

## Analytics page (`/analytics`)

In-app warehouse-backed charts via `@databricks/appkit-ui/react` (`LineChart`, `BarChart`, `DataTable`). Header shows the warehouse name + state. Queries live in `config/queries/*.sql`, pointed at `solution_builder.demo_banker_retention_cross_sell_radar`.

**Why alongside the AI/BI dashboard:** the in-app surface for the RM already in the Radar who wants a quick pattern check without switching tools.

### Layout
- **Top row:** Weekly at-risk relationship value (line, full width) — `SUM(at_risk_balance_usd)` by `week_start` from `gold_weekly_book_summary`, 26 weeks. Flat baseline → ramp → peak ~3 weeks ago. The drift that started everything.
- **Second row:** At-risk customers by branch (bar, left) — top branches by `SUM(at_risk_customers)`, Harbor/Bayview/Highland lead. | Cross-sell opportunity by product (table, right) — `nba_product`, ready-customer count, total opportunity $, sorted by $ desc.
- **Third row:** Segment drill-down (full width) — dropdown picks segment (Affluent / Mass Market / Small Business) → branches ranked by at-risk value as horizontal bars. Click branch → Radar pre-filtered by that branch.

### Queries
- `weekly_at_risk_trend` — `SELECT week_start, SUM(at_risk_balance_usd) AS at_risk_usd FROM gold_weekly_book_summary GROUP BY 1 ORDER BY 1`.
- `at_risk_by_branch` — `SELECT home_branch, SUM(at_risk_customers) AS at_risk_customers, SUM(at_risk_balance_usd) AS at_risk_usd FROM gold_weekly_book_summary GROUP BY 1 ORDER BY at_risk_customers DESC`.
- `cross_sell_by_product` — `SELECT nba_product, COUNT(*) AS ready_customers, SUM(cross_sell_opportunity_usd) AS opportunity_usd FROM gold_customer_360 WHERE cross_sell_eligible GROUP BY 1 ORDER BY opportunity_usd DESC`.

> No per-branch/per-product gold tables beyond the summary — rollups at widget query time via GROUP BY (small + fast). Update `AnalyticsView.tsx` `queryKey` list to match these files; delete the template's LuxeBeauty queries.

## Dashboard page (`/dashboard`)

Embed the AI/BI dashboard from `04-ai-bi.md` (Section B) as a full-page SSO iframe. Look up `dashboard_id` in `resources.json`, wire into `config.dashboardId`. Do not rebuild it. Filters + drill-downs work natively.

**Why alongside the in-app Analytics page:** proves a published AI/BI dashboard lives inside a custom app — same SSO, same data, no chart rebuild.
