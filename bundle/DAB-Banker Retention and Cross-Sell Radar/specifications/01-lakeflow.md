# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Company / story**: Meridian Bank — consumer & small-business bank. Persona: Yusuf Demirel, EVP Consumer & Small Business Banking. The demo gives relationship managers (RMs) a live customer 360 + next-best-action (NBA). See `README.md` and `context/source-brief.md` (authoritative).

**Location**: catalog `solution_builder`, schema `demo_banker_retention_cross_sell_radar`. All tables live here.

**Segments** (customer): `Mass Market` 65%, `Affluent` 25%, `Small Business` 10%.

**Branches** (12, each with a `region`): Downtown / Riverside / Harbor / Uptown (East region); Lakeside / Meadowbrook / Fairview / Oakhill (Central region); Bayview / Highland / Summit / Parkway (West region). Each customer belongs to one home branch.

**Products** (holdings + cross-sell catalog): `Checking`, `Savings`, `High-Yield Savings`, `Credit Card`, `Auto Loan`, `Mortgage`, `Small Business Line`, `Wealth Management`. Annual revenue-per-holding (used for cross-sell opportunity $): Checking $40, Savings $60, High-Yield Savings $180, Credit Card $220, Auto Loan $350, Mortgage $500, Small Business Line $900, Wealth Management $1,400.

**Time references**: `NOW = datetime.now()` (rolling — right edge of the chart is always ~yesterday). `HISTORY_START = NOW − 26 weeks` (weekly balance history). `TXN_START = NOW − 180 days`. Attrition event anchors:
- `RUNOFF_START = NOW − 6 weeks` — the drifting cohort's balances begin their peak-to-drain decline.
- `PAYROLL_STOP = NOW − 5 weeks` — the cohort's direct-deposit / payroll credits stop (no `payroll` txns after this).
- `RISK_PEAK = NOW − 3 weeks` — at-risk balance + at-risk customer count peak (most of the cohort has now crossed the runoff threshold). Elevated but slightly decaying since (some balances hit zero / customers gone).

The peak sits clearly in the past (3 weeks back), builds up over the prior 3 weeks, and stays elevated — never a cliff at the chart's right edge.

**The drifting cohort (the catalyst — must be visible to the eye)**: ~600 customers, skewed **Affluent** (~70%) and concentrated in **3 branches** (Harbor, Bayview, Highland). Their signature: `payroll_interrupted = TRUE` (direct deposit stopped ~5 weeks ago) **and** `balance_runoff_pct` 55–90% over the last 6 weeks. These are high relationship-value customers (avg ~$1,150/yr vs ~$500 book average) — the classic pre-attrition signature a banker used to catch by hand. On the weekly trend this cohort must **dominate** normal book variance: at-risk relationship value ramps from a low baseline to a clear peak at `RISK_PEAK`, so anyone in the room can point at it.

**The cross-sell-ready cohort**: ~1,500 customers, **not** drifting (low risk), who clearly qualify for a product they don't hold — e.g. high checking balance + no High-Yield Savings, strong deposit history + no Credit Card, business inflows + no Small Business Line. Their summed annual `cross_sell_opportunity_usd` totals ~$3–4M (matches README target).

> Numbers are demo targets, not invariants — match the narrative shape, ±10% is fine.

---

## A. Synthetic Data Generation

**Skill**: `databricks-synthetic-data-gen` (read `SKILLS/databricks-synthetic-data-gen/SKILL.md`). Use the pre-provisioned databricks-connect venv (Python 3.12 + faker + numpy + pandas). Do NOT create a new venv.

Write raw datasets as **parquet into the UC Volume** `/Volumes/solution_builder/demo_banker_retention_cross_sell_radar/raw_data/<dataset>/` (one subdir per dataset). SDP silver reads them via `read_files()` — no bronze pass-through, no raw Delta tables.

| Dataset | Rows | Notes |
|---------|------|-------|
| `customers` | ~20K | Segment + branch per Shared Context. `relationship_value_usd` skewed by segment (Mass ~$350, Affluent ~$1,150, Small Business ~$1,400) with noise. `tenure_months` 1–240. PII columns present but demo-safe (faker names, synthetic emails, masked SSN-like id). |
| `accounts` | ~45K | 1–4 per customer. `account_type` ∈ products list. `balance_usd` (current). `open_date`, `status` (`open`/`closed`). Checking is near-universal; product mix drives cross-sell eligibility. |
| `transactions` | ~1.1M | Last 180 days. `txn_type` ∈ `direct_deposit`/`payroll`/`withdrawal`/`purchase`/`transfer`/`fee`/`bill_pay`. Regular customers get recurring `payroll` credits (~bi-weekly). Powers payroll-interruption detection + the app drawer timeline. |
| `balance_weekly` | ~1.17M | Weekly balance snapshot per account (~45K × 26 weeks). The shaped runoff lives here (see below). |

