/**
 * Actions tab — draft + confirm the NBA for this single customer, OR read the
 * offer the agent already committed. Confirm commits to Lakebase via
 * commit_actions (scoped to this customer_id) → row flips to Actioned, KPIs
 * refresh, drawer timeline grows. Dismiss flips status → dismissed.
 *
 * The heavy cohort-level flow runs through the chat dock (the agent). This tab
 * is the per-row equivalent: the RM can act on one customer directly. It calls
 * the same write path via the agent-free /api endpoints so the demo cascade
 * (dataMutated → KPIs tick) still fires.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, MailCheck } from 'lucide-react';
import { dismissRadar } from '@/lib/radar';
import { dockController } from '@/chat/dockController';
import type { RadarDetail } from '@/shared/types';

export function ActionsTab({
  detail,
  onMutated,
}: {
  detail: RadarDetail;
  onMutated: () => void;
}) {
  const [pending, setPending] = useState<'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [detail.id]);

  const isActioned = detail.status === 'actioned';
  const isRetention = detail.nbaType === 'retention';

  async function dismiss() {
    setPending('dismiss');
    setError(null);
    try {
      await dismissRadar(detail.id);
      onMutated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  function askAgentToDraft() {
    // Hand the single customer to the assistant to draft + confirm — the same
    // discover → draft → confirm chain, scoped to this one customer_id.
    const prompt = `Work customer ${detail.id} (${detail.customerName}). ${
      isRetention
        ? 'Draft a retention save-offer'
        : `Draft a cross-sell recommendation for ${detail.nbaProduct ?? 'the recommended product'}`
    } and show it to me before I confirm.`;
    dockController.openAndSend(prompt);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {isActioned ? (
        <div className="rounded-xl border border-[var(--success-subtle)] bg-[var(--success-subtle)]/40 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--success-subtle-foreground)]">
            <MailCheck className="size-4" /> Action committed
          </div>
          <div className="mt-2 text-sm text-foreground">{detail.actionTaken}</div>
          {detail.offerSummary && (
            <div className="mt-1 text-xs text-muted-foreground">{detail.offerSummary}</div>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1">
              Recommended action
            </div>
            <div className="text-base font-medium text-foreground">
              {isRetention
                ? 'Retention save-offer'
                : `Cross-sell: ${detail.nbaProduct ?? '—'}`}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {detail.nbaReason ?? '—'}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={askAgentToDraft}
              className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <CheckCircle2 className="size-4" />
              Draft with the assistant
            </button>
            <button
              onClick={dismiss}
              disabled={pending === 'dismiss'}
              className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-colors disabled:opacity-50"
            >
              <XCircle className="size-4" />
              {pending === 'dismiss' ? '…' : 'Dismiss (not now)'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            The assistant drafts the offer and stops for your confirmation before
            it commits — a hard human-in-the-loop step. On confirm, the queue and
            KPI cards update live.
          </p>
        </>
      )}

      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
