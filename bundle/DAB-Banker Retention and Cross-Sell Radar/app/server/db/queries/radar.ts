import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import type { AuditEntry, EmailEntry } from '../schema.js';

/**
 * Domain queries for the Retention & Cross-Sell Radar.
 *
 * The primary entity is `app.radar` (mirror of gold_rm_radar) — one row per
 * actionable customer. The agent's commit_actions writes actionTaken /
 * offerSummary, flips status → 'actioned', and appends emails[] + aiAuditTrail[]
 * in one atomic UPDATE (see commitActions below).
 */

export type NbaType = 'retention' | 'cross_sell' | 'none';
export type RiskBand = 'High' | 'Medium' | 'Low';
export type RadarStatus = 'pending' | 'actioned' | 'dismissed';

export type { AuditEntry, EmailEntry };

export type RadarRow = {
  id: string;
  firstName: string;
  lastName: string;
  customerName: string;
  email: string | null;
  segment: string | null;
  homeBranch: string | null;
  branchRegion: string | null;
  rmName: string | null;
  tenureMonths: number | null;
  relationshipValueUsd: number | null;
  productsHeld: number | null;
  productsList: string | null;
  totalBalanceUsd: number | null;
  riskBand: RiskBand | null;
  attritionRiskScore: number | null;
  balanceRunoffPct: number | null;
  daysSinceLastPayroll: number | null;
  payrollInterrupted: boolean | null;
  nbaType: NbaType;
  nbaProduct: string | null;
  nbaReason: string | null;
  crossSellOpportunityUsd: number | null;
  priority: number | null;
  status: RadarStatus;
  actionTaken: string | null;
  offerSummary: string | null;
};

type RawRadarRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  segment: string | null;
  home_branch: string | null;
  branch_region: string | null;
  rm_name: string | null;
  tenure_months: number | null;
  relationship_value_usd: number | string | null;
  products_held: number | null;
  products_list: string | null;
  total_balance_usd: number | string | null;
  risk_band: string | null;
  attrition_risk_score: number | string | null;
  balance_runoff_pct: number | string | null;
  days_since_last_payroll: number | null;
  payroll_interrupted: boolean | null;
  nba_type: string;
  nba_product: string | null;
  nba_reason: string | null;
  cross_sell_opportunity_usd: number | null;
  priority: number | null;
  status: string;
  action_taken: string | null;
  offer_summary: string | null;
};

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

function toRow(r: RawRadarRow): RadarRow {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    customerName: `${r.first_name} ${r.last_name}`.trim(),
    email: r.email,
    segment: r.segment,
    homeBranch: r.home_branch,
    branchRegion: r.branch_region,
    rmName: r.rm_name,
    tenureMonths: r.tenure_months,
    relationshipValueUsd: num(r.relationship_value_usd),
    productsHeld: r.products_held,
    productsList: r.products_list,
    totalBalanceUsd: num(r.total_balance_usd),
    riskBand:
      r.risk_band === 'High' || r.risk_band === 'Medium' || r.risk_band === 'Low'
        ? r.risk_band
        : null,
    attritionRiskScore: num(r.attrition_risk_score),
    balanceRunoffPct: num(r.balance_runoff_pct),
    daysSinceLastPayroll: r.days_since_last_payroll,
    payrollInterrupted: r.payroll_interrupted,
    nbaType:
      r.nba_type === 'retention' || r.nba_type === 'cross_sell'
        ? r.nba_type
        : 'none',
    nbaProduct: r.nba_product,
    nbaReason: r.nba_reason,
    crossSellOpportunityUsd: r.cross_sell_opportunity_usd,
    priority: r.priority,
    status:
      r.status === 'actioned' || r.status === 'dismissed'
        ? r.status
        : 'pending',
    actionTaken: r.action_taken,
    offerSummary: r.offer_summary,
  };
}

