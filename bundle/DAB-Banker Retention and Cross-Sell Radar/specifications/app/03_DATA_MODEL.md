# Data Model

## Two stores
- **Delta tables** — lakehouse source of truth, read-only from the app. Warehouse queries + Genie read here.
- **Lakebase Postgres** — OLTP write surface. Chat state + operational mirror of the Delta subset the RM works.

## Lakebase schema (`app.*`)

### Chat state (reusable — keep as-is)
| Table | Key fields |
|-------|-----------|
| `conversations` | id, userEmail, title, kind (`demo_dock`/`default`), timestamps |
| `messages` | conversationId, role, content, position, traceId, thinking (JSONB), error |
| `feedback` | messageId, value (`up`/`down`), rationale, traceId, mlflowAssessmentId |

### Delta mirror (Meridian-specific — replace the template's returns/customers)
| Table | Source | Key fields |
|-------|--------|-----------|
| `radar` (primary entity) | `gold_rm_radar` | id (customer_id), firstName, lastName, segment, homeBranch, branchRegion, rmName, tenureMonths, relationshipValueUsd, productsHeld, totalBalanceUsd, riskBand, attritionRiskScore, balanceRunoffPct, daysSinceLastPayroll, payrollInterrupted, nbaType (`retention`/`cross_sell`), nbaProduct, nbaReason, crossSellOpportunityUsd, priority, status (`pending`/`actioned`/`dismissed`), **actionTaken** (text, null until committed), **offerSummary** (text, null until committed), **emails** (append-only JSONB[]), **aiAuditTrail** (append-only JSONB[]), decidedAt, timestamps |
| `balanceWeekly` | `silver_balance_weekly` | customerId, weekStart, balanceUsd (powers the drawer's runoff sparkline) |
| `transactions` | `silver_transactions` | id, customerId, txnDate, amountUsd, txnType, channel (powers the drawer's payroll timeline — filter to `payroll`/`direct_deposit`) |

The two append-only arrays on `radar` make each row a standalone timeline — the agent's `commit_actions` appends an email/note + audit entry per row in one atomic UPDATE. Activity tab renders from one row read. There is **no** ML predictions table and **no** premium-tier mirror in this demo (no ML capability) — drop the template's `customerPremium` table and the `find_lot_premium_breakdown` tool.

## Delta → Lakebase sync
> **Talking track vs build:** production uses **Lakebase Synced Tables** (managed continuous Delta→Lakebase replication, same UC governance). The demo build keeps it simple: a manual one-shot sync at boot — code we can show, no extra resource.

1. If mirror empty → pull via Databricks SQL Statements API: `gold_rm_radar` (the ~2,000 actionable customers), their `silver_balance_weekly` rows (last 26 weeks), and their `payroll`/`direct_deposit` `silver_transactions`.
2. Chunked inserts (respect Postgres param ceiling), idempotent (skip on conflict).
3. "Reset demo" → truncate + re-sync. All agent writes wiped — `status` back to `pending`, `actionTaken`/`offerSummary`/`emails[]`/`aiAuditTrail[]` cleared.

Source tables from `config/app.json` `data.tables` (logical name → Delta table).

## Lakebase provisioning
1. Create Lakebase Postgres project + database in workspace.
2. Wire into `app.yaml` → Lakebase plugin resolves host + credentials at runtime.
3. Auth: SDK chain (CLI profile dev, OBO prod).
4. Schema: Drizzle ORM, migrations from `server/db/schema.ts`, auto-applied on boot.
