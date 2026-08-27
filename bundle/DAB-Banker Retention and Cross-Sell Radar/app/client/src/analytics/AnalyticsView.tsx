/**
 * Analytics — warehouse-backed charts for the Retention & Cross-Sell Radar.
 *
 * Each chart fetches `/api/charts/<key>` (server/routes/charts.ts), which reads
 * config/queries/<key>.sql and runs it against the SQL warehouse with the
 * demo's catalog/schema bound. Rows feed the chart components via `data`.
 *
 * Layout (per spec 02_ANALYTICS_DASHBOARD.md):
 *   - Weekly at-risk relationship value (line, full width)
 *   - At-risk customers by branch (bar) + cross-sell opportunity by product (table)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart, LineChart } from '@databricks/appkit-ui/react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { BRAND_PALETTE } from '@/lib/brand';
import { RtPitch } from '@/architecture/RtPitch';

function useChartData<T = Record<string, unknown>>(key: string): {
  data: T[] | null;
  error: string | null;
  isLoading: boolean;
} {
  const [state, setState] = useState<{
    data: T[] | null;
    error: string | null;
    isLoading: boolean;
  }>({ data: null, error: null, isLoading: true });

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, isLoading: true });
    fetch(`/api/charts/${key}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return body.data as T[];
      })
      .then((data) => alive && setState({ data, error: null, isLoading: false }))
      .catch(
        (e) =>
          alive && setState({ data: null, error: String(e?.message ?? e), isLoading: false }),
      );
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}

export function AnalyticsView() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Book analytics
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            Where the drift — and the opportunity — is.
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Live queries against the SQL warehouse — the same governed gold
            tables the assistant and the dashboard read. Spot the pattern here,
            act on it in the Radar.
          </p>
        </div>

        <RtPitch
          warehouse={
            warehouse?.name
              ? { name: warehouse.name, state: warehouse.state ?? null }
              : null
          }
          latencyMs={null}
        />

        <ChartCard title="Weekly at-risk relationship value" scope="26 weeks">
          <ChartData chartKey="weekly_at_risk_trend" height={280}>
            {(rows) => (
              <LineChart
                data={rows}
                xKey="week_start"
                yKey="at_risk_usd"
                colors={[BRAND_PALETTE[4]]}
                height={280}
                smooth
              />
            )}
          </ChartData>
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="At-risk customers by branch" scope="Harbor · Bayview · Highland lead">
            <ChartData chartKey="at_risk_by_branch" height={300}>
              {(rows) => (
                <BarChart
                  data={rows}
                  xKey="home_branch"
                  yKey="at_risk_customers"
                  colors={[BRAND_PALETTE[4]]}
                  height={300}
                />
              )}
            </ChartData>
          </ChartCard>

          <ChartCard title="Cross-sell opportunity by product" scope="By annual $" flush>
            <CrossSellTable />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  scope,
  flush,
  children,
}: {
  title: string;
  scope?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {scope && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {scope}
          </span>
        )}
      </div>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </div>
  );
}

function ChartData({
  chartKey,
  height,
  children,
}: {
  chartKey: string;
  height: number;
  children: (rows: Record<string, unknown>[]) => React.ReactNode;
}) {
  const { data, error, isLoading } = useChartData(chartKey);
  const center = `flex items-center justify-center text-sm`;
  if (error) {
    return (
      <div className={`${center} text-destructive`} style={{ height }}>
        Error loading chart: {error}
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        Loading…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        No data.
      </div>
    );
  }
  return <>{children(data)}</>;
}

type CrossSellRow = {
  nba_product: string;
  ready_customers: number;
  opportunity_usd: number;
};

function CrossSellTable() {
  const { data, error, isLoading } = useChartData<CrossSellRow>('cross_sell_by_product');
  const navigate = useNavigate();
  if (error)
    return <div className="px-4 py-6 text-sm text-destructive">Couldn't load: {error}</div>;
  if (isLoading || !data)
    return <div className="px-4 py-6 text-sm text-muted-foreground text-center">Loading…</div>;
  if (data.length === 0)
    return <div className="px-4 py-6 text-sm text-muted-foreground text-center">No data.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left font-medium px-3 py-2">Product</th>
            <th className="text-right font-medium px-3 py-2">Ready customers</th>
            <th className="text-right font-medium px-3 py-2">Opportunity $</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((r) => (
            <tr
              key={r.nba_product}
              className="hover:bg-muted/40 cursor-pointer"
              onClick={() => navigate('/operations?tab=cross_sell')}
            >
              <td className="px-3 py-2 font-medium">{r.nba_product}</td>
              <td className="px-3 py-2 text-right">{r.ready_customers.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">
                ${Number(r.opportunity_usd).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
