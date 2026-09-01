/**
 * Call Blitz Report — pure metrics fold (no I/O). Mirrors lib/sync/calling.ts's shape: a pure
 * builder over pre-loaded Activity[], using ONLY the shared disposition predicates from
 * config/dispositions.ts so this can never drift from the dashboard's own numbers.
 *
 * Column mapping (confirmed with the user — do not change without re-confirming):
 *   Calls / Emails      — raw activity counts for the window.
 *   Total Touches       — calls + emails (verbatim formula from lib/sync/temperature.ts).
 *   Connected Call      — isConnected(disposition) (a human was reached; includes rejections).
 *   High Intent         — CALLBACK_HIGH_GUID only (narrower than isHighIntent(), which also
 *                          folds in meetings — a direct check avoids double-counting Meeting).
 *   Low Intent          — CALLBACK_LOW_GUID only.
 *   Not Interested       — NOT_INTERESTED_GUID only (not "C - Not a Right POC").
 *   Referral             — GAVE_REFERRAL_GUID.
 *   Meeting              — MEETING_SCHEDULED_GUID or MEETING_RESCHEDULED_GUID (call-outcome
 *                          driven; deliberately distinct from the deal-stage Demos column).
 *   Demos                — NOT derived here. Deal-stage driven (demoScheduledMs over the deal's
 *                          stage-event ledger) — folded in separately by lib/slackReports/build.ts
 *                          and passed in as `demosByOwner`.
 */
import {
  isConnected,
  isCallbackHigh,
  isCallbackLow,
  isGaveReferral,
  isNotInterested,
  MEETING_SCHEDULED_GUID,
  MEETING_RESCHEDULED_GUID,
} from "../../config/dispositions";
import { Activity } from "../sync/types";

export interface CallBlitzRow {
  ownerId: string;
  name: string;
  calls: number;
  emails: number;
  totalTouches: number;
  connectedCalls: number;
  highIntent: number;
  lowIntent: number;
  notInterested: number;
  referral: number;
  demos: number;
  meetings: number;
}

export type CallBlitzTotals = Omit<CallBlitzRow, "ownerId" | "name">;

export interface CallBlitzReport {
  reportDateEt: string; // "YYYY-MM-DD" — the ET calendar day being reported
  teamName: string;
  rows: CallBlitzRow[];
  totals: CallBlitzTotals;
}

function newRow(ownerId: string, name: string): CallBlitzRow {
  return {
    ownerId, name,
    calls: 0, emails: 0, totalTouches: 0, connectedCalls: 0,
    highIntent: 0, lowIntent: 0, notInterested: 0, referral: 0, demos: 0, meetings: 0,
  };
}

/** Fold pre-loaded activities (already scoped to the team + reporting window) into one row per
 *  owner, plus a team-totals row. `demosByOwner` is computed separately (deal-stage source). */
export function buildCallBlitzReport(
  activities: Activity[],
  demosByOwner: Record<string, number>,
  ownerIds: string[],
  names: Record<string, string>,
  reportDateEt: string,
  teamName: string,
): CallBlitzReport {
  const byOwner = new Map<string, CallBlitzRow>();
  for (const id of ownerIds) byOwner.set(id, newRow(id, names[id] ?? `ID:${id}`));

  for (const a of activities) {
    const row = byOwner.get(a.ownerId);
    if (!row) continue; // defensive — the caller should already scope activities to ownerIds

    if (a.type === "call") {
      row.calls++;
      if (isConnected(a.disposition)) row.connectedCalls++;
      if (isCallbackHigh(a.disposition)) row.highIntent++;
      if (isCallbackLow(a.disposition)) row.lowIntent++;
      if (isNotInterested(a.disposition)) row.notInterested++;
      if (isGaveReferral(a.disposition)) row.referral++;
      if (a.disposition === MEETING_SCHEDULED_GUID || a.disposition === MEETING_RESCHEDULED_GUID) row.meetings++;
    } else if (a.type === "email") {
      row.emails++;
    }
  }

  for (const id of ownerIds) {
    const row = byOwner.get(id)!;
    row.demos = demosByOwner[id] ?? 0;
    row.totalTouches = row.calls + row.emails;
  }

  const rows = ownerIds.map((id) => byOwner.get(id)!).sort((a, b) => b.totalTouches - a.totalTouches);

  const totals: CallBlitzTotals = {
    calls: 0, emails: 0, totalTouches: 0, connectedCalls: 0,
    highIntent: 0, lowIntent: 0, notInterested: 0, referral: 0, demos: 0, meetings: 0,
  };
  for (const r of rows) {
    totals.calls += r.calls;
    totals.emails += r.emails;
    totals.connectedCalls += r.connectedCalls;
    totals.highIntent += r.highIntent;
    totals.lowIntent += r.lowIntent;
    totals.notInterested += r.notInterested;
    totals.referral += r.referral;
    totals.demos += r.demos;
    totals.meetings += r.meetings;
  }
  totals.totalTouches = totals.calls + totals.emails;

  return { reportDateEt, teamName, rows, totals };
}
