import {
  text,
  timestamp,
  date,
  uuid,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  pgSchema,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Lakebase schema, under `app.*` — Meridian Retention & Cross-Sell Radar.
 *
 * Three groups:
 *   1. Chat state      (conversations, messages, feedback) — REUSE AS-IS.
 *   2. Delta mirror    (radar, balanceWeekly, transactions) — the OLTP-
 *                      friendly copies of the lakehouse gold/silver tables
 *                      that db/sync.ts pulls at boot.
 *   3. Write-surface   Domain JSONB on the primary `radar` row. `emails` +
 *                      `aiAuditTrail` are append-only logs the agent writes
 *                      through in one atomic UPDATE — powers the Activity
 *                      timeline without joins.
 *
 * Why Lakebase: transactional Postgres semantics next to the lakehouse,
 * with Unity Catalog governance. The RM's action queue + audit trail live
 * here; analytics still queries Delta.
 */
export const appSchema = pgSchema('app');

// ============================================================================
// Chat state
// ============================================================================

export const conversations = appSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: text('user_email').notNull(),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['default', 'demo_dock'] })
      .notNull()
      .default('default'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userEmail, t.updatedAt),
    index('conversations_kind_idx').on(t.userEmail, t.kind),
  ],
);

export const messages = appSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    traceId: text('trace_id'),
    thinking: jsonb('thinking').$type<ThinkingEntry[]>().notNull().default([]),
    error: text('error'),
    canceled: boolean('canceled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_convo_pos_uq').on(t.conversationId, t.position),
  ],
);

export const feedback = appSchema.table(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    value: text('value', { enum: ['up', 'down'] }).notNull(),
    rationale: text('rationale'),
    traceId: text('trace_id'),
    mlflowAssessmentId: text('mlflow_assessment_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('feedback_message_idx').on(t.messageId)],
);

// ============================================================================
// Delta mirror — the RM Radar (primary entity) + drawer time-series
// ============================================================================

/**
 * `radar` — one row per actionable customer, mirrored from gold_rm_radar.
 * The RM works this queue. The agent's commit_actions writes actionTaken,
 * offerSummary, flips status → 'actioned', and appends emails[] + aiAuditTrail[]
 * in one atomic UPDATE.
 */
export const radar = appSchema.table(
  'radar',
  {
    // customer_id — natural PK.
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    segment: text('segment'),
    homeBranch: text('home_branch'),
    branchRegion: text('branch_region'),
    rmName: text('rm_name'),
    tenureMonths: integer('tenure_months'),
    relationshipValueUsd: doublePrecision('relationship_value_usd'),
    productsHeld: integer('products_held'),
    productsList: text('products_list'),
    totalBalanceUsd: doublePrecision('total_balance_usd'),

    // Attrition signals (current snapshot).
    riskBand: text('risk_band', { enum: ['High', 'Medium', 'Low'] }),
    attritionRiskScore: doublePrecision('attrition_risk_score'),
    balanceRunoffPct: doublePrecision('balance_runoff_pct'),
    daysSinceLastPayroll: integer('days_since_last_payroll'),
    payrollInterrupted: boolean('payroll_interrupted'),

    // Next-best-action.
    nbaType: text('nba_type', { enum: ['retention', 'cross_sell', 'none'] })
      .notNull()
      .default('none'),
    nbaProduct: text('nba_product'),
    nbaReason: text('nba_reason'),
    crossSellOpportunityUsd: integer('cross_sell_opportunity_usd'),
    priority: integer('priority'),

    // Operational status the app flips.
    status: text('status', {
      enum: ['pending', 'actioned', 'dismissed'],
    })
      .notNull()
      .default('pending'),

    // Written by commit_actions (null until the RM confirms).
    actionTaken: text('action_taken'),
    offerSummary: text('offer_summary'),

    // Append-only correspondence + audit — powers the Activity timeline.
    //   EmailEntry: { at, direction, from?, to?, subject, body }
    emails: jsonb('emails').$type<EmailEntry[]>().notNull().default([]),
    //   AuditEntry: { at, by, action, notes?, tool? }
    aiAuditTrail: jsonb('ai_audit_trail')
      .$type<AuditEntry[]>()
      .notNull()
      .default([]),

    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('radar_status_idx').on(t.status, t.priority),
    index('radar_nba_idx').on(t.nbaType),
    index('radar_branch_idx').on(t.homeBranch),
    index('radar_risk_idx').on(t.riskBand),
  ],
);

/**
 * `balance_weekly` — weekly balance snapshot per customer, mirrored from
 * silver_balance_weekly. Powers the drawer's balance-runoff sparkline.
 * Synthetic key = customerId + weekStart.
 */
export const balanceWeekly = appSchema.table(
  'balance_weekly',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: text('customer_id').notNull(),
    weekStart: date('week_start').notNull(),
    balanceUsd: doublePrecision('balance_usd'),
    runoffPct: doublePrecision('runoff_pct'),
    payrollActive: boolean('payroll_active'),
    atRiskFlag: boolean('at_risk_flag'),
  },
  (t) => [
    uniqueIndex('balance_weekly_cust_week_uq').on(t.customerId, t.weekStart),
    index('balance_weekly_cust_idx').on(t.customerId, t.weekStart),
  ],
);

/**
 * `transactions` — recent payroll / direct-deposit transactions per customer,
 * mirrored from silver_transactions (filtered to payroll + direct_deposit).
 * Powers the drawer's payroll timeline.
 */
export const transactions = appSchema.table(
  'transactions',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').notNull(),
    txnDate: timestamp('txn_date', { withTimezone: true }),
    amountUsd: doublePrecision('amount_usd'),
    txnType: text('txn_type'),
    channel: text('channel'),
  },
  (t) => [index('transactions_cust_idx').on(t.customerId, t.txnDate)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type EmailEntry = {
  at: string;
  direction: 'outgoing' | 'incoming';
  from?: string;
  to?: string;
  subject: string;
  body: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'actioned' | 'dismissed' | 'email_sent' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
