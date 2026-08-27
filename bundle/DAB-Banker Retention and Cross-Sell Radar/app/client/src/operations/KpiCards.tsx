/**
 * Three KPI cards at the top of the Radar page: At-Risk Relationship Value,
 * At-Risk Customers, Cross-Sell Opportunity. The live-update moment — when
 * the agent commits actions, `dataMutated` fires, the page refetches, and
 * each card compares its value to the previous render and pulses if it moved.
 */
import { TrendingDown, Users, Sparkles } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { RadarSummary } from '@/shared/types';

export function KpiCards({ summary }: { summary: RadarSummary | null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
      <Card
        label="At-Risk Relationship Value"
        value={summary?.atRiskValueUsd ?? 0}
        money
        icon={<TrendingDown className="size-4" />}
        tone="danger"
      />
      <Card
        label="At-Risk Customers"
        value={summary?.atRiskCustomers ?? 0}
        icon={<Users className="size-4" />}
        tone="neutral"
      />
      <Card
        label="Cross-Sell Opportunity"
        value={summary?.crossSellOpportunityUsd ?? 0}
        money
        icon={<Sparkles className="size-4" />}
        tone="info"
      />
    </div>
  );
}

function Card({
  label,
  value,
  money,
  icon,
  tone,
}: {
  label: string;
  value: number;
  money?: boolean;
  icon: React.ReactNode;
  tone: 'neutral' | 'danger' | 'info';
}) {
  const pulse = usePulseOnChange(value);
  const toneClass =
    tone === 'danger'
      ? 'text-[var(--accent)]'
      : tone === 'info'
        ? 'text-primary'
        : 'text-foreground';
  const display = money
    ? '$' +
      value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : value.toLocaleString();
  return (
    <div
      className={`rounded-xl border border-border bg-card p-4 sm:p-5 transition-shadow ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 display text-2xl sm:text-3xl font-semibold text-foreground tabular-nums">
        {display}
      </div>
    </div>
  );
}
