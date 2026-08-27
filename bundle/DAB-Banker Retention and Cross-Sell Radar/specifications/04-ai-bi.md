# AI/BI — Dashboard + Genie

Tables/columns defined in `01-lakeflow.md`, metric view in `02-uc-governance.md`. Goal: a Genie space + an AI/BI dashboard for the Meridian retention & cross-sell story.

> **Talking-track-only** (do NOT build): **Databricks One** (workspace surface — the dashboard/Genie appear there automatically), **Genie Code** (authoring assist), **Unity Catalog** + **Unity AI Gateway** (governance layers, described not provisioned).

## A. Genie Space

**Skill**: `databricks-genie` — read `SKILLS/databricks-genie/SKILL.md` before implementing.

Create `Meridian Retention & Cross-Sell Radar` Genie Space.

### Tables
`mv_book_health` (canonical weekly metric view — at-risk value, attrition risk rate, cross-sell opportunity by segment/branch), `gold_customer_360` (per-customer 360: risk score/band, runoff, payroll interruption, NBA product + reason, cross-sell opportunity $), `gold_rm_radar` (the actionable queue), `raw_products` is not a table here — the product catalog lives inline in `gold_customer_360`.

### Self-sufficient room
- **Space `description`**: 1–3 sentences naming the situation (attrition signals + missed cross-sell, the drifting Affluent cohort ~3 weeks ago, the ~$3–4M cross-sell opportunity) and pointing to the suggested questions in order. Lift from README.
- **Story-context `text_instruction`** at the TOP of `instructions.text_instructions[]`: WHAT'S HAPPENING · WHO IT'S FOR (Yusuf, EVP; RMs) · TONE.
- **`sample_questions`** + matching `example_question_sqls` walk the arc below, same order.

### Instructions
```
You analyze Meridian Bank's book of business for Yusuf (EVP Consumer & Small Business Banking) and his relationship managers.

BASELINES: annual attrition ~12%; avg relationship value ~$500/yr; a High risk band = attrition_risk_score >= 0.6.

HEADLINE NUMBERS — always answer from mv_book_health:
- at-risk relationship value, attrition risk rate, cross-sell opportunity → mv_book_health (same definitions as the dashboard KPI tiles).

WHICH ACCOUNTS ARE DRIFTING:
- gold_customer_360 WHERE risk_band='High' → payroll_interrupted, balance_runoff_pct, segment, home_branch. Expect Affluent + Harbor/Bayview/Highland concentration.

WHY IS THIS ACCOUNT DRIFTING / WHY THIS RECOMMENDATION:
- Read nba_reason on gold_customer_360 — it states the signal (payroll stopped N weeks ago, balance down X%) or the cross-sell rationale ($ in checking, no High-Yield Savings).

WHO IS READY FOR AN OFFER:
- gold_customer_360 WHERE cross_sell_eligible = TRUE → nba_product, cross_sell_opportunity_usd. Sum ≈ $3–4M.
```

### Sample questions — story arc
1. **Headline** — "What's our at-risk relationship value this week and how does it compare to a month ago?" → weekly `MEASURE(at_risk_balance)` + `MEASURE(attrition_risk_rate)` from `mv_book_health`.
2. **Where's the risk** — "Which segments and branches have the most at-risk customers?" → `mv_book_health` GROUP BY segment / home_branch.
3. **Which accounts are drifting** — "Show me the highest-risk customers and why." → `gold_customer_360 WHERE risk_band='High' ORDER BY attrition_risk_score DESC`, surface `nba_reason`.
4. **The signal** — "How many high-risk customers had their payroll stop?" → COUNT WHERE `payroll_interrupted` AND `risk_band='High'`.
5. **Cross-sell** — "Who is ready for a next-best-action offer, and what's it worth?" → `gold_customer_360 WHERE cross_sell_eligible`, GROUP BY `nba_product`, SUM `cross_sell_opportunity_usd`.
6. **Recovery / recap** — "What's the total cross-sell opportunity by segment?" → `mv_book_health` cross_sell_opportunity by segment.

### Validation
"At-risk value this week?" → from `mv_book_health`. "Which accounts are drifting?" → Affluent + Harbor/Bayview/Highland, payroll interrupted. "Who's ready for an offer?" → cross-sell-eligible list, ~$3–4M total. Add `genie_space_id` to `resources.json`.