### Data variation & the event

- **Baseline balances**: stable with ±5% weekly gaussian noise; mild seasonal drift. No dramatic movement for non-cohort accounts.
- **Drifting cohort balance runoff**: for the ~600 cohort customers' primary deposit accounts, balances are flat/high through `RUNOFF_START`, then decline week-over-week so that by `RISK_PEAK` runoff is 55–90% of the 6-week-prior peak; balances stay low/near-zero after. Stagger each customer's threshold-crossing week across the −6w…−3w window so the at-risk **count** ramps smoothly to a peak (not a single step).
- **Payroll interruption**: cohort customers have regular `payroll` credits before `PAYROLL_STOP` and **none** after. Non-cohort customers keep receiving payroll throughout.
- **Cross-sell-ready cohort**: ~1,500 non-cohort customers engineered to hold Checking (+ maybe Savings) with strong balances/deposits but **missing** exactly one high-value product they qualify for — so the NBA logic in gold flags a concrete `nba_product`.

### Raw schemas (gen output; PKs bold, FKs marked)

- **`customers`** — **customer_id** (`CUST-NNNNNN`), first_name, last_name, email, ssn_masked (`***-**-NNNN`), segment, home_branch, branch_region, registration_date, tenure_months, relationship_value_usd, rm_name (assigned relationship manager).
- **`accounts`** — **account_id** (`ACCT-NNNNNNNN`), customer_id (FK), account_type, balance_usd, open_date, status.
- **`transactions`** — **transaction_id** (`TXN-...`), account_id (FK), customer_id (FK), txn_date (TIMESTAMP), amount_usd (credits +, debits −), txn_type, channel (`branch`/`atm`/`online`/`mobile`/`ach`).
- **`balance_weekly`** — account_id (FK), customer_id (FK), week_start (DATE), balance_usd. (Synthetic key = `account_id + week_start`.)

---

## B. SDP Pipeline

**Skill**: `databricks-pipelines` — read `SKILLS/databricks-pipelines/SKILL.md` before implementing. Pipeline name `meridian_retention_radar`, raw parquet → silver → gold.

### Consumer requirements

| Consumer | Needs | From table |
|----------|-------|------------|
| Dashboard KPIs + weekly trend + segment/branch splits | at-risk relationship value, at-risk customers, cross-sell opportunity $, avg risk score, attrition risk rate, by week/segment/branch | `mv_book_health` (over `gold_weekly_book_summary`, defined in `02-uc-governance.md`) |
| Dashboard cohort widgets (risk-band split, runoff vs risk, cross-sell by product) | per-customer 360 with risk + NBA + signals | `gold_customer_360` |
| App Radar queue (drifting + cross-sell-ready) | one row per actionable customer + NBA + signals + status | `gold_rm_radar` (mirrored to Lakebase) |
| App customer-360 drawer (balance runoff sparkline + payroll timeline) | weekly balances + recent transactions per customer | `silver_balance_weekly`, `silver_transactions` (mirrored to Lakebase) |

### Silver (joins + expectations)

- **`silver_customers`** — passthrough from `raw_customers` + expectations (non-null customer_id, valid segment/branch).
- **`silver_accounts`** — `raw_accounts` JOIN `raw_customers` (→ segment, home_branch, branch_region).
- **`silver_transactions`** — `raw_transactions` JOIN `raw_customers` (→ segment, home_branch). Columns: transaction_id, customer_id, account_id, txn_date, amount_usd, txn_type, channel, segment, home_branch. Cluster by txn_date.
- **`silver_balance_weekly`** — `raw_balance_weekly` JOIN `raw_accounts`/`raw_customers` (→ segment, home_branch, account_type). Add derived per-(customer, week):
  - `peak_balance_6w` — max customer balance in the trailing 6 weeks.
  - `runoff_pct` — `(peak_balance_6w − balance_usd) / NULLIF(peak_balance_6w,0)` at customer grain (sum balances across accounts per customer per week first).
  - `payroll_active` — TRUE if the customer had a `payroll` credit within the trailing 30 days of that week (from `silver_transactions`).
  - `weekly_at_risk_flag` — TRUE iff `runoff_pct >= 0.5 AND payroll_active = FALSE`. This is what produces the ramping at-risk trend.

### Gold

