# App Specification — Overview, Home & Assistant

> **Build-time note.** Read `DEMO_SKILL_DIR/app/app.md` FIRST and follow it end-to-end (rsync template → customize → Lakebase → env → smoke test → deploy). This is NOT a from-scratch build: the template at `DEMO_SKILL_DIR/app/app_template/` already ships React + Express (`@databricks/appkit`), Lakebase, agent streaming, MLflow tracing, OBO auth, chat dock, scripted demo chain. Rewrite the domain pieces (home narrative, agent tools, Lakebase schema, analytics SQL, theming). On conflict: `app.md` governs *how*, this spec governs *what*.

## Pitch — the Retention & Cross-Sell Radar

The **Meridian Retention & Cross-Sell Radar** is the RM's live customer 360 + next-best-action console. An RM (or Yusuf) opens the Radar, sees which accounts are drifting and who's ready for an offer — live, not from an overnight extract. During a call they open a customer, see the balance runoff sparkline and the day payroll stopped, read *why* the recommendation is being made, then have the in-app assistant **draft a retention save-offer and a cross-sell recommendation**. They review, **confirm** (a hard human-in-the-loop stop), and the app writes the follow-up action + audit trail to Lakebase in one atomic update — the Radar queue and KPIs tick live.

This is a **Genie-backed, single-agent** app (no MAS, no Knowledge Assistant, no ML endpoint). The agent's data tool is **Genie** (`ask_genie`) over the space in `04-ai-bi.md`.