const SELECT_COLS = sql`
  r.id, r.first_name, r.last_name, r.email, r.segment, r.home_branch,
  r.branch_region, r.rm_name, r.tenure_months, r.relationship_value_usd,
  r.products_held, r.products_list, r.total_balance_usd, r.risk_band,
  r.attrition_risk_score, r.balance_runoff_pct, r.days_since_last_payroll,
  r.payroll_interrupted, r.nba_type, r.nba_product, r.nba_reason,
  r.cross_sell_opportunity_usd, r.priority, r.status, r.action_taken,
  r.offer_summary`;

export async function listRadar(
  db: AppDb,
  opts: {
    status?: RadarStatus;
    nbaType?: 'retention' | 'cross_sell';
    riskBand?: RiskBand;
    segment?: string;
    branch?: string;
    customerId?: string;
    sort?: 'priority' | 'risk' | 'cross_sell';
    limit?: number;
  } = {},
): Promise<RadarRow[]> {
  const limit = opts.limit ?? 500;
  const whereStatus = opts.status ? sql`AND r.status = ${opts.status}` : sql``;
  const whereNba = opts.nbaType ? sql`AND r.nba_type = ${opts.nbaType}` : sql``;
  const whereRisk = opts.riskBand ? sql`AND r.risk_band = ${opts.riskBand}` : sql``;
  const whereSeg = opts.segment ? sql`AND r.segment = ${opts.segment}` : sql``;
  const whereBranch = opts.branch ? sql`AND r.home_branch = ${opts.branch}` : sql``;
  const whereCust = opts.customerId ? sql`AND r.id = ${opts.customerId}` : sql``;
  const orderBy =
    opts.sort === 'risk'
      ? sql`ORDER BY r.attrition_risk_score DESC NULLS LAST`
      : opts.sort === 'cross_sell'
        ? sql`ORDER BY r.cross_sell_opportunity_usd DESC NULLS LAST`
        : // default: priority (High-risk first, then cross-sell $)
          sql`ORDER BY r.priority ASC NULLS LAST, r.attrition_risk_score DESC NULLS LAST, r.cross_sell_opportunity_usd DESC NULLS LAST`;

  const result = await db.execute(sql`
    SELECT ${SELECT_COLS}
    FROM app.radar r
    WHERE 1=1 ${whereStatus} ${whereNba} ${whereRisk} ${whereSeg} ${whereBranch} ${whereCust}
    ${orderBy}
    LIMIT ${limit}
  `);
  return (result.rows as RawRadarRow[]).map(toRow);
}

export type RadarDetail = RadarRow & {
  decidedAt: string | null;
  emails: EmailEntry[];
  aiAuditTrail: AuditEntry[];
  balanceSeries: Array<{
    week_start: string;
    balance_usd: number | null;
    runoff_pct: number | null;
    payroll_active: boolean | null;
    at_risk_flag: boolean | null;
  }>;
  payrollTimeline: Array<{
    id: string;
    txn_date: string | null;
    amount_usd: number | null;
    txn_type: string | null;
    channel: string | null;
  }>;
};

export async function getRadarDetail(
  db: AppDb,
  id: string,
): Promise<RadarDetail | null> {
  const result = await db.execute(sql`
    SELECT ${SELECT_COLS}, r.decided_at, r.emails, r.ai_audit_trail
    FROM app.radar r
    WHERE r.id = ${id}
    LIMIT 1
  `);
  const row = result.rows[0] as
    | (RawRadarRow & {
        decided_at: string | null;
        emails: EmailEntry[];
        ai_audit_trail: AuditEntry[];
      })
    | undefined;
  if (!row) return null;

  const balRes = await db.execute(sql`
    SELECT week_start, balance_usd, runoff_pct, payroll_active, at_risk_flag
    FROM app.balance_weekly
    WHERE customer_id = ${id}
    ORDER BY week_start ASC
  `);
  const txnRes = await db.execute(sql`
    SELECT id, txn_date, amount_usd, txn_type, channel
    FROM app.transactions
    WHERE customer_id = ${id}
    ORDER BY txn_date DESC
    LIMIT 60
  `);

  return {
    ...toRow(row),
    decidedAt: row.decided_at,
    emails: row.emails ?? [],
    aiAuditTrail: row.ai_audit_trail ?? [],
    balanceSeries: (
      balRes.rows as Array<{
        week_start: string;
        balance_usd: number | string | null;
        runoff_pct: number | string | null;
        payroll_active: boolean | null;
        at_risk_flag: boolean | null;
      }>
    ).map((b) => ({
      week_start: b.week_start,
      balance_usd: num(b.balance_usd),
      runoff_pct: num(b.runoff_pct),
      payroll_active: b.payroll_active,
      at_risk_flag: b.at_risk_flag,
    })),
    payrollTimeline: (
      txnRes.rows as Array<{
        id: string;
        txn_date: string | null;
        amount_usd: number | string | null;
        txn_type: string | null;
        channel: string | null;
      }>
    ).map((t) => ({
      id: t.id,
      txn_date: t.txn_date,
      amount_usd: num(t.amount_usd),
      txn_type: t.txn_type,
      channel: t.channel,
    })),
  };
}

