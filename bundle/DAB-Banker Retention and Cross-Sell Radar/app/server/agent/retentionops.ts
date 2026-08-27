/**
 * The action-taking agent — Meridian Retention & Cross-Sell Radar.
 *
 * Built on `@openai/agents` (OpenAI Agents SDK) pointed at Databricks'
 * Responses API. Tools capture `db` + `userEmail` via closure so every
 * write is attributed to the viewing RM.
 *
 * This is a GENIE-BACKED, single-agent demo (no MAS). The data-investigation
 * tool is `ask_genie` (from ./tools/genie.ts) over the Genie space in
 * config.genieSpaceId. The 3-phase action chain:
 *   1. discover  — find_radar_customers (read-only Lakebase)
 *   2. draft     — draft_retention_offer + draft_cross_sell (pure), STOP
 *   3. execute   — commit_actions (one atomic UPDATE; requires approval)
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setTracingDisabled,
} from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { findRadarCustomers, commitActions } from '../db/queries/index.js';
import { askGenieTool } from './tools/genie.js';
export type { ToolProgressEvent } from './tools/types.js';

/** Captured detail of the last failing call to the model serving endpoint. */
export type ModelErrorDetail = {
  status: number;
  url: string;
  bodyText: string;
  code?: string;
  message?: string;
};

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  /** Genie space id the `ask_genie` tool queries. Set in config/app.json as
   * `genieSpaceId` (from GENIE_SPACE_ID). See server/agent/tools/genie.ts. */
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  modelError?: { current: ModelErrorDetail | null };
};

// ────────────────────────────────────────────────────────────────────────────
// Tool schemas: Responses API strict mode requires every property in
// `required`. Use `.nullable()`, NOT `.optional()`. Every field needs a
// `.describe()`. Keep property names snake_case.
// ────────────────────────────────────────────────────────────────────────────
const riskBandEnum = z.enum(['High', 'Medium', 'Low']);
const nbaTypeEnum = z.enum(['retention', 'cross_sell']);

