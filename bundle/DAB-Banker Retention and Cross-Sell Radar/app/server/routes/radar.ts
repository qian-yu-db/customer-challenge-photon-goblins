import type { Application } from 'express';
import express from 'express';
import {
  listRadar,
  getRadarDetail,
  radarSummary,
  branchBreakdown,
  dismissRadarRow,
} from '../db/queries/index.js';
import type { RadarStatus, RiskBand } from '../db/queries/radar.js';
import { getCurrentUserEmail } from '../lib/user.js';
import type { AppDb } from '../db/index.js';

/**
 * OLTP business routes for the RM Radar — the actionable customer queue,
 * per-customer 360 detail (with runoff series + payroll timeline), KPI
 * summary, per-branch breakdown, and the operator dismiss action.
 */

const VALID_STATUS = ['pending', 'actioned', 'dismissed'] as const;
const VALID_RISK = ['High', 'Medium', 'Low'] as const;

function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function parseStatus(v: unknown): RadarStatus | undefined {
  const s = strParam(v);
  return s && (VALID_STATUS as readonly string[]).includes(s)
    ? (s as RadarStatus)
    : undefined;
}
function parseRisk(v: unknown): RiskBand | undefined {
  const s = strParam(v);
  return s && (VALID_RISK as readonly string[]).includes(s)
    ? (s as RiskBand)
    : undefined;
}
function parseNba(v: unknown): 'retention' | 'cross_sell' | undefined {
  const s = strParam(v);
  return s === 'retention' || s === 'cross_sell' ? s : undefined;
}

export function registerRadarRoutes(
  app: Application,
  deps: { db: AppDb },
): void {
  const { db } = deps;

  // GET /api/radar — the actionable queue.
  app.get('/api/radar', async (req, res) => {
    const sort = strParam(req.query.sort);
    const rows = await listRadar(db, {
      status: parseStatus(req.query.status),
      nbaType: parseNba(req.query.nbaType),
      riskBand: parseRisk(req.query.riskBand),
      segment: strParam(req.query.segment),
      branch: strParam(req.query.branch),
      sort:
        sort === 'risk' || sort === 'cross_sell' || sort === 'priority'
          ? sort
          : undefined,
    });
    res.json(rows);
  });

  // GET /api/radar/summary — KPI cards.
  app.get('/api/radar/summary', async (_req, res) => {
    res.json(await radarSummary(db));
  });

  // GET /api/radar/by-branch — segment/branch strip.
  app.get('/api/radar/by-branch', async (req, res) => {
    res.json(
      await branchBreakdown(db, {
        status: parseStatus(req.query.status),
        nbaType: parseNba(req.query.nbaType),
      }),
    );
  });

  // GET /api/radar/:id — full 360 detail (runoff series + payroll timeline).
  app.get('/api/radar/:id', async (req, res) => {
    const row = await getRadarDetail(db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(row);
  });

  // POST /api/radar/:id/dismiss — operator "not now".
  app.post('/api/radar/:id/dismiss', express.json({ limit: '32kb' }), async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const rawNotes = req.body?.notes;
    const notes =
      typeof rawNotes === 'string' && rawNotes.length > 0
        ? rawNotes.slice(0, 4000)
        : undefined;
    const result = await dismissRadarRow(db, { id: req.params.id, userEmail, notes });
    if (!result) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(result);
  });
}
