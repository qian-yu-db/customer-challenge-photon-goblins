/**
 * Pill-style badges reused across the Radar page + home activity feed.
 */
import type { NbaType, RadarStatus, RiskBand } from './types';

export function StatusBadge({ status }: { status: RadarStatus }) {
  const styles: Record<RadarStatus, string> = {
    pending: 'bg-muted text-foreground',
    actioned: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
    dismissed: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export function RiskBadge({ band }: { band: RiskBand | null }) {
  if (!band) return null;
  const styles: Record<RiskBand, string> = {
    High: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
    Medium: 'bg-muted text-foreground',
    Low: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${styles[band]}`}
    >
      {band} risk
    </span>
  );
}

export function NbaBadge({ type, product }: { type: NbaType; product?: string | null }) {
  if (type === 'none') return null;
  const isRetention = type === 'retention';
  const cls = isRetention
    ? 'bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30'
    : 'bg-primary/10 text-primary border border-primary/25';
  const label = isRetention ? 'Retention' : 'Cross-Sell';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {label}
      {product && <span className="normal-case font-normal opacity-80">· {product}</span>}
    </span>
  );
}

export function SegmentBadge({ segment }: { segment: string | null }) {
  if (!segment) return null;
  const styles: Record<string, string> = {
    affluent: 'bg-[var(--tier-platinum)] text-[var(--tier-platinum-foreground)]',
    'small business': 'bg-[var(--tier-gold)] text-[var(--tier-gold-foreground)]',
    'mass market': 'bg-[var(--tier-silver)] text-[var(--tier-silver-foreground)]',
  };
  const cls = styles[segment.toLowerCase()] ?? 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${cls}`}
    >
      {segment}
    </span>
  );
}
