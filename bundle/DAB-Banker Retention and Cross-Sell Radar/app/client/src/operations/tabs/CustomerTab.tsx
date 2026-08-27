/**
 * 360 tab — the money shot. A balance-runoff sparkline (weekly balances,
 * last 26 weeks), a payroll timeline flagging the last payroll credit +
 * days-since, a signals grid, and the NBA panel with nba_reason as the
 * headline (why-this-recommendation).
 */
import { Lightbulb, AlertTriangle } from 'lucide-react';
import type { RadarDetail, BalancePoint, PayrollTxn } from '@/shared/types';
import { NbaBadge } from '@/shared/badges';

export function CustomerTab({ detail }: { detail: RadarDetail }) {
  return (
    <div className="space-y-6 max-w-2xl">
      {/* Balance runoff sparkline */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Balance runoff · last 26 weeks
          </div>
          {detail.balanceRunoffPct !== null && (
            <div
              className={`text-sm font-semibold ${
                detail.balanceRunoffPct >= 0.5 ? 'text-[var(--accent)]' : 'text-foreground'
              }`}
            >
              {(detail.balanceRunoffPct * 100).toFixed(0)}% off peak
            </div>
          )}
        </div>
        <Sparkline series={detail.balanceSeries} />
      </div>

      {/* Payroll timeline */}
      <PayrollTimeline txns={detail.payrollTimeline} daysSince={detail.daysSinceLastPayroll} interrupted={detail.payrollInterrupted} />

      {/* Signals grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Signal label="Risk score" value={detail.attritionRiskScore !== null ? (detail.attritionRiskScore * 100).toFixed(0) + '%' : '—'} />
        <Signal label="Runoff" value={detail.balanceRunoffPct !== null ? (detail.balanceRunoffPct * 100).toFixed(0) + '%' : '—'} />
        <Signal label="Days since payroll" value={detail.daysSinceLastPayroll !== null ? String(detail.daysSinceLastPayroll) : '—'} />
        <Signal label="Products held" value={detail.productsHeld !== null ? String(detail.productsHeld) : '—'} hint={detail.productsList ?? undefined} />
        <Signal label="Tenure" value={detail.tenureMonths !== null ? `${detail.tenureMonths} mo` : '—'} />
        <Signal label="Relationship $" value={detail.relationshipValueUsd !== null ? '$' + Math.round(detail.relationshipValueUsd).toLocaleString() : '—'} />
      </div>

      {/* NBA panel */}
      {detail.nbaType !== 'none' && (
        <div
          className="rounded-xl border p-4"
          style={{
            borderColor: detail.nbaType === 'retention' ? 'var(--accent)' : 'var(--primary)',
            background:
              detail.nbaType === 'retention'
                ? 'color-mix(in oklch, var(--accent) 6%, var(--card))'
                : 'color-mix(in oklch, var(--primary) 5%, var(--card))',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="size-4 text-[var(--accent)]" />
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Next best action
            </span>
            <NbaBadge type={detail.nbaType} product={detail.nbaProduct} />
          </div>
          <div className="text-base font-medium text-foreground leading-snug">
            {detail.nbaReason ?? '—'}
          </div>
          {detail.nbaType === 'cross_sell' && detail.crossSellOpportunityUsd && (
            <div className="mt-2 text-sm text-muted-foreground">
              Annual opportunity:{' '}
              <span className="font-semibold text-foreground">
                ${detail.crossSellOpportunityUsd.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Signal({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

/** Inline SVG sparkline of weekly balances. At-risk weeks get an orange dot. */
function Sparkline({ series }: { series: BalancePoint[] }) {
  if (!series || series.length === 0) {
    return <div className="text-sm text-muted-foreground">No balance history.</div>;
  }
  const W = 560;
  const H = 90;
  const pad = 4;
  const vals = series.map((s) => s.balance_usd ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals, min + 1);
  const n = series.length;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / (max - min)) * (H - 2 * pad);
  const path = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s.balance_usd ?? 0).toFixed(1)}`)
    .join(' ');
  const area = `${path} L ${x(n - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
      <path d={area} fill="color-mix(in oklch, var(--accent) 12%, transparent)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {series.map((s, i) =>
        s.at_risk_flag ? (
          <circle key={i} cx={x(i)} cy={y(s.balance_usd ?? 0)} r={2.4} fill="var(--accent)" />
        ) : null,
      )}
    </svg>
  );
}

function PayrollTimeline({
  txns,
  daysSince,
  interrupted,
}: {
  txns: PayrollTxn[];
  daysSince: number | null;
  interrupted: boolean | null;
}) {
  const last = txns[0];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Payroll / direct deposit
        </div>
        {interrupted && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]">
            <AlertTriangle className="size-3.5" /> Interrupted
          </span>
        )}
      </div>
      <div className="text-sm text-foreground">
        {last?.txn_date ? (
          <>
            Last credit{' '}
            <span className="font-medium">
              {new Date(last.txn_date).toLocaleDateString()}
            </span>{' '}
            {last.amount_usd !== null && (
              <span className="text-muted-foreground">
                (${Math.round(last.amount_usd).toLocaleString()})
              </span>
            )}
            {daysSince !== null && daysSince < 900 && (
              <span className="text-muted-foreground"> · {daysSince} days ago</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">No payroll credits on record.</span>
        )}
      </div>
      {txns.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {txns.slice(0, 12).map((t) => (
            <li
              key={t.id}
              className="text-[10px] font-mono rounded px-1.5 py-0.5 bg-muted text-muted-foreground"
              title={`${t.txn_type} · ${t.amount_usd !== null ? '$' + Math.round(t.amount_usd) : ''}`}
            >
              {t.txn_date ? new Date(t.txn_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