## Databricks capabilities mapped
| Capability | Where it shows |
|-----------|---------------|
| **AI/BI Genie** | `ask_genie` tool investigates the book in natural language; reasoning streams into the Thinking panel |
| **Lakebase** | OLTP write surface — the RM Radar queue, the confirmed actions, append-only audit trail. Mirrors the Delta gold tables. Same UC governance |
| **Databricks Apps** | SSO, OBO auth (actions stamped with the RM's email), resource bindings, auto-scaling |
| **Unity AI Gateway** | Every model call routes through the Gateway — hard spend cap (~$300K/yr), tracing. Talking track surfaced in the app's platform/footer copy |
| **AI/BI Dashboards** | Embedded as an SSO iframe — the Retention + Cross-Sell dashboard from `04-ai-bi.md` |
| **MLflow tracing** | Per-turn traces with tool spans; "View trace" under each assistant message; thumbs → assessments |

## Pages
| Page | Purpose | Key capability |
|------|---------|---------------|
| **Home** | Narrative landing — story, persona (Yusuf + RM), journey diagram, starter chips, featured action, activity feed | Config-driven |
| **Radar** (`/operations`) | The book of actionable customers — filter by risk band / segment / branch / NBA type, KPI cards (At-Risk value, At-Risk customers, Cross-Sell opportunity), customer-360 drawer with runoff sparkline + payroll timeline + NBA reason + Draft/Confirm actions | **Lakebase** OLTP |
| **Analytics** (`/analytics`) | In-app warehouse charts — weekly at-risk value trend, at-risk by branch, cross-sell by product | **SQL Warehouse** on Delta |
| **Dashboard** (`/dashboard`) | Embedded AI/BI dashboard iframe | **AI/BI Dashboards** |

## Assistant — one brain, two surfaces
Floating dock (persistent per user, `kind='demo_dock'`) + full-page chat. Thinking panel streams Genie reasoning + tool calls live, persisted as `thinking[]` JSONB.

### Human-in-the-loop — 3-phase action chain
1. **Discover** — for a drifting customer (or a cohort), read the customer 360 + NBA from Lakebase (risk score, runoff %, days since payroll, products held, `nba_product`, `nba_reason`), count/total the affected set (read-only).
2. **Draft + confirm** — draft a **retention save-offer** (for `nba_type='retention'`: e.g. fee waiver + rate match + RM callback) AND a **cross-sell recommendation** (for `nba_type='cross_sell'`: the `nba_product` with its rationale), each with the reason quoted from `nba_reason`. Show the drafts + who they apply to → **STOP, wait for approval**.
3. **Execute** (after "yes") — one atomic UPDATE on Lakebase: set `action_taken`, `offer_summary`, flip `status` → `actioned`, append an email/note entry + an audit entry (stamped with the RM's email + timestamp). Emit `dataMutated` → Radar KPIs + queue rows update live.

> **Write tool must trigger a visible UI refresh.** `commit_actions` publishes `dataMutated` on commit. The Radar page refetches: the At-Risk / Cross-Sell KPI cards tick, actioned rows flip status and gain an `Actioned` / offer badge, an open drawer re-fetches its timeline. That live cascade is the demo's payoff — confirm it works before declaring the app ready.

## Agent tools
| Tool | What it does | Phase |
|------|-------------|-------|
| `ask_genie` | Delegates to the Genie space — natural-language investigation over `mv_book_health` / `gold_customer_360` / `gold_rm_radar`, streams reasoning to the Thinking panel | Investigation |
| `find_radar_customers` | Lakebase read: actionable customers for a filter (risk band, segment, branch, or a single customer_id) — each with `nba_type`, `nba_product`, `nba_reason`, `attrition_risk_score`, `balance_runoff_pct`, `cross_sell_opportunity_usd` | Discovery |
| `draft_retention_offer` | Pure function — builds a retention save-offer package (fee waiver / rate match / RM callback) + message text from the customer's signals. No DB write. | Draft |
| `draft_cross_sell` | Pure function — builds a cross-sell recommendation for the `nba_product` + rationale. No DB write. | Draft |
| `commit_actions` | **WRITE**: SELECT the target set by FILTER (a scalar — customer_id or a risk_band/branch filter), set `action_taken` + `offer_summary`, flip `status`→`actioned`, append email + audit entries, one atomic `UPDATE`. Returns counts + totals from `RETURNING`. Emits `dataMutated`. | Execution (requires approval) |

> **Model constraint (from TEMPLATE_MAP):** the agent runner needs the Responses API — keep `agentModel` on `databricks-gpt-5-4` (or a newer Responses-capable GPT). Anthropic models 400 on the passthrough.

## Home page
- **Story section:** persona badge (*"Yusuf Demirel · EVP Consumer & Small Business Banking · Meridian Bank"*), headline (*"216K customers a year slip away quietly — and $15M in cross-sell goes unoffered"*), situation (*a cohort of Affluent customers went dark ~3 weeks ago — payroll stopped, balances draining; meanwhile ~$3–4M of next-best-action revenue sits unoffered because RMs work from overnight extracts*), goal (*live customer 360 → NBA the RM can act on during the call, PII scoped, AI spend capped*), preview bullets.
- **Journey diagram (4 beats):** See the drift → Radar | Ask which accounts are drifting → chat | Understand why → customer-360 drawer | Draft + confirm the action → action flow.
- **Starter chips:** *"Which accounts are drifting, and why?"* / *"Who's ready for a next-best-action offer?"* / *"Why is this recommendation being made?"*
- **Featured action card:** *"Work the drifting Affluent cohort — draft retention + cross-sell offers"* — one click triggers the discover → draft → confirm flow.
- **Activity feed:** live tail (*"Drafted retention save-offer for 42 Affluent customers at Harbor branch", "Recommended High-Yield Savings to 120 cross-sell-ready customers", "Actioned 42 retention follow-ups — RM callbacks queued"*).

## Scripted demo flow (~3 min)
**Step 1 — "Which accounts are drifting, and why?"** Always available. `ask_genie` → the drifting Affluent cohort (Harbor/Bayview/Highland), payroll stopped ~5 weeks ago, balances down 55–90%. Suggests working the cohort.

**Step 2 — "Draft retention offers for the drifting Harbor customers, and cross-sell offers for who's ready."** Unlocks when "drift"/"cohort"/"customers" in the previous answer. Agent calls `find_radar_customers`, then `draft_retention_offer` + `draft_cross_sell`, shows both drafts + who they apply to + the reason from `nba_reason`. **Stops and waits.**

**Step 3 — "Yes — confirm the actions."** Unlocks when "draft"/"offer"/"confirm" mentioned. `commit_actions` runs one atomic UPDATE, emits `dataMutated`. On screen: At-Risk KPI drops as rows flip to `Actioned`, offer badges appear, the audit timeline grows — no reload. **That live cascade is the beat — confirm it works.**

All narrative config lives in `config/app.json` (branding + assistantScript) + hardcoded constants at the top of `HomeView.tsx`.