## B. Dashboard

**Skill**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing. Save locally as `PROJECT/dashboard.json`. Link the Genie space. Set `--dataset-catalog` and `--dataset-schema` on BOTH `lakeview create` and `lakeview update`.

Create `Meridian Retention & Cross-Sell Radar` dashboard. Two pages: **Retention** (the glance — something is drifting) and **Cross-Sell** (the opportunity — who's ready).

### Theme
```
canvasBackgroundColor: #F5F7FB / #0F1419
widgetBackgroundColor: #FFFFFF / #161B22
widgetBorderColor:     same as widgetBackgroundColor (no visible border)
fontColor:             #1F2530 / #E8ECF0
selectionColor:        #1B4D8F / #7FB3F0
visualizationColors:   ["#0A2E5C","#1B6CA8","#5AB4E6","#F2B705","#E8590C"]
widgetHeaderAlignment: LEFT
```
5-stop palette cool → warm: deep navy → ocean blue → sky → gold → burnt orange. Position 0 (`#0A2E5C`) is the anchor (KPI values, largest segment).

**Semantic color pins (literal-hex everywhere, NEVER `themeColorType: position N`):**
- **At-risk / High risk band** → `#E8590C` burnt orange.
- **Medium risk** → `#F2B705` gold.
- **Low / healthy / baseline** → `#1B6CA8` ocean blue.

**Segment color pins** (every widget colored by `segment`):
| Segment | Hex |
|---|---|
| Affluent | `#0A2E5C` deep navy (the drifting cohort's segment — anchor) |
| Mass Market | `#1B6CA8` ocean blue |
| Small Business | `#5AB4E6` sky |

### Datasets (3)
| Name | Source | Powers |
|---|---|---|
| `ds_book` | `SELECT week_start, segment, home_branch, MEASURE(\`at_risk_balance\`) AS at_risk_balance, MEASURE(\`at_risk_customers\`) AS at_risk_customers, MEASURE(\`total_relationship_value\`) AS relationship_value, MEASURE(\`cross_sell_opportunity\`) AS cross_sell_opportunity, MEASURE(\`book_customers\`) AS book_customers, MEASURE(\`attrition_risk_rate\`) AS attrition_risk_rate FROM mv_book_health GROUP BY ALL` | KPI counters, weekly trend, segment/branch splits |
| `ds_customers` | `SELECT customer_id, segment, home_branch, branch_region, risk_band, attrition_risk_score, balance_runoff_pct, payroll_interrupted, days_since_last_payroll, products_held, total_balance_usd, cross_sell_eligible, nba_type, nba_product, cross_sell_opportunity_usd, relationship_value_usd FROM gold_customer_360` | Risk-band split, runoff scatter, cross-sell-by-product, radar table |
| `ds_radar` | `SELECT customer_id, first_name, last_name, segment, home_branch, rm_name, risk_band, attrition_risk_score, nba_type, nba_product, nba_reason, cross_sell_opportunity_usd, relationship_value_usd, priority FROM gold_rm_radar` | Radar action table |

No hardcoded date clamps on `ds_book` — the global Date filter windows it.

### Global filters (`PAGE_TYPE_GLOBAL_FILTERS`)
| Filter | Column | Datasets | Default |
|---|---|---|---|
| Date (week) | `week_start` | ds_book | All |
| Segment | `segment` | ds_book, ds_customers, ds_radar | All |
| Branch | `home_branch` | ds_book, ds_customers, ds_radar | All |
| Risk band | `risk_band` | ds_customers, ds_radar | All |

Explicit `filterTargets[]` per filter widget (only the datasets carrying that column).

### Page 1 — Retention (the glance)

**Row 1** — title markdown: *"Meridian Bank — Retention Radar. Yusuf Demirel, EVP Consumer & Small Business Banking. A cohort of Affluent customers went quiet ~3 weeks ago: direct deposits stopped and balances are draining. This page tracks at-risk relationship value, where it's concentrated, and who's drifting."*

**Row 2 — 4 × `counter`** (source `ds_book`), value color `#0A2E5C`, `showTitle: true`:
- **At-Risk Relationship Value** · `SUM(at_risk_balance)` · currency USD compact · *the headline — total over the filtered window.*
- **At-Risk Customers** · `SUM(at_risk_customers)` · number compact.
- **Attrition Risk Rate** · `MAX(attrition_risk_rate)` (or latest-week) · percent · *vs ~12% annual baseline context in the title.*
- **Cross-Sell Opportunity** · `SUM(cross_sell_opportunity)` · currency USD compact · *the ~$3–4M on the table — foreshadows page 2.*

**Row 3 — `line` · "Weekly at-risk relationship value — the drift began ~6 weeks ago"** · `ds_book` · x = `week_start` (temporal), y = `SUM(at_risk_balance)`, color line `#E8590C`. **Vertical-line annotation** on `PAYROLL_STOP` week (from 01-lakeflow), label *"Payroll credits stop"* — sits left of the peak. `frame.description` on: *"Flat baseline → payroll stops → balances drain → at-risk value peaks ~3 weeks ago and stays elevated."*

**Row 4 — two side-by-side**
- **`bar` vertical stacked · "At-risk customers by branch"** · `ds_book` · x = `home_branch`, y = `SUM(at_risk_customers)`, color = `segment` (segment pins) · *Harbor / Bayview / Highland tower, deep-navy Affluent dominates.*
- **`bar` horizontal · "At-risk relationship value by segment"** · `ds_book` · y = `segment`, x = `SUM(at_risk_balance)`, color = `segment` pins · *Affluent bar dwarfs the rest.*

**Row 5 — `scatter` · "Balance runoff vs risk score — the drifting cohort"** (full width) · `ds_customers` · x = `balance_runoff_pct`, y = `attrition_risk_score`, color = `risk_band` (High `#E8590C` / Medium `#F2B705` / Low `#1B6CA8`) · *a dense orange cluster top-right (high runoff + high risk) separated from the blue baseline blob bottom-left — the cohort is visually obvious.*

### Page 2 — Cross-Sell (the opportunity)

**Row 1** — title markdown: *"Cross-Sell Radar — who's ready for a next-best-action offer. ~$3–4M/yr of product-holding revenue is on the table because RMs work from overnight extracts. This page ranks the opportunity by product, segment, and branch."*

**Row 2 — 3 × `counter`** (`ds_customers`), `showTitle: true`:
- **Cross-Sell-Ready Customers** · `COUNT WHERE cross_sell_eligible` (dataset filters to eligible) · number.
- **Total Opportunity** · `SUM(cross_sell_opportunity_usd)` over eligible · currency USD compact.
- **Avg Opportunity / Customer** · `AVG(cross_sell_opportunity_usd)` over eligible · currency USD.

**Row 3 — two side-by-side** (over `ds_customers`, eligible only):
- **`bar` horizontal · "Cross-sell opportunity by next-best product"** · y = `nba_product`, x = `SUM(cross_sell_opportunity_usd)`, sort DESC, color anchor `#1B6CA8` · *Wealth Management / Small Business Line / Mortgage lead the $.*
- **`bar` vertical stacked · "Ready customers by branch"** · x = `home_branch`, y = `COUNT(*)`, color = `segment` pins.

**Row 4 — `table` · "RM Radar — next best actions"** (full width) · `ds_radar` · columns `first_name`, `last_name`, `segment`, `home_branch`, `rm_name`, `risk_band` (color rule: High orange / Medium gold), `nba_type`, `nba_product`, `cross_sell_opportunity_usd` (currency), `nba_reason` (wrap) · sort `priority` then `cross_sell_opportunity_usd` DESC · *the actionable list the RM works — retention rows and cross-sell rows interleaved by priority.*

### Validation
Published dashboard reads at a glance: the at-risk value line ramps to a peak ~3 weeks ago with the payroll annotation left of it; Harbor/Bayview/Highland + Affluent dominate the branch/segment splits; the scatter shows a clear orange cohort; page 2's opportunity totals ~$3–4M and the radar table lists NBA reasons. Global filters update every widget. Genie's "at-risk value this week?" matches `MEASURE(at_risk_balance)`. Add `dashboard_id` to `resources.json`.
