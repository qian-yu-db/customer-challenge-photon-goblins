import { eq, inArray, sql, desc } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { schema } from '../index.js';
import type {
  CustomerPositionRow,
  OpenAtriskRow,
  NbaRecommendationRow,
  ProductRow,
  RmActionRow,
  RmAuditEntry,
  ActionType,
  ActivityEvent,
} from '../../../client/src/shared/types.js';

/**
 * Queries for the Meridian Bank Relationship Desk app.
 * Reads from Lakebase `app.*` tables via Drizzle ORM.
 */

export async function listAtRiskCustomers(
  db: AppDb,
): Promise<CustomerPositionRow[]> {
  const rows = await db
    .select()
    .from(schema.customerPosition)
    .where(inArray(schema.customerPosition.riskBand, ['critical', 'elevated', 'watch']))
    .orderBy(desc(schema.customerPosition.attritionRiskScore));
  return rows as unknown as CustomerPositionRow[];
}

export async function getCustomerPosition(
  db: AppDb,
  customerId: string,
): Promise<CustomerPositionRow | null> {
  const [row] = await db
    .select()
    .from(schema.customerPosition)
    .where(eq(schema.customerPosition.customerId, customerId))
    .limit(1);
  return (row as unknown as CustomerPositionRow) ?? null;
}

export async function getOpenAtrisk(
  db: AppDb,
  customerId: string,
): Promise<OpenAtriskRow | null> {
  const [row] = await db
    .select()
    .from(schema.openAtrisk)
    .where(eq(schema.openAtrisk.customerId, customerId))
    .limit(1);
  return (row as unknown as OpenAtriskRow) ?? null;
}

export async function getWorstOpenAtrisk(
  db: AppDb,
): Promise<OpenAtriskRow | null> {
  const [row] = await db
    .select()
    .from(schema.openAtrisk)
    .orderBy(desc(schema.openAtrisk.attritionRiskScore))
    .limit(1);
  return (row as unknown as OpenAtriskRow) ?? null;
}

export async function getNbaRecommendation(
  db: AppDb,
  customerId: string,
): Promise<NbaRecommendationRow | null> {
  const [row] = await db
    .select()
    .from(schema.nbaRecommendations)
    .where(eq(schema.nbaRecommendations.customerId, customerId))
    .limit(1);
  return (row as unknown as NbaRecommendationRow) ?? null;
}

export async function searchProducts(
  db: AppDb,
  query: string,
): Promise<ProductRow[]> {
  // Use Lakebase BM25 search via raw SQL (Drizzle doesn't have built-in BM25 support)
  const result = await db.execute(sql`
    SELECT product_id, product_name, product_type, segment, rate_apy, min_balance_usd, description
    FROM app.products
    WHERE search_vector <@> to_bm25query(to_tsvector('english', ${query}), 'app.products_search_bm25') < 0
    ORDER BY search_vector <@> to_bm25query(to_tsvector('english', ${query}), 'app.products_search_bm25')
    LIMIT 5
  `);
  return result.rows as unknown as ProductRow[];
}

export async function createRmAction(
  db: AppDb,
  action: {
    customerId: string;
    actionType: ActionType;
    offeredProductId?: string;
    rateApy?: number;
    draftedNote?: string;
    predictedRetainedUsd?: number;
    approvedBy?: string;
  },
): Promise<RmActionRow> {
  const auditEntry: RmAuditEntry = {
    action: 'created',
    by: action.approvedBy ?? 'system',
    at: new Date().toISOString(),
    detail: `Action ${action.actionType} drafted for ${action.customerId}`,
  };
  const [row] = await db
    .insert(schema.rmActions)
    .values({
      customerId: action.customerId,
      actionType: action.actionType,
      offeredProductId: action.offeredProductId ?? null,
      rateApy: action.rateApy ? String(action.rateApy) : null,
      draftedNote: action.draftedNote ?? null,
      predictedRetainedUsd: action.predictedRetainedUsd
        ? String(action.predictedRetainedUsd)
        : null,
      status: 'approved',
      approvedBy: action.approvedBy ?? null,
      auditTrail: [auditEntry],
      decidedAt: new Date(),
    })
    .returning();
  return row as unknown as RmActionRow;
}

export async function getRmAction(
  db: AppDb,
  actionId: string,
): Promise<RmActionRow | null> {
  const [row] = await db
    .select()
    .from(schema.rmActions)
    .where(eq(schema.rmActions.id, actionId))
    .limit(1);
  return (row as unknown as RmActionRow) ?? null;
}

export async function listRmActions(
  db: AppDb,
  customerId: string,
): Promise<RmActionRow[]> {
  const rows = await db
    .select()
    .from(schema.rmActions)
    .where(eq(schema.rmActions.customerId, customerId))
    .orderBy(desc(schema.rmActions.createdAt));
  return rows as unknown as RmActionRow[];
}

export async function updateRmActionStatus(
  db: AppDb,
  actionId: string,
  status: 'proposed' | 'approved' | 'executed' | 'overridden',
  auditEntry: RmAuditEntry,
): Promise<void> {
  await db
    .update(schema.rmActions)
    .set({
      status,
      decidedAt: new Date(),
      auditTrail: sql`COALESCE(audit_trail, '[]'::jsonb) || ${JSON.stringify(auditEntry)}::jsonb`,
    })
    .where(eq(schema.rmActions.id, actionId));
}

export async function getRiskMetrics(db: AppDb) {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(balance_at_risk_usd), 0) AS total_balance_at_risk,
      COALESCE(SUM(revenue_at_risk_usd), 0) AS total_revenue_at_risk,
      COUNT(*) AS at_risk_count,
      COUNT(*) FILTER (WHERE risk_band = 'critical') AS critical_count
    FROM app.customer_position
    WHERE risk_band IN ('critical', 'elevated', 'watch')
  `);
  const row = result.rows[0] as any;
  return {
    totalBalanceAtRisk: Number(row.total_balance_at_risk),
    totalRevenueAtRisk: Number(row.total_revenue_at_risk),
    atRiskCount: Number(row.at_risk_count),
    criticalCount: Number(row.critical_count),
  };
}

export async function recentActivity(db: AppDb, limit: number): Promise<ActivityEvent[]> {
  const rows = await db
    .select()
    .from(schema.rmActions)
    .orderBy(desc(schema.rmActions.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    actionType: r.actionType,
    status: r.status,
    createdAt: r.createdAt?.toISOString() ?? '',
    approvedBy: r.approvedBy,
  })) as unknown as ActivityEvent[];
}