/** KPI summary for the Radar page — at-risk value, at-risk customers,
 *  cross-sell opportunity, split by status. */
export type RadarSummary = {
  atRiskValueUsd: number;
  atRiskCustomers: number;
  crossSellOpportunityUsd: number;
  pending: number;
  actioned: number;
  total: number;
};

export async function radarSummary(db: AppDb): Promise<RadarSummary> {
  const res = await db.execute(sql`
    SELECT
      COALESCE(SUM(relationship_value_usd) FILTER (WHERE nba_type = 'retention'), 0)::text AS at_risk_value,
      COUNT(*) FILTER (WHERE nba_type = 'retention')::int AS at_risk_customers,
      COALESCE(SUM(cross_sell_opportunity_usd) FILTER (WHERE nba_type = 'cross_sell'), 0)::text AS cross_sell_opp,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'actioned')::int AS actioned,
      COUNT(*)::int AS total
    FROM app.radar
  `);
  const r = (res.rows[0] ?? {}) as {
    at_risk_value: string;
    at_risk_customers: number;
    cross_sell_opp: string;
    pending: number;
    actioned: number;
    total: number;
  };
  return {
    atRiskValueUsd: Number(r.at_risk_value ?? 0),
    atRiskCustomers: r.at_risk_customers ?? 0,
    crossSellOpportunityUsd: Number(r.cross_sell_opp ?? 0),
    pending: r.pending ?? 0,
    actioned: r.actioned ?? 0,
    total: r.total ?? 0,
  };
}

/** Per-branch at-risk breakdown — powers the segment/branch strip. */
export type BranchBucket = {
  home_branch: string;
  at_risk_customers: number;
  at_risk_value_usd: number;
  high_risk: number;
  total: number;
};

export async function branchBreakdown(
  db: AppDb,
  opts: { status?: RadarStatus; nbaType?: 'retention' | 'cross_sell' } = {},
): Promise<BranchBucket[]> {
  const whereStatus = opts.status ? sql`AND status = ${opts.status}` : sql``;
  const whereNba = opts.nbaType ? sql`AND nba_type = ${opts.nbaType}` : sql``;
  const res = await db.execute(sql`
    SELECT
      COALESCE(home_branch, 'Unknown') AS home_branch,
      COUNT(*) FILTER (WHERE nba_type = 'retention')::int AS at_risk_customers,
      COALESCE(SUM(relationship_value_usd) FILTER (WHERE nba_type = 'retention'), 0)::text AS at_risk_value_usd,
      COUNT(*) FILTER (WHERE risk_band = 'High')::int AS high_risk,
      COUNT(*)::int AS total
    FROM app.radar
    WHERE 1=1 ${whereStatus} ${whereNba}
    GROUP BY COALESCE(home_branch, 'Unknown')
    ORDER BY at_risk_customers DESC, total DESC
  `);
  return (
    res.rows as Array<{
      home_branch: string;
      at_risk_customers: number;
      at_risk_value_usd: string;
      high_risk: number;
      total: number;
    }>
  ).map((r) => ({
    home_branch: r.home_branch,
    at_risk_customers: r.at_risk_customers,
    at_risk_value_usd: Number(r.at_risk_value_usd),
    high_risk: r.high_risk,
    total: r.total,
  }));
}

