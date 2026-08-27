# Meridian Bank — Retention & Cross-Sell Radar

## The Story

| | |
|---|---|
| **Company** | Meridian Bank — US consumer & small-business bank, branch network |
| **Hero** | Yusuf Demirel, EVP Consumer & Small Business Banking (business); Sinead Gallagher, Head of Data Platform Engineering, and Marisol Otero, Platform Engineering Lead (technical) |
| **Problem** | Attrition (~12%/yr, ~216K customers, ~$500 avg relationship value) and missed cross-sell (~$15M/yr left on the table). RMs work from overnight extracts and can't see a live customer picture; broad PII exposure is a constant compliance worry, and any AI fix must have a governed, capped spend. |
| **Investigation** | Yusuf opens a live customer 360 and sees both signals in one place — balance runoff, payroll interruption, relationship depth, product eligibility — sliced by segment and branch. A cohort of Affluent customers went dark ~3 weeks ago: direct deposits stopped, balances draining. |
| **Root cause** | Payroll interruption + multi-week balance runoff = the classic pre-attrition signature a banker used to catch by hand. The same governed view surfaces who's *ready for an offer* (qualified, not yet holding the product). |
| **Impact** | ~$1.1M/yr per point of attrition avoided; ~$3–4M/yr cross-sell uplift; PII exposure scoped to each banker's role; ~$300K/yr AI spend, hard-capped and auditable — overnight extracts replaced by live, in-the-call RM decisions. |

---

## Overview

Meridian Bank loses customers quietly. A direct deposit stops, a balance drains over several weeks, and the bank only notices after the relationship has already weakened. At the same time, customers who clearly qualify for a savings ladder, a card, or a small-business line are never offered it — the relationship manager (RM) works from a static overnight extract and can't see the whole picture.

This demo gives RMs a **real-time customer 360 and a next-best-action (NBA) recommendation they can act on during the call** — without copying PII into a second system and without letting AI spend run open-ended.

Yusuf opens the **Retention & Cross-Sell Radar** app and sees the whole book sliced by segment and branch: which accounts are drifting (balance runoff + payroll interruption), which customers are ready for an offer, and *why* each recommendation is being made. During a call, the banker drafts a **retention save-offer** and a **cross-sell recommendation**, reviews the reasoning, and **confirms** — the app writes the follow-up and a full audit trail back to the operational store. Every AI call runs through **Unity AI Gateway** with a hard spend cap, so Wen (Technology Finance) can forecast and defend the number, and Marisol can trace any recommendation back through the account and transaction data an examiner would accept.

**Duration:** 6–8 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Annual attrition rate | ~12%/yr (~216K customers) |
| Avg relationship value | ~$500/yr |
| Value per point of attrition avoided | ~$1.1M/yr |
| Missed next-best-action revenue on the table | ~$15M/yr |
| Cross-sell uplift target | ~$3–4M/yr |
| Governed AI spend for this use case | ~$300K/yr (hard-capped) |
| At-risk cohort catalyst | Payroll stopped ~3 weeks ago, balances draining |

---

## Demo Walkthrough

**Frame:** Yusuf and his RM team need to know, before the customer calls, who is drifting and who is ready for an offer — live, not from last night's extract.

### Act 1 — The live customer 360 (2 min)
Open the **Retention & Cross-Sell Radar** app. KPI tiles show book-level attrition risk and cross-sell opportunity in dollars. The **AI/BI dashboard** (embedded + in Databricks One) shows the at-risk cohort standing out: a spike in high-risk balances ~3 weeks ago driven by payroll interruption, sliced by segment and branch.

> *"This isn't an overnight extract. The RM's operational state — the customer 360, the action queue, the audit trail — lives in **Lakebase** (serverless Postgres), synced from the **SDP** Gold tables that **Lakeflow Connect** feeds from the core banking, card, and payroll systems. One source of truth, read live, no second copy of PII."*

### Act 2 — Why is this account drifting? (2 min)
Open a drifting customer. The 360 shows balance runoff over the last several weeks, the day the direct deposit stopped, relationship depth (products held), and the **NBA recommendation with its reason**. The in-app assistant answers *"why is this recommended?"* by tracing the underlying accounts and transactions.

> *"Every model call goes through **Unity AI Gateway** — one governed layer, a hard spend cap, full tracing. **Unity Catalog** masks PII to each banker's role, so the RM sees what they're cleared to see and nothing more. When a client escalates, Marisol can hand an examiner the trail from the recommendation back to the transaction."*

### Act 3 — Act on it, in the call (2 min)
Click **Draft actions** for the customer. The assistant drafts a **retention save-offer** (for the drifting cohort) and a **cross-sell recommendation** (for a qualified, un-held product), each with its rationale. The banker reviews, then **confirms** — a hard human-in-the-loop stop. On confirm, the app writes the follow-up action + audit rows to **Lakebase** in one atomic update; KPI tiles and the action queue tick live.

> *"This is the difference between a chatbot and an app that acts. The write is governed, capped, and auditable — the offer, who approved it, and the data behind it, all recorded."*

### Act 4 — Zoom out: governed AI at portfolio scale (1 min)
Switch to Databricks One. Same dashboard, same governed data. Show the **metric views** powering the KPIs and the **AI Gateway** spend view.

> *"Same Lakeflow Connect ingestion, same SDP Gold tables, same metrics, same Unity Catalog governance. The RMs get an app to operate the book; finance and the CEO get Databricks One. And Wen can defend the ~$300K/yr as one governed, capped line in the company-wide AI budget."*

---

## Products Showcased

"Build" = a resource we provision in the workspace. "Talk track" = a platform capability we mention live but don't build per-demo.

| Product | Mode | What it does in this demo |
|---------|------|---------------------------|
| **Lakeflow Connect** | Talk track | Pulls core banking, card, and payroll feeds into the lakehouse — no custom plumbing, so payroll interruptions are visible the day they happen |
| **SDP Pipeline** | Build | Turns raw accounts / transactions / customer profiles into Gold tables (customer 360, attrition signals, cross-sell eligibility) that the dashboard, metrics, and app all read |
| **Metric Views** | Build | One governed definition of attrition rate, relationship value, and cross-sell opportunity — dashboard tiles and the app read the same numbers |
| **AI/BI Dashboard** | Build | The at-risk cohort and cross-sell opportunity at a glance, sliced by segment and branch; embedded in the app and in Databricks One |
| **Lakebase** | Build | Serverless Postgres behind the app — the live customer 360 mirror, the RM action queue, and the audit trail that ticks during the demo |
| **Databricks Apps** | Build | Hosts the Retention & Cross-Sell Radar — full-stack React/FastAPI, OAuth + resource bindings, PII scoped to role; the in-app assistant drafts NBA and writes back on approval |
| **Unity AI Gateway** | Talk track | One governed layer over every model call — hard spend cap (~$300K/yr), quality/cost routing, end-to-end tracing so finance can forecast and defend the number |
| **Unity Catalog** | Talk track | One permission + lineage model from ingestion to the app; column masks keep PII scoped to each banker's role; the trail an examiner would accept |
| **Genie One** | Talk track | The business-user front door — Yusuf can ask which accounts are drifting or who's ready for an offer in natural language, governed by the same access controls |
| **Genie Code** | Talk track | Copilot that assembles the pipeline, dashboard, and app surfaces on Databricks |
