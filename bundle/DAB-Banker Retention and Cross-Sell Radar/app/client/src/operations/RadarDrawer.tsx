/**
 * Customer-360 drawer (right slide-over). Opens when the RM clicks a Radar
 * row. Three tabs: 360 (runoff sparkline + payroll timeline + signals + NBA),
 * Actions (draft/confirm), Activity (merged email + audit timeline).
 * Auto-refreshes on dataMutated.
 */
import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@databricks/appkit-ui/react';
import { fetchRadarDetail } from '@/lib/radar';
import { dataMutated } from '@/lib/events';
import { RiskBadge, SegmentBadge } from '@/shared/badges';
import type { RadarDetail } from '@/shared/types';

import { CustomerTab } from './tabs/CustomerTab';
import { ActionsTab } from './tabs/ActionsTab';
import { ActivityTab } from './tabs/ActivityTab';

type Props = {
  id: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
};

export function RadarDrawer({ id, open, onOpenChange, onMutated }: Props) {
  const [detail, setDetail] = useState<RadarDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchRadarDetail(id)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    const unsub = dataMutated.subscribe(() => {
      if (id) void fetchRadarDetail(id).then(setDetail).catch(() => {});
    });
    return unsub;
  }, [id]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full sm:!w-[60vw] sm:!max-w-[60vw] lg:!w-[680px] lg:!max-w-[680px] p-0 flex flex-col"
      >
        {!detail && loading && <div className="p-8 text-muted-foreground">Loading…</div>}
        {error && <div className="p-8 text-destructive">{error}</div>}
        {detail && (
          <>
            <SheetHeader className="px-8 pt-8 pb-4 border-b border-border">
              <div className="flex items-center gap-3 flex-wrap">
                <RiskBadge band={detail.riskBand} />
                <SegmentBadge segment={detail.segment} />
                <span className="text-xs text-muted-foreground">
                  {detail.homeBranch ?? '—'} · {detail.branchRegion ?? ''}
                </span>
              </div>
              <SheetTitle className="display text-2xl">{detail.customerName}</SheetTitle>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">{detail.email ?? ''}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">RM {detail.rmName ?? '—'}</span>
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="c360" className="flex-1 flex flex-col min-h-0">
              <TabsList className="mx-8 mt-4 w-fit">
                <TabsTrigger value="c360">360</TabsTrigger>
                <TabsTrigger value="actions">Actions</TabsTrigger>
                <TabsTrigger value="activity">
                  <Activity className="size-3.5 mr-1" />
                  Activity{' '}
                  {detail.emails.length + detail.aiAuditTrail.length > 0 &&
                    `(${detail.emails.length + detail.aiAuditTrail.length})`}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="c360" className="flex-1 overflow-y-auto px-8 py-6">
                <CustomerTab detail={detail} />
              </TabsContent>
              <TabsContent value="actions" className="flex-1 overflow-y-auto px-8 py-6">
                <ActionsTab detail={detail} onMutated={onMutated} />
              </TabsContent>
              <TabsContent value="activity" className="flex-1 overflow-y-auto px-8 py-6">
                <ActivityTab detail={detail} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
