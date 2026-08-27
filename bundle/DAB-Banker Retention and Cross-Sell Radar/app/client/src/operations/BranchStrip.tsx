/**
 * Segment/branch strip — horizontal bars per branch showing at-risk-customer
 * counts. Harbor / Bayview / Highland visibly tower (the concentration story
 * without a map library). Click a branch → adds a branch filter to the queue.
 * Reads /api/radar/by-branch, refetches on dataMutated.
 */
import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { fetchBranchBreakdown } from '@/lib/radar';
import { dataMutated } from '@/lib/events';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { BranchBucket } from '@/shared/types';

export function BranchStrip({
  branchFilter,
  onBranchFilter,
}: {
  branchFilter: string | null;
  onBranchFilter: (branch: string | null) => void;
}) {
  const [rows, setRows] = useState<BranchBucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    function reload() {
      fetchBranchBreakdown()
        .then((r) => {
          if (!cancelled) setRows(r);
        })
        .catch((e) => console.error('[branch-strip] load failed', e))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const withRisk = rows.filter((r) => r.at_risk_customers > 0);
  const max = Math.max(1, ...withRisk.map((r) => r.at_risk_customers));

  if (!loading && withRisk.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="size-4 text-[var(--accent)]" />
        <h2 className="text-sm font-semibold">Drifting accounts by branch</h2>
        <span className="text-xs text-muted-foreground">
          — where the runoff is concentrated
        </span>
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground py-2">Loading…</div>
      ) : (
        <div className="space-y-2">
          {withRisk.map((b) => (
            <BranchBar
              key={b.home_branch}
              row={b}
              max={max}
              selected={branchFilter === b.home_branch}
              onSelect={() =>
                onBranchFilter(branchFilter === b.home_branch ? null : b.home_branch)
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BranchBar({
  row,
  max,
  selected,
  onSelect,
}: {
  row: BranchBucket;
  max: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const pulse = usePulseOnChange(row.at_risk_customers);
  const pct = (row.at_risk_customers / max) * 100;
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-md ${pulse ? 'animate-pulse-row' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-24 shrink-0 text-sm ${
            selected ? 'font-semibold text-foreground' : 'text-foreground/80'
          }`}
        >
          {row.home_branch}
        </div>
        <div className="flex-1 h-6 rounded-md bg-muted relative overflow-hidden">
          <div
            className="h-full rounded-md transition-all"
            style={{
              width: `${pct}%`,
              background: selected
                ? 'var(--accent)'
                : 'color-mix(in oklch, var(--accent) 40%, var(--muted))',
            }}
          />
        </div>
        <div className="w-40 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {row.at_risk_customers.toLocaleString()} at-risk · $
          {Math.round(row.at_risk_value_usd).toLocaleString()}
        </div>
      </div>
    </button>
  );
}
