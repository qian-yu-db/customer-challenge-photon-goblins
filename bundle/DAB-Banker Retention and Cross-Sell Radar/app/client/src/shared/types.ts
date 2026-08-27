/**
 * Types that cross the client/server boundary for the Retention &
 * Cross-Sell Radar. Keep in sync with server/db/queries/radar.ts +
 * server/db/queries/chat.ts.
 */

export type NbaType = 'retention' | 'cross_sell' | 'none';
export type RiskBand = 'High' | 'Medium' | 'Low';
export type RadarStatus = 'pending' | 'actioned' | 'dismissed';

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

export type BalancePoint = {
  week_start: string;
  balance_usd: number | null;
  runoff_pct: number | null;
  payroll_active: boolean | null;
  at_risk_flag: boolean | null;
};

export type PayrollTxn = {
  id: string;
  txn_date: string | null;
  amount_usd: number | null;
  txn_type: string | null;
  channel: string | null;
};

export type RadarDetail = RadarRow & {
  decidedAt: string | null;
  emails: EmailEntry[];
  aiAuditTrail: AuditEntry[];
  balanceSeries: BalancePoint[];
  payrollTimeline: PayrollTxn[];
};

export type RadarSummary = {
  atRiskValueUsd: number;
  atRiskCustomers: number;
  crossSellOpportunityUsd: number;
  pending: number;
  actioned: number;
  total: number;
};

export type BranchBucket = {
  home_branch: string;
  at_risk_customers: number;
  at_risk_value_usd: number;
  high_risk: number;
  total: number;
};

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
