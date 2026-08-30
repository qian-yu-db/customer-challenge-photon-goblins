-- Migration: 002_add_memo_column
-- Project: meridian-bank
-- Branch: dev (tested) -> production (applied)
-- Applied: 2026-08-26
-- Author: q.yu@databricks.com
-- Description: Add auto-drafted memo column to rm_actions for agent decision narrative
--
-- Context: The retention agent drafts a markdown memo for each action capturing
-- the full reasoning chain (risk assessment, product match, what-if outcome).
-- This column stores the rendered memo so it persists with the action record
-- and can be exported via export_decision_chain().
--
-- Testing: Validated on dev branch first (branch isolation confirmed),
-- then promoted to production.

ALTER TABLE app.rm_actions ADD COLUMN memo TEXT;

COMMENT ON COLUMN app.rm_actions.memo IS
    'Auto-drafted markdown memo capturing agent reasoning chain for audit trail';
