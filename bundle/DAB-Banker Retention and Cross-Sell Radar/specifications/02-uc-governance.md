# UC Governance — Metric View + PII scoping (talking track)

Tables defined in `01-lakeflow.md`. Skill: `databricks-metric-views`.

## Metric View — `mv_book_health`

Source: `gold_weekly_book_summary`. Single view, aggregated materialization.

**Dimensions**: `week_start`, `segment`, `home_branch`.

**Measures** (referenced verbatim by dashboard datasets + Genie — renaming here is a breaking change downstream):

| Name | Expression |
|------|------------|
| `at_risk_balance` | `SUM(at_risk_balance_usd)` |
| `at_risk_customers` | `SUM(at_risk_customers)` |
| `total_relationship_value` | `SUM(total_relationship_value_usd)` |
| `cross_sell_opportunity` | `SUM(cross_sell_opportunity_usd)` |
| `book_customers` | `SUM(book_customers)` |
| `attrition_risk_rate` | `SUM(at_risk_customers) / NULLIF(SUM(book_customers), 0)` |

Ratio measures use `SUM(...) / NULLIF(SUM(...), 0)` directly (not `MEASURE(x)/MEASURE(y)`) so the ratio is computed at the filtered-slice level and avoids div-by-zero.

**Materialization**: aggregated on `(week_start, segment, home_branch) × all measures`, refresh every 6h.

### Consumers
Dashboard KPI tiles + weekly trend + segment/branch splits read from `mv_book_health` via `MEASURE(...)`. Genie's headline answers (at-risk value, attrition risk rate, cross-sell opportunity) come from the same view so numbers match everywhere.

### Validation
- `MEASURE(at_risk_balance)` weekly slice: low baseline ~6 weeks ago, clear peak ~3 weeks ago, elevated since.
- `MEASURE(attrition_risk_rate)` peaks in the recent weeks vs a low baseline early in the window.
- `MEASURE(cross_sell_opportunity)` steady across weeks, total ≈ $3–4M.
- `DESCRIBE EXTENDED` shows the `(week_start, segment, home_branch)` aggregated materialization.

Add `metric_view_name` to `resources.json`.

## PII scoping & auditable AI (talking track — no extra resource)

The brief's compliance requirements are realized as **Unity Catalog** narrative, not new build artifacts:
- **Column masks / role-scoped PII**: `customers.ssn_masked` is already masked at rest; `email`, `first_name`, `last_name` are the columns a production column-mask policy would gate to each RM's role. Talking track: *"the RM sees the customer they're cleared to see, examiners get the trail — one permission model from ingestion to the app."* (No masking policy is provisioned in the demo; it's described.)
- **Unity AI Gateway**: every model call from the app routes through the Gateway — hard spend cap (~$300K/yr), quality/cost routing, end-to-end tracing. This is how Wen (Technology Finance) forecasts and defends the number and how Marisol traces a recommendation back to the data. Talking track only.