function makeTools(ctx: AgentContext) {
  const findRadar = tool({
    name: 'find_radar_customers',
    description:
      "Read-only Lakebase lookup of actionable customers on the RM Radar. Filter by risk_band, segment, home_branch, nba_type, or a single customer_id. Each row carries nba_type (retention|cross_sell), nba_product, nba_reason, attrition_risk_score, balance_runoff_pct, days_since_last_payroll, products_held, relationship_value_usd, cross_sell_opportunity_usd, and status. Use in Phase 1 (discovery) to find and count the set BEFORE drafting anything.",
    parameters: z.object({
      risk_band: riskBandEnum.nullable().describe('High / Medium / Low — filter by attrition risk band, or null.'),
      segment: z.string().nullable().describe('Customer segment (Affluent / Mass Market / Small Business), or null.'),
      home_branch: z.string().nullable().describe('Branch name (e.g. Harbor, Bayview, Highland), or null.'),
      nba_type: nbaTypeEnum.nullable().describe('retention or cross_sell, or null for both.'),
      customer_id: z.string().nullable().describe('A single customer id (e.g. CUST-018825), or null.'),
    }),
    execute: async (a) =>
      mlflow.withSpan(
        async () =>
          findRadarCustomers(ctx.db, {
            riskBand: a.risk_band ?? undefined,
            segment: a.segment ?? undefined,
            branch: a.home_branch ?? undefined,
            nbaType: a.nba_type ?? undefined,
            customerId: a.customer_id ?? undefined,
            status: 'pending',
          }),
        { name: 'find_radar_customers', spanType: mlflow.SpanType.TOOL, inputs: { ...a } },
      ),
  });

  // Pure — builds a retention save-offer package. No DB write.
  const draftRetention = tool({
    name: 'draft_retention_offer',
    description:
      'Pure function — build a retention save-offer package (fee waiver / rate match / RM callback) + a short message for a drifting cohort. No DB write. Call this in Phase 2 for the retention (drifting) customers. Returns {offer_summary, message}.',
    parameters: z.object({
      audience: z.string().describe('Who the offer is for, e.g. "Affluent drifting customers at Harbor branch".'),
      reason: z.string().describe('The drift signal to reference, e.g. "payroll stopped ~5 weeks ago, balances down 55-90%".'),
    }),
    execute: async ({ audience, reason }) =>
      mlflow.withSpan(
        async () => ({
          offer_summary:
            '90-day fee waiver + rate match on savings + priority RM callback within 24h',
          message: `Retention save-offer for ${audience}. Trigger: ${reason}. Waive account/maintenance fees for 90 days, match a competitive savings rate, and schedule a personal RM callback within 24 hours to re-earn the relationship.`,
        }),
        { name: 'draft_retention_offer', spanType: mlflow.SpanType.TOOL, inputs: { audience, reason } },
      ),
  });

  // Pure — builds a cross-sell recommendation for the nba_product.
  const draftCrossSell = tool({
    name: 'draft_cross_sell',
    description:
      'Pure function — build a cross-sell recommendation for the recommended nba_product + its rationale. No DB write. Call this in Phase 2 for the cross-sell-ready customers. Returns {offer_summary, message}.',
    parameters: z.object({
      audience: z.string().describe('Who the offer is for, e.g. "cross-sell-ready customers".'),
      product: z.string().describe('The recommended product, e.g. "High-Yield Savings".'),
      reason: z.string().describe('Why they qualify, e.g. "high checking balance, no High-Yield Savings".'),
    }),
    execute: async ({ audience, product, reason }) =>
      mlflow.withSpan(
        async () => ({
          offer_summary: `${product} with preferential onboarding rate + waived first-year fee`,
          message: `Cross-sell recommendation for ${audience}: ${product}. Rationale: ${reason}. Offer a preferential onboarding rate and waive the first-year fee to open the ${product}.`,
        }),
        { name: 'draft_cross_sell', spanType: mlflow.SpanType.TOOL, inputs: { audience, product, reason } },
      ),
  });

  const commitTool = tool({
    name: 'commit_actions',
    description:
      "WRITE TOOL — the execution step. Commits the drafted offers to the RM Radar for a FILTERED set of PENDING customers, in ONE atomic UPDATE. Pass a scalar filter (customer_id OR risk_band OR home_branch OR segment OR nba_type — never a list of ids) plus the retention_offer + cross_sell_offer text. For each matching row it sets action_taken + offer_summary, flips status → actioned, appends an email + audit entry, and returns counts + totals from RETURNING. Retention rows get the retention_offer; cross_sell rows get the cross_sell_offer. Use ONLY after the RM has approved the drafts.",
    parameters: z.object({
      customer_id: z.string().nullable().describe('Commit for a single customer id, or null to use the other filters.'),
      risk_band: riskBandEnum.nullable().describe('Commit for all pending customers in this risk band, or null.'),
      home_branch: z.string().nullable().describe('Commit for all pending customers at this branch, or null.'),
      segment: z.string().nullable().describe('Commit for all pending customers in this segment, or null.'),
      nba_type: nbaTypeEnum.nullable().describe('Restrict to retention or cross_sell customers, or null for both.'),
      retention_offer: z.string().describe('The retention save-offer text (applied to retention rows).'),
      cross_sell_offer: z.string().describe('The cross-sell offer text (applied to cross_sell rows).'),
    }),
    execute: async (a) =>
      mlflow.withSpan(
        async () =>
          commitActions(ctx.db, {
            filter: {
              customerId: a.customer_id ?? undefined,
              riskBand: a.risk_band ?? undefined,
              branch: a.home_branch ?? undefined,
              segment: a.segment ?? undefined,
              nbaType: a.nba_type ?? undefined,
            },
            retentionOffer: a.retention_offer,
            crossSellOffer: a.cross_sell_offer,
            userEmail: ctx.userEmail,
          }),
        {
          name: 'commit_actions',
          spanType: mlflow.SpanType.TOOL,
          inputs: {
            customer_id: a.customer_id,
            risk_band: a.risk_band,
            home_branch: a.home_branch,
            nba_type: a.nba_type,
          },
        },
      ),
  });

  const tools: Tool[] = [findRadar, draftRetention, draftCrossSell, commitTool];
  if (ctx.genieSpaceId) {
    tools.push(askGenieTool(ctx, ctx.genieSpaceId));
  }
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  const headers = await authHeaders(ctx.req);
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const client = new OpenAI({
    apiKey: bearer,
    baseURL: `${ctx.databricksHost}/serving-endpoints`,
    maxRetries: 4,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Connection', 'close');
      let body = init?.body;
      if (typeof body === 'string' && body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body) as {
            input?: Array<Record<string, unknown>>;
            messages?: Array<Record<string, unknown>>;
          };
          // Responses-API: strip long opaque ids the SDK echoes back (>64 chars).
          if (Array.isArray(parsed.input)) {
            for (const item of parsed.input) {
              const id = item.id;
              if (typeof id === 'string' && id.length > 64) {
                delete item.id;
              }
            }
          }
          if (Array.isArray(parsed.messages)) {
            for (const m of parsed.messages) {
              const content = (m as { content?: unknown }).content;
              if (Array.isArray(content)) {
                for (const part of content as Array<Record<string, unknown>>) {
                  if (part && typeof part === 'object') {
                    delete part.annotations;
                  }
                }
              }
            }
          }
          body = JSON.stringify(parsed);
        } catch {
          /* not JSON — pass through */
        }
      }
      const url =
        typeof input === 'string'
          ? input
          : (input as URL | Request).toString?.() ?? String(input);
      console.debug(
        `[openai-shim] → ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 2000) : '(non-string)'}`,
      );
      const tShim = Date.now();
      let resp: Response;
      try {
        resp = await fetch(input as Parameters<typeof fetch>[0], {
          ...init,
          headers,
          body,
          keepalive: false,
        });
      } catch (e) {
        console.error('[openai-shim] fetch threw', { url, error: e });
        throw e;
      }
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      if (!resp.ok) {
        try {
          const text = await resp.clone().text();
          let code: string | undefined;
          let message: string | undefined;
          try {
            const parsed = JSON.parse(text) as { error_code?: string; message?: string };
            code = parsed.error_code;
            message = parsed.message;
          } catch {
            /* body wasn't JSON — keep raw text */
          }
          if (ctx.modelError) {
            ctx.modelError.current = { status: resp.status, url, bodyText: text, code, message };
          }
          console.error(
            `[openai-shim] ${resp.status} from ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 4000) : '(non-string)'}\n  response_body: ${text.slice(0, 4000)}`,
          );
        } catch (e) {
          console.error('[openai-shim] failed to clone error response', e);
        }
      }
      return resp;
    },
  });
  setDefaultOpenAIClient(client);
  // Responses API (the SDK default). databricks-gpt-5-4 is the baseline;
  // Anthropic models 400 on the /responses passthrough.
  setTracingDisabled(true); // we use MLflow, not OpenAI's tracing backend
}

