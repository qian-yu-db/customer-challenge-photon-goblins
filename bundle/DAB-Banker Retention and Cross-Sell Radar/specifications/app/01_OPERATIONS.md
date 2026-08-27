# Radar Page (`/operations`)

The RM's live customer 360 + next-best-action queue. OLTP write surface — the RM works the actionable book, agent actions land in real time. This is the primary page; design it so a screenshot reads as *"a banker's retention console"*, not "a table with rows".

## Layout

**Header:** "Work the book — live." / "Every drifting account and every ready-for-an-offer customer, in one place. No overnight extract."

**"Ask the assistant" banner:** Sparkle card — *"A cohort just went quiet — ask the assistant which accounts are drifting."* Opens the dock with the first scripted prompt.

**KPI cards (3 across):** At-Risk Relationship Value ($, orange accent) | At-Risk Customers (count) | Cross-Sell Opportunity ($, blue accent). Live-update moment — counters tick when the agent confirms actions.

**Segment/branch strip** (between KPIs and the table): horizontal bars per **branch** showing at-risk-customer counts, colored by risk band. Width proportional to count; right side shows `count · at-risk $`. Click a branch → adds a `Branch: Harbor ✕` filter chip and narrows the queue. Reads the same scope as the table, auto-refreshes on `dataMutated`. Harbor / Bayview / Highland visibly tower — the concentration story without a map library.

**Radar table:** filterable, sortable queue over `gold_rm_radar` (mirrored to Lakebase).
- **Status tabs:** All / Pending / Actioned (pill toggle).
- **NBA-type tabs / chips:** All / Retention / Cross-Sell.
- **Search:** free-text across customer name, RM, branch.
- **Filter chips:** Branch, Segment, Risk band (from the strip, the dashboard drill-down, or the agent's reply) — dismissible ✕. All filter/sort state URL-synced.
- **Sortable columns:** **Risk score** (0–1, the drift signal), **Cross-Sell $**. Default sort `priority` (High-risk first, then cross-sell $ desc).
- **Columns:** Customer (name + segment badge) | Branch | RM | **Risk** (mini 0–1 bar, color-graded blue→orange) | **NBA** (type pill: `Retention` orange / `Cross-Sell` blue + the `nba_product`) | Relationship $ | Cross-Sell $ | **Action** (after commit: `Actioned` badge + short offer summary) | Status.
- Click row → customer-360 drawer.

**Customer-360 drawer (right slide-over, ~60% width).** Header: name + segment badge + branch + RM + risk-band pill. Three tabs:

- **360 tab** — the money shot. A **balance-runoff sparkline** (weekly balances, last 26 weeks from `silver_balance_weekly`) with the drop clearly visible for drifting customers; a **payroll timeline** row that marks the last `payroll` credit and flags `days_since_last_payroll`; a signals grid (runoff %, risk score, products held, tenure, relationship value). The **NBA panel**: the recommended `nba_product` (or retention package) + `nba_reason` rendered as the headline — *"why this recommendation"* — so the RM can defend it on the call.
- **Actions tab** — Draft retention save-offer / Draft cross-sell buttons (or read the agent's drafted offer). Confirm (primary) / Dismiss buttons. Confirm commits to Lakebase → row flips to `Actioned`, KPIs refresh, drawer timeline grows.
- **Activity tab** — merged timeline: drafted offers + confirmed actions + audit trail (RM email + timestamp per entry). Updates live when the agent writes.

## Data
~2,000 actionable customers in `gold_rm_radar`: ~600 `retention` (the drifting Affluent cohort, High risk, concentrated in Harbor/Bayview/Highland) + ~1,500 `cross_sell` (ready-for-an-offer, Low risk, NBA product they qualify for but don't hold). After the agent confirms: targeted rows flip to `actioned` with `action_taken` + `offer_summary` recorded, and an email + audit entry appended — so the queue tells the story even after the chat is closed. The Risk column makes the drift visible (cohort rows skew 0.75+, cross-sell rows near 0.1); sorting by risk lands the most at-risk customer at the top.
