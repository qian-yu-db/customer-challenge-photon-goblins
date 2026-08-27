/**
 * The Radar page (/operations) — the RM's live customer 360 + next-best-action
 * queue. OLTP write surface: the RM works the actionable book, and the agent's
 * commit_actions writes land here in real time via the `dataMutated` pub/sub.
 *
 * Layout: header → "ask the assistant" banner → KPI cards → branch strip →
 * filterable Radar table → customer-360 drawer.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles, ArrowRight } from 'lucide-react';
import { fetchRadar, fetchRadarSummary } from '@/lib/radar';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type { RadarRow, RadarStatus, RadarSummary, RiskBand } from '@/shared/types';

import { KpiCards } from './KpiCards';
import { BranchStrip } from './BranchStrip';
import { RadarTable } from './RadarTable';
import { RadarDrawer } from './RadarDrawer';

export function OperationsView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState<RadarStatus | 'all'>('pending');
  const [nba, setNba] = useState<'all' | 'retention' | 'cross_sell'>('all');
  const [branch, setBranch] = useState<string | null>(searchParams.get('branch'));
  const [risk, setRisk] = useState<RiskBand | null>(
    (searchParams.get('riskBand') as RiskBand | null) ?? null,
  );
  const [sort, setSort] = useState<'priority' | 'risk' | 'cross_sell'>('priority');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState<RadarRow[]>([]);
  const [summary, setSummary] = useState<RadarSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useSession();

  // Sync branch/risk → URL for deep-links from Analytics / dashboard drill-down.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (k: string, v: string | null) => {
      if (v) next.set(k, v);
      else next.delete(k);
    };
    setOrDelete('branch', branch);
    setOrDelete('riskBand', risk);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, risk]);

  useEffect(() => {
    const urlBranch = searchParams.get('branch');
    if (urlBranch !== branch) setBranch(urlBranch);
    const urlRisk = (searchParams.get('riskBand') as RiskBand | null) ?? null;
    if (urlRisk !== risk) setRisk(urlRisk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function reload() {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        fetchRadar({
          status: status === 'all' ? undefined : status,
          nbaType: nba === 'all' ? undefined : nba,
          riskBand: risk ?? undefined,
          branch: branch ?? undefined,
          sort,
        }),
        fetchRadarSummary(),
      ]);
      setRows(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, nba, risk, branch, sort]);

  useEffect(() => {
    return dataMutated.subscribe(() => void reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, nba, risk, branch, sort]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.customerName.toLowerCase().includes(q) ||
        (r.rmName ?? '').toLowerCase().includes(q) ||
        (r.homeBranch ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Retention & Cross-Sell Radar
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            Work the book — live.
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Every drifting account and every ready-for-an-offer customer, in one
            place. No overnight extract.
          </p>
        </div>

        {config?.assistantScript?.[0] && (
          <button
            onClick={() => dockController.openAndSend(config.assistantScript[0].prompt)}
            className="w-full text-left rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-5 py-4 transition-all flex items-center gap-4 group"
          >
            <div
              className="size-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              <Sparkles className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                A cohort just went quiet
              </div>
              <div className="text-sm font-medium text-foreground mt-0.5">
                Ask the assistant which accounts are drifting
              </div>
            </div>
            <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </button>
        )}

        <KpiCards summary={summary} />

        <BranchStrip branchFilter={branch} onBranchFilter={setBranch} />

        <RadarTable
          rows={filteredRows}
          loading={loading}
          error={error}
          statusFilter={status}
          onStatusFilter={setStatus}
          nbaFilter={nba}
          onNbaFilter={setNba}
          search={search}
          onSearch={setSearch}
          branchFilter={branch}
          onBranchFilter={setBranch}
          riskFilter={risk}
          onRiskFilter={setRisk}
          sort={sort}
          onSortChange={setSort}
          onSelect={setSelectedId}
        />
      </div>

      <RadarDrawer
        id={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onMutated={() => void 0}
      />
    </div>
  );
}
