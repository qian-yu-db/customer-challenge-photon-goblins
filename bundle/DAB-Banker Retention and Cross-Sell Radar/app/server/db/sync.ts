import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { radar, balanceWeekly, transactions } from './schema.js';

/**
 * One-shot Delta → Lakebase sync for the Retention & Cross-Sell Radar.
 *
 * Delta is the source of truth; Lakebase is the OLTP mirror the RM works
 * against. Pulls three sets via the Databricks SQL Statements API:
 *   1. gold_rm_radar          → app.radar          (the actionable queue)
 *   2. silver_balance_weekly  → app.balance_weekly (drawer runoff sparkline)
 *   3. silver_transactions    → app.transactions   (drawer payroll timeline;
 *                               filtered to payroll / direct_deposit)
 *
 * balance_weekly + transactions are scoped to the radar customer set so the
 * mirror stays lean. Idempotent in the "only-if-destination-empty" sense.
 * `{ forceIfAnyEmpty: true }` re-syncs on demand (the "Reset demo" button).
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    /** gold_rm_radar — one row per actionable customer + NBA + signals. */
    radar: string;
    /** silver_balance_weekly — weekly customer balance snapshots. */
    balanceWeekly: string;
    /** silver_transactions — recent transactions (we filter to payroll). */
    transactions: string;
  };
};

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.radar`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }

  console.log('[sync] Starting Delta → Lakebase sync (parallel)…');
  const t0 = Date.now();

  const fq = (name: keyof DataConfig['tables']) =>
    `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;

  // Fire the three warehouse queries in parallel. balance_weekly + txns are
  // scoped to the radar customer set (a subquery over the radar table).
  const [radarRows, balanceRows, txnRows] = await Promise.all([
    execSql<{
      customer_id: string;
      first_name: string;
      last_name: string;
      email: string | null;
      segment: string | null;
      home_branch: string | null;
      branch_region: string | null;
      rm_name: string | null;
      tenure_months: number | null;
      relationship_value_usd: number | null;
      products_held: number | null;
      products_list: string | null;
      total_balance_usd: number | null;
      risk_band: string | null;
      attrition_risk_score: number | null;
      balance_runoff_pct: number | null;
      days_since_last_payroll: number | null;
      payroll_interrupted: boolean | null;
      nba_type: string | null;
      nba_product: string | null;
      nba_reason: string | null;
      cross_sell_opportunity_usd: number | null;
      priority: number | null;
      status: string | null;
    }>(
      warehouseId,
      `SELECT customer_id, first_name, last_name, email, segment, home_branch,
              branch_region, rm_name, tenure_months, relationship_value_usd,
              products_held, products_list, total_balance_usd, risk_band,
              attrition_risk_score, balance_runoff_pct, days_since_last_payroll,
              payroll_interrupted, nba_type, nba_product, nba_reason,
              cross_sell_opportunity_usd, priority, status
       FROM ${fq('radar')}
       WHERE nba_type IN ('retention','cross_sell')`,
    ),
    execSql<{
      customer_id: string;
      week_start: string;
      balance_usd: number | null;
      runoff_pct: number | null;
      payroll_active: boolean | null;
      weekly_at_risk_flag: boolean | null;
    }>(
      warehouseId,
      // Last 26 weeks, scoped to actionable customers only.
      `SELECT b.customer_id, b.week_start, b.balance_usd, b.runoff_pct,
              b.payroll_active, b.weekly_at_risk_flag
       FROM ${fq('balanceWeekly')} b
       WHERE b.customer_id IN (
         SELECT customer_id FROM ${fq('radar')}
         WHERE nba_type IN ('retention','cross_sell')
       )`,
    ),
    execSql<{
      transaction_id: string;
      customer_id: string;
      txn_date: string | null;
      amount_usd: number | null;
      txn_type: string | null;
      channel: string | null;
    }>(
      warehouseId,
      // Payroll / direct-deposit only, scoped to actionable customers.
      `SELECT t.transaction_id, t.customer_id, t.txn_date, t.amount_usd,
              t.txn_type, t.channel
       FROM ${fq('transactions')} t
       WHERE t.txn_type IN ('payroll','direct_deposit')
         AND t.customer_id IN (
           SELECT customer_id FROM ${fq('radar')}
           WHERE nba_type IN ('retention','cross_sell')
         )`,
    ),
  ]);
  console.log(`[sync]   queries done (${((Date.now() - t0) / 1000).toFixed(1)}s) — inserting…`);

  const asNBA = (v: string | null): 'retention' | 'cross_sell' | 'none' =>
    v === 'retention' || v === 'cross_sell' ? v : 'none';
  const asRiskBand = (v: string | null): 'High' | 'Medium' | 'Low' | null =>
    v === 'High' || v === 'Medium' || v === 'Low' ? v : null;

  if (radarRows.length) {
    // 24 cols/row → keep chunks well under the 65_535 bind-param ceiling.
    await chunkInsert(radarRows, 2_000, (chunk) =>
      db
        .insert(radar)
        .values(
          chunk.map((r) => ({
            id: r.customer_id,
            firstName: r.first_name,
            lastName: r.last_name,
            email: r.email,
            segment: r.segment,
            homeBranch: r.home_branch,
            branchRegion: r.branch_region,
            rmName: r.rm_name,
            tenureMonths: r.tenure_months === null ? null : Number(r.tenure_months),
            relationshipValueUsd:
              r.relationship_value_usd === null ? null : Number(r.relationship_value_usd),
            productsHeld: r.products_held === null ? null : Number(r.products_held),
            productsList: r.products_list,
            totalBalanceUsd:
              r.total_balance_usd === null ? null : Number(r.total_balance_usd),
            riskBand: asRiskBand(r.risk_band),
            attritionRiskScore:
              r.attrition_risk_score === null ? null : Number(r.attrition_risk_score),
            balanceRunoffPct:
              r.balance_runoff_pct === null ? null : Number(r.balance_runoff_pct),
            daysSinceLastPayroll:
              r.days_since_last_payroll === null ? null : Number(r.days_since_last_payroll),
            payrollInterrupted: r.payroll_interrupted,
            nbaType: asNBA(r.nba_type),
            nbaProduct: r.nba_product,
            nbaReason: r.nba_reason,
            crossSellOpportunityUsd:
              r.cross_sell_opportunity_usd === null
                ? null
                : Number(r.cross_sell_opportunity_usd),
            priority: r.priority === null ? null : Number(r.priority),
            status: 'pending' as const,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  console.log(`[sync]   radar: ${radarRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (balanceRows.length) {
    // 6 cols/row.
    await chunkInsert(balanceRows, 8_000, (chunk) =>
      db
        .insert(balanceWeekly)
        .values(
          chunk.map((r) => ({
            customerId: r.customer_id,
            weekStart: r.week_start,
            balanceUsd: r.balance_usd === null ? null : Number(r.balance_usd),
            runoffPct: r.runoff_pct === null ? null : Number(r.runoff_pct),
            payrollActive: r.payroll_active,
            atRiskFlag: r.weekly_at_risk_flag,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  console.log(`[sync]   balance_weekly: ${balanceRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (txnRows.length) {
    // 6 cols/row.
    await chunkInsert(txnRows, 8_000, (chunk) =>
      db
        .insert(transactions)
        .values(
          chunk.map((r) => ({
            id: r.transaction_id,
            customerId: r.customer_id,
            txnDate: r.txn_date ? new Date(r.txn_date) : null,
            amountUsd: r.amount_usd === null ? null : Number(r.amount_usd),
            txnType: r.txn_type,
            channel: r.channel,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  console.log(`[sync]   transactions: ${txnRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[sync] Done in ${dt}s`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.radar RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.balance_weekly RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.transactions RESTART IDENTITY CASCADE`);
  });
}

async function execSql<T>(
  warehouseId: string,
  statement: string,
): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: {
      schema: { columns: Array<{ name: string }> };
      chunks?: Array<{ chunk_index: number; row_count: number }>;
    };
    result?: {
      chunk_index: number;
      row_count: number;
      data_array?: Array<Array<unknown>>;
      next_chunk_index?: number;
    };
  };

  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: {
      statement,
      warehouse_id: warehouseId,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  const POLL_DEADLINE_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(
        `[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') {
    throw new Error(
      `[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`,
    );
  }

  const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const row of chunk.data_array ?? []) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      rows.push(obj as T);
    }
    if (chunk.next_chunk_index === undefined || chunk.next_chunk_index === null) break;
    chunk = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp['result'];
  }
  return rows;
}

async function chunkInsert<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}