export function buildAgent(ctx: AgentContext): Agent {
  return new Agent({
    name: 'RetentionRadar',
    model: ctx.model,
    modelSettings: {
      reasoning: { effort: 'low', summary: 'auto' },
      store: false,
    },
    instructions: `
You are the in-app assistant for the Meridian Retention & Cross-Sell Radar.
Your user is a relationship manager (RM) or Yusuf Demirel, EVP of Consumer &
Small Business Banking. Be decisive, concise, and always lead with the number
(dollars and customer counts). This is a live customer 360 + next-best-action
console, not a chatbot.

════════════════════════════════════════════════════════════
TOOLS
════════════════════════════════════════════════════════════

ask_genie(question) — delegates to the AI/BI Genie space over the book of
  business (mv_book_health, gold_customer_360, gold_rm_radar). Use for
  open-ended WHY / WHAT / WHICH investigative questions (which accounts are
  drifting, why is a recommendation being made, book-level trends). Prefer ONE
  focused question over many — broad questions poll longer.

find_radar_customers(risk_band, segment, home_branch, nba_type, customer_id) —
  read-only Lakebase lookup of actionable customers. Each row has nba_type,
  nba_product, nba_reason, attrition_risk_score, balance_runoff_pct,
  days_since_last_payroll, products_held, relationship_value_usd,
  cross_sell_opportunity_usd. Use to find + count the target set before
  drafting.

draft_retention_offer(audience, reason) — pure; builds a retention save-offer
  (fee waiver + rate match + RM callback) + message. No DB write.

draft_cross_sell(audience, product, reason) — pure; builds a cross-sell
  recommendation for the nba_product + rationale. No DB write.

commit_actions(filter…, retention_offer, cross_sell_offer) — THE WRITE TOOL.
  Commits the offers to a FILTERED set of pending customers in one atomic
  UPDATE (sets action_taken, offer_summary, flips status → actioned, appends
  email + audit). Pass a SCALAR filter (customer_id OR risk_band OR
  home_branch OR segment OR nba_type) — never a list of ids. Returns
  {actioned_count, retention_count, cross_sell_count, at_risk_value_usd,
  cross_sell_opportunity_usd, branches, skipped_customer_ids}. Use ONLY after
  the RM approves.

THERE ARE NO OTHER TOOLS. No send_email, no single per-customer write.

════════════════════════════════════════════════════════════
OPERATING MODES
════════════════════════════════════════════════════════════

MODE A — INVESTIGATION
If the RM asks "why", "which", "who", "what", or anything requiring reading
data → call ask_genie ONCE with a focused question, then synthesize. Do NOT
call the write tool unless explicitly asked to act. For "why is this
recommendation being made?" you may also call find_radar_customers with the
customer_id to quote the nba_reason and the underlying signals.

MODE B — ACTION CHAIN (HUMAN-IN-THE-LOOP, 3 PHASES)
When the RM asks you to HANDLE / DRAFT / WORK / ACT ON a cohort, run three
phases with a mandatory approval stop between draft and execute.

--- Phase 1 · Discover (read-only) ---
  1. If you don't already know the target set, call ask_genie to identify the
     drifting cohort (typically Affluent customers at Harbor / Bayview /
     Highland whose payroll stopped ~5 weeks ago and balances are down 55-90%).
  2. Call find_radar_customers with the appropriate filter (e.g. risk_band=High
     for retention, or nba_type='cross_sell' for the ready-for-an-offer set).
     Note the counts, total relationship value, and total cross-sell $.

--- Phase 2 · Draft BOTH offers + STOP FOR APPROVAL ---
  3. Call draft_retention_offer for the drifting (retention) cohort AND
     draft_cross_sell for the cross-sell-ready cohort.
  4. Reply with:
       - A bold headline: "N drifting customers ($X relationship value at risk)
         + M cross-sell-ready ($Y opportunity)."
       - The retention save-offer + who it applies to, quoting a real
         nba_reason from the discovery rows.
       - The cross-sell recommendation + who it applies to (the nba_product),
         quoting a real nba_reason.
       - A one-line CTA: "Reply **confirm** to commit these follow-ups — the
         Radar queue and KPIs will update live."
     STOP. Do not proceed until the RM's next message.

--- Phase 3 · Execute (on approval only) ---
  Trigger only when the RM approves ("confirm", "yes", "go", "do it", "ship
  it", "approved"). A revision request ("make the retention one warmer",
  "only Harbor") means → redraft/adjust the filter and go back to Phase 2
  (STOP again). On approval:
    A. Call commit_actions ONCE. Pass the same filter you discovered with (e.g.
       risk_band='High' for the whole drifting cohort, or home_branch='Harbor'
       if the RM scoped it) plus the retention_offer + cross_sell_offer text.
       The tool applies retention_offer to retention rows and cross_sell_offer
       to cross_sell rows automatically. If the RM asked for BOTH cohorts, you
       may leave nba_type null so both are committed in one call; if they
       scoped to one, set nba_type.
    B. Final summary — use the counts + totals from commit_actions' RETURNING,
       not your own memory. Report actioned_count, the retention/cross-sell
       split, at-risk value handled, cross-sell opportunity, and branches. If
       skipped_customer_ids is non-empty, mention it. Never claim a write that
       didn't happen.

════════════════════════════════════════════════════════════
TONE
════════════════════════════════════════════════════════════
The RM is on a call. Lead with the answer. No "Sure, I'll help!" preamble.
No questions-about-your-question unless genuinely ambiguous. Synthesize —
don't dump raw rows. Never expose PII beyond first name in customer-facing copy.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };
