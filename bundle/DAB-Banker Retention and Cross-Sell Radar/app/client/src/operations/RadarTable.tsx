/**
 * The filterable Radar queue over gold_rm_radar (mirrored to Lakebase).
 * Status tabs + NBA-type chips + search + dismissible filter chips. Click a
 * row → opens the customer-360 drawer. Rows whose status changes between
 * dataMutated refetches pulse so the eye lands on what the agent just actioned.
 */
import { Search } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { RadarRow, RadarStatus, RiskBand } from '@/shared/types';
import { StatusBadge, NbaBadge, SegmentBadge } from '@/shared/badges';

const STATUS_TABS: { value: RadarStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'actioned', label: 'Actioned' },
];

const NBA_TABS: { value: 'all' | 'retention' | 'cross_sell'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'retention', label: 'Retention' },
  { value: 'cross_sell', label: 'Cross-Sell' },
];

type SortKey = 'priority' | 'risk' | 'cross_sell';

type Props = {
  rows: RadarRow[];
  loading: boolean;
  error: string | null;
  statusFilter: RadarStatus | 'all';
  onStatusFilter: (s: RadarStatus | 'all') => void;
  nbaFilter: 'all' | 'retention' | 'cross_sell';
  onNbaFilter: (n: 'all' | 'retention' | 'cross_sell') => void;
  search: string;
  onSearch: (s: string) => void;
  branchFilter: string | null;
  onBranchFilter: (b: string | null) => void;
  riskFilter: RiskBand | null;
  onRiskFilter: (r: RiskBand | null) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onSelect: (id: string) => void;
};

function SortHeader({
  label,
  active,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 ${
        align === 'right' ? 'flex-row-reverse' : ''
      } ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors cursor-pointer`}
    >
      {label}
      <span className="text-[10px]" aria-hidden>
        {active ? '↓' : '↕'}
      </span>
    </button>
  );
}

export function RadarTable(props: Props) {
  const {
    rows,
    loading,
    error,
    statusFilter,
    onStatusFilter,
    nbaFilter,
    onNbaFilter,
    search,
    onSearch,
    branchFilter,
    onBranchFilter,
    riskFilter,
    onRiskFilter,
    sort,
    onSortChange,
    onSelect,
  } = props;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pills
          tabs={STATUS_TABS}
          value={statusFilter}
          onChange={onStatusFilter}
          label="Status filter"
        />
        <Pills
          tabs={NBA_TABS}
          value={nbaFilter}
          onChange={onNbaFilter}
          label="NBA type filter"
        />
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm flex-1 sm:flex-initial min-w-[180px]">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, RM, branch…"
            className="bg-transparent outline-none w-full sm:w-56 placeholder:text-muted-foreground"
          />
        </div>
        {branchFilter && (
          <FilterChip label={`Branch: ${branchFilter}`} onClear={() => onBranchFilter(null)} />
        )}
        {riskFilter && (
          <FilterChip label={`Risk: ${riskFilter}`} onClear={() => onRiskFilter(null)} />
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="relative rounded-xl border border-border bg-card overflow-hidden">
        {loading && (
          <div className="absolute inset-x-0 top-0 h-0.5 z-10 overflow-hidden" aria-hidden>
            <div
              className="h-full w-1/3 rounded-full"
              style={{ background: 'var(--primary)', animation: 'loadingBar 1.1s ease-in-out infinite' }}
            />
          </div>
        )}
        <div
          className={`overflow-x-auto transition-opacity duration-150 ${
            loading && rows.length > 0 ? 'opacity-70' : 'opacity-100'
          }`}
        >
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Customer</th>
                <th className="text-left px-4 py-2 font-semibold">Branch</th>
                <th className="text-left px-4 py-2 font-semibold">RM</th>
                <th className="text-left px-4 py-2 font-semibold">
                  <SortHeader label="Risk" active={sort === 'risk'} onClick={() => onSortChange(sort === 'risk' ? 'priority' : 'risk')} />
                </th>
                <th className="text-left px-4 py-2 font-semibold">NBA</th>
                <th className="text-right px-4 py-2 font-semibold">Relationship $</th>
                <th className="text-right px-4 py-2 font-semibold">
                  <SortHeader label="Cross-Sell $" align="right" active={sort === 'cross_sell'} onClick={() => onSortChange(sort === 'cross_sell' ? 'priority' : 'cross_sell')} />
                </th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No customers match the current filters.
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <Row key={r.id} row={r} onSelect={onSelect} onBranchFilter={onBranchFilter} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Pills<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="relative inline-flex rounded-full border border-border bg-card p-0.5 text-sm"
    >
      {tabs.map((s) => {
        const active = value === s.value;
        return (
          <button
            key={s.value}
            onClick={() => onChange(s.value)}
            aria-pressed={active}
            className={`relative z-10 rounded-full px-3 py-1 transition-colors duration-200 ${
              active ? 'text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {active && <span className="absolute inset-0 rounded-full bg-foreground" aria-hidden />}
            <span className="relative">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      onClick={onClear}
      className="text-xs rounded-full px-2 py-1 bg-muted text-foreground"
    >
      {label} ✕
    </button>
  );
}

function RiskBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.min(100, Math.max(0, score * 100));
  // Blue (low) → orange (high) gradient by score.
  const color = score >= 0.6 ? 'var(--accent)' : score >= 0.3 ? '#C26A00' : 'var(--brand-2)';
  return (
    <div className="flex items-center gap-1.5" title={`Attrition risk ${(score * 100).toFixed(0)}%`}>
      <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-6 text-right">
        {(score * 100).toFixed(0)}
      </span>
    </div>
  );
}

function Row({
  row: r,
  onSelect,
  onBranchFilter,
}: {
  row: RadarRow;
  onSelect: (id: string) => void;
  onBranchFilter: (b: string | null) => void;
}) {
  const statusPulse = usePulseOnChange(r.status);
  return (
    <tr
      onClick={() => onSelect(r.id)}
      className={`cursor-pointer border-t border-border hover:bg-muted/50 transition-colors ${
        statusPulse ? 'animate-pulse-row' : ''
      }`}
    >
      <td className="px-4 py-2">
        <div className="font-medium">{r.customerName}</div>
        <div className="mt-0.5">
          <SegmentBadge segment={r.segment} />
        </div>
      </td>
      <td className="px-4 py-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBranchFilter(r.homeBranch);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          {r.homeBranch ?? '—'}
        </button>
      </td>
      <td className="px-4 py-2 text-muted-foreground">{r.rmName ?? '—'}</td>
      <td className="px-4 py-2">
        <RiskBar score={r.attritionRiskScore} />
      </td>
      <td className="px-4 py-2">
        <NbaBadge type={r.nbaType} product={r.nbaProduct} />
      </td>
      <td className="px-4 py-2 text-right font-mono">
        {r.relationshipValueUsd !== null
          ? '$' + Math.round(r.relationshipValueUsd).toLocaleString()
          : '—'}
      </td>
      <td className="px-4 py-2 text-right font-mono">
        {r.nbaType === 'cross_sell' && r.crossSellOpportunityUsd
          ? '$' + r.crossSellOpportunityUsd.toLocaleString()
          : '—'}
      </td>
      <td className="px-4 py-2">
        {r.status === 'actioned' && r.offerSummary ? (
          <div className="flex flex-col gap-0.5">
            <StatusBadge status={r.status} />
            <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">
              {r.offerSummary}
            </span>
          </div>
        ) : (
          <StatusBadge status={r.status} />
        )}
      </td>
    </tr>
  );
}