/**
 * Operator-driven single-customer dismiss (the "not now" action). Appends one
 * audit entry and flips status → dismissed.
 */
export async function dismissRadarRow(
  db: AppDb,
  args: { id: string; userEmail: string; notes?: string },
): Promise<RadarDetail | null> {
  const auditEntry: AuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: 'dismissed',
    notes: args.notes,
  };
  await db.execute(sql`
    UPDATE app.radar
    SET status = 'dismissed',
        decided_at = now(),
        updated_at = now(),
        ai_audit_trail = ai_audit_trail || ${JSON.stringify([auditEntry])}::jsonb
    WHERE id = ${args.id}
  `);
  return getRadarDetail(db, args.id);
}

// ============================================================================
// Recent activity — merged emails[] + aiAuditTrail[] across all radar rows.
// ============================================================================

export type ActivityEvent =
  | {
      kind: 'email';
      customer_id: string;
      at: string;
      direction: 'outgoing' | 'incoming';
      from: string | null;
      to: string | null;
      subject: string;
      body: string;
    }
  | {
      kind: 'audit';
      customer_id: string;
      at: string;
      by: string;
      action: string;
      notes: string | null;
      tool: string | null;
    };

export async function recentActivity(
  db: AppDb,
  limit = 20,
): Promise<ActivityEvent[]> {
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT
        'email' AS kind,
        r.id AS customer_id,
        (e->>'at') AS at,
        (e->>'direction') AS direction,
        (e->>'from') AS from_addr,
        (e->>'to') AS to_addr,
        (e->>'subject') AS subject,
        (e->>'body') AS body,
        NULL::text AS by_email,
        NULL::text AS action,
        NULL::text AS notes,
        NULL::text AS tool
      FROM app.radar r, jsonb_array_elements(r.emails) AS e
      UNION ALL
      SELECT
        'audit' AS kind,
        r.id AS customer_id,
        (a->>'at') AS at,
        NULL, NULL, NULL, NULL, NULL,
        (a->>'by') AS by_email,
        (a->>'action') AS action,
        (a->>'notes') AS notes,
        (a->>'tool') AS tool
      FROM app.radar r, jsonb_array_elements(r.ai_audit_trail) AS a
    ) sub
    ORDER BY at DESC NULLS LAST
    LIMIT ${limit}
  `);
  return (rows.rows as Array<Record<string, unknown>>).map((r) => {
    if (r.kind === 'email') {
      return {
        kind: 'email',
        customer_id: r.customer_id as string,
        at: r.at as string,
        direction: (r.direction as 'outgoing' | 'incoming') ?? 'outgoing',
        from: (r.from_addr as string | null) ?? null,
        to: (r.to_addr as string | null) ?? null,
        subject: (r.subject as string) ?? '',
        body: (r.body as string) ?? '',
      };
    }
    return {
      kind: 'audit',
      customer_id: r.customer_id as string,
      at: r.at as string,
      by: (r.by_email as string) ?? '',
      action: (r.action as string) ?? '',
      notes: (r.notes as string | null) ?? null,
      tool: (r.tool as string | null) ?? null,
    };
  });
}

// ============================================================================
// find_radar_customers — read-only discovery for the agent.
// ============================================================================

export type RadarDiscoveryRow = {
  customer_id: string;
  customer_name: string;
  segment: string | null;
  home_branch: string | null;
  rm_name: string | null;
  risk_band: RiskBand | null;
  attrition_risk_score: number | null;
  balance_runoff_pct: number | null;
  days_since_last_payroll: number | null;
  products_held: number | null;
  relationship_value_usd: number | null;
  nba_type: NbaType;
  nba_product: string | null;
  nba_reason: string | null;
  cross_sell_opportunity_usd: number | null;
  status: RadarStatus;
};

export async function findRadarCustomers(
  db: AppDb,
  opts: {
    riskBand?: RiskBand;
    segment?: string;
    branch?: string;
    nbaType?: 'retention' | 'cross_sell';
    customerId?: string;
    status?: RadarStatus;
    limit?: number;
  } = {},
): Promise<RadarDiscoveryRow[]> {
  const rows = await listRadar(db, {
    riskBand: opts.riskBand,
    segment: opts.segment,
    branch: opts.branch,
    nbaType: opts.nbaType,
    customerId: opts.customerId,
    status: opts.status,
    limit: opts.limit ?? 100,
    sort: 'priority',
  });
  return rows.map((r) => ({
    customer_id: r.id,
    customer_name: r.customerName,
    segment: r.segment,
    home_branch: r.homeBranch,
    rm_name: r.rmName,
    risk_band: r.riskBand,
    attrition_risk_score: r.attritionRiskScore,
    balance_runoff_pct: r.balanceRunoffPct,
    days_since_last_payroll: r.daysSinceLastPayroll,
    products_held: r.productsHeld,
    relationship_value_usd: r.relationshipValueUsd,
    nba_type: r.nbaType,
    nba_product: r.nbaProduct,
    nba_reason: r.nbaReason,
    cross_sell_opportunity_usd: r.crossSellOpportunityUsd,
    status: r.status,
  }));
}

// ============================================================================
// commit_actions — the WRITE tool. One atomic UPDATE over a FILTER (scalar):
// a single customer_id, or a risk_band / branch / segment / nba_type filter.
// Sets action_taken + offer_summary, flips status → actioned, appends an
// email + audit entry per row. Returns counts + totals from RETURNING.
// ============================================================================

export type CommitActionsFilter = {
  customerId?: string;
  riskBand?: RiskBand;
  branch?: string;
  segment?: string;
  nbaType?: 'retention' | 'cross_sell';
};

export type CommitActionsResult = {
  actioned_count: number;
  retention_count: number;
  cross_sell_count: number;
  at_risk_value_usd: number;
  cross_sell_opportunity_usd: number;
  branches: string[];
  skipped_customer_ids: string[];
};

/**
 * Filter-driven bulk write. The agent passes a SCALAR filter (never a list of
 * IDs) plus the offer text. We lock the matching PENDING rows, build a per-row
 * email + audit entry, then do ONE `UPDATE … FROM (VALUES …) … RETURNING`
 * re-asserting the same predicate. Counts derive from RETURNING, not intent.
 */
export async function commitActions(
  db: AppDb,
  args: {
    filter: CommitActionsFilter;
    retentionOffer: string;
    crossSellOffer: string;
    userEmail: string;
  },
): Promise<CommitActionsResult> {
  const f = args.filter;
  return db.transaction(async (tx) => {
    const whereCust = f.customerId ? sql`AND r.id = ${f.customerId}` : sql``;
    const whereRisk = f.riskBand ? sql`AND r.risk_band = ${f.riskBand}` : sql``;
    const whereBranch = f.branch ? sql`AND r.home_branch = ${f.branch}` : sql``;
    const whereSeg = f.segment ? sql`AND r.segment = ${f.segment}` : sql``;
    const whereNba = f.nbaType ? sql`AND r.nba_type = ${f.nbaType}` : sql``;

    const rowsRes = await tx.execute(sql`
      SELECT r.id, r.first_name, r.last_name, r.email, r.home_branch,
             r.nba_type, r.nba_product, r.nba_reason,
             r.relationship_value_usd, r.cross_sell_opportunity_usd
      FROM app.radar r
      WHERE r.status = 'pending'
        ${whereCust} ${whereRisk} ${whereBranch} ${whereSeg} ${whereNba}
      FOR UPDATE OF r
    `);
    const rows = rowsRes.rows as Array<{
      id: string;
      first_name: string;
      last_name: string;
      email: string | null;
      home_branch: string | null;
      nba_type: string;
      nba_product: string | null;
      nba_reason: string | null;
      relationship_value_usd: number | string | null;
      cross_sell_opportunity_usd: number | null;
    }>;

    if (rows.length === 0) {
      return {
        actioned_count: 0,
        retention_count: 0,
        cross_sell_count: 0,
        at_risk_value_usd: 0,
        cross_sell_opportunity_usd: 0,
        branches: [],
        skipped_customer_ids: [],
      };
    }

    const now = new Date().toISOString();
    const fromEmail = 'rm@meridianbank.example';
    const valuesParts: ReturnType<typeof sql>[] = [];
    type Meta = {
      nba: 'retention' | 'cross_sell' | 'none';
      value: number;
      opp: number;
      branch: string | null;
    };
    const metaById = new Map<string, Meta>();
    const skipped: string[] = [];

    for (const row of rows) {
      const isRetention = row.nba_type === 'retention';
      const offerText = isRetention ? args.retentionOffer : args.crossSellOffer;
      const firstName = row.first_name || 'there';
      const product = row.nba_product ?? 'a next-best-action offer';

      const actionTaken = isRetention
        ? `Retention save-offer — ${offerText}`
        : `Cross-sell — ${product}: ${offerText}`;
      const offerSummary = isRetention
        ? `Retention: ${offerText}`
        : `Cross-sell ${product}: ${offerText}`;

      const subject = isRetention
        ? `We'd like to make things right, ${firstName}`
        : `A Meridian ${product} recommendation for you, ${firstName}`;
      const body = isRetention
        ? `Hi ${firstName},\n\nWe noticed some recent changes on your accounts and want to make sure Meridian is still working hard for you. ${offerText}\n\nYour relationship manager will follow up personally. ${row.nba_reason ?? ''}\n\n— Your Meridian relationship team`
        : `Hi ${firstName},\n\nBased on how you bank with us, you're a great fit for our ${product}. ${offerText}\n\n${row.nba_reason ?? ''}\n\n— Your Meridian relationship team`;

      const emailEntry: EmailEntry = {
        at: now,
        direction: 'outgoing',
        from: fromEmail,
        to: row.email ?? '',
        subject,
        body,
      };
      const auditEntries: AuditEntry[] = [
        {
          at: now,
          by: args.userEmail,
          action: 'email_sent',
          notes: subject,
          tool: 'commit_actions',
        },
        {
          at: now,
          by: args.userEmail,
          action: 'actioned',
          notes: offerSummary,
          tool: 'commit_actions',
        },
      ];

      valuesParts.push(
        sql`(${row.id}, ${actionTaken}, ${offerSummary}, ${JSON.stringify([emailEntry])}::jsonb, ${JSON.stringify(auditEntries)}::jsonb)`,
      );
      metaById.set(row.id, {
        nba: isRetention ? 'retention' : row.nba_type === 'cross_sell' ? 'cross_sell' : 'none',
        value: Number(row.relationship_value_usd ?? 0),
        opp: Number(row.cross_sell_opportunity_usd ?? 0),
        branch: row.home_branch,
      });
    }

    const updRes = await tx.execute(sql`
      UPDATE app.radar AS r
      SET status = 'actioned',
          action_taken = v.action_taken,
          offer_summary = v.offer_summary,
          decided_at = now(),
          updated_at = now(),
          emails = r.emails || v.email_entry,
          ai_audit_trail = r.ai_audit_trail || v.audit_entries
      FROM (VALUES ${sql.join(valuesParts, sql`, `)}) AS v(id, action_taken, offer_summary, email_entry, audit_entries)
      WHERE r.id = v.id AND r.status = 'pending'
      RETURNING r.id
    `);
    const updatedIds = new Set(
      (updRes.rows as Array<{ id: string }>).map((r) => r.id),
    );

    let retention = 0;
    let crossSell = 0;
    let atRiskValue = 0;
    let crossSellOpp = 0;
    const branchSet = new Set<string>();
    for (const [id, meta] of metaById.entries()) {
      if (!updatedIds.has(id)) {
        skipped.push(id);
        continue;
      }
      if (meta.branch) branchSet.add(meta.branch);
      if (meta.nba === 'retention') {
        retention++;
        atRiskValue += meta.value;
      } else if (meta.nba === 'cross_sell') {
        crossSell++;
        crossSellOpp += meta.opp;
      }
    }

    return {
      actioned_count: updatedIds.size,
      retention_count: retention,
      cross_sell_count: crossSell,
      at_risk_value_usd: atRiskValue,
      cross_sell_opportunity_usd: crossSellOpp,
      branches: [...branchSet].sort(),
      skipped_customer_ids: skipped,
    };
  });
}