**`gold_customer_360`** — one row per customer, the current snapshot + signals + NBA. Columns:
- Identity/dims: `customer_id`, `first_name`, `last_name`, `email`, `segment`, `home_branch`, `branch_region`, `rm_name`, `tenure_months`, `relationship_value_usd`.
- Holdings: `products_held` (int, count of open accounts by type), `products_list` (array/CSV), `total_balance_usd`.
- Attrition signals (current): `balance_runoff_pct` (latest week's customer-grain runoff), `days_since_last_payroll`, `payroll_interrupted` (bool), `attrition_risk_score` (0–1, derived — higher with payroll interruption, high runoff, low products_held, long days_since_last_payroll; cohort ≈ 0.75–0.95, baseline ≈ 0.05–0.25), `risk_band` (`High` ≥0.6 / `Medium` 0.3–0.6 / `Low` <0.3).
- Cross-sell: `cross_sell_eligible` (bool), `nba_product` (recommended product not currently held, from a simple eligibility rule — e.g. high checking balance + no High-Yield Savings → High-Yield Savings; strong deposits + no Credit Card → Credit Card; business inflows + no Small Business Line → Small Business Line), `cross_sell_opportunity_usd` (annual revenue of `nba_product` from Shared Context).
- **NBA**: `nba_type` (`retention` if `risk_band='High'`; else `cross_sell` if `cross_sell_eligible`; else `none`), `nba_reason` (short human string, e.g. *"Payroll stopped 5 weeks ago; balance down 74% — offer a retention save package"* or *"$42K in checking, no High-Yield Savings — offer HYS ladder"*).

**`gold_weekly_book_summary`** — dims `week_start`, `segment`, `home_branch`. Metrics per slice: `at_risk_balance_usd` (`SUM(balance)` where `weekly_at_risk_flag`), `at_risk_customers` (`COUNT(DISTINCT customer)` where flagged), `total_relationship_value_usd`, `avg_risk_proxy`, `book_customers` (distinct customers that week), `cross_sell_opportunity_usd` (sum over cross-sell-ready customers active that week — steady, not spiky). **Dashboard-filter contract**: every dashboard aggregate MUST carry `segment` and `home_branch` as filter dimensions — this table enforces it; `mv_book_health` inherits it.

**`gold_rm_radar`** — the app's Radar queue: `SELECT * FROM gold_customer_360 WHERE nba_type IN ('retention','cross_sell')` (~2,000 rows). This is the actionable book the RM works. Add `status` default `'pending'` (app flips it), `priority` (High risk first, then cross-sell $ desc).

### Consumer routing
- `mv_book_health` (over `gold_weekly_book_summary`) → dashboard KPIs + weekly trend + segment/branch splits.
- `gold_customer_360` → dashboard cohort widgets (risk band, runoff scatter, cross-sell by product).
- `gold_rm_radar` → app Radar queue (mirrored to Lakebase).
- `silver_balance_weekly` + `silver_transactions` → app customer-360 drawer (mirrored to Lakebase).

---

## C. Validation

Run before publishing downstream resources. Each row is a one-line query; if it fails, fix the synth.

**Load-bearing (gate the story):**
- **At-risk spike, peak in the past** — weekly `SUM(at_risk_balance_usd)` from `gold_weekly_book_summary`: ramps from a low baseline (~6 weeks ago) to a clear peak at `RISK_PEAK` (~3 weeks ago), stays elevated but does not peak in the current week.
- **At-risk customer count ramps** — weekly `SUM(at_risk_customers)` climbs smoothly to a peak ~3 weeks ago (staggered threshold crossings, not one step).
- **Cohort is Affluent + branch-concentrated** — `gold_customer_360 WHERE risk_band='High'` GROUP BY segment → Affluent leads (~70%); GROUP BY home_branch → Harbor / Bayview / Highland dominate.
- **Payroll interruption present** — High-risk customers: `payroll_interrupted = TRUE` for the vast majority; `days_since_last_payroll` ≥ 30.
- **Runoff separates** — High-risk `balance_runoff_pct` ≥ 0.5; Low-risk near 0.
- **Cross-sell opportunity totals ~$3–4M** — `SUM(cross_sell_opportunity_usd)` over `cross_sell_eligible` customers ≈ $3–4M; every eligible customer has a non-null `nba_product` they don't already hold.
- **NBA coverage** — `gold_rm_radar` has ~2,000 rows split across `retention` and `cross_sell`; every row has a non-empty `nba_reason`.

**Smoke checks:** segment/branch enums valid; `attrition_risk_score` in [0,1]; `products_held` ≥ 1 (everyone has Checking); `relationship_value_usd` non-null.

Add `pipeline_id` to `resources.json`.
