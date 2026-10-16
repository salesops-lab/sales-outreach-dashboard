/** Accounts Overview — pure HubSpot record → sdr_ao_* row mappers (no I/O; unit-tested). */
import { stageKey, AUTO_PIPELINE_ID } from "../../config/deal-stages";
import { stageEventsOf } from "../sync/stage-events";
import { demoScheduledMs, demoCompletedMs } from "../sync/aggregate";
import { Deal } from "../sync/types";
import { AoActivityRow, AoActivityType, AoCompanyRow, AoContactRow, AoDealRow } from "./types";

type Props = Record<string, string | null>;

const str = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());

/** Epoch-ms from a HubSpot datetime (epoch-ms string or ISO); null when empty/unparseable. */
export function msOf(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const t = new Date(v).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

const intOf = (v: string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

export function companyRow(id: string, p: Props): AoCompanyRow {
  return {
    hs_id: id, name: str(p.name), domain: str(p.domain), country: str(p.country), state: str(p.state), city: str(p.city),
    owner_id: str(p.hubspot_owner_id), team: str(p.team_accounts), icp: str(p.icp),
    type_of_dealership: str(p.type_of_dealership), is_group: str(p.is_this_is_a_part_of_group_dealership_),
    gd_id: str(p.gd_id), gd_name: str(p.gd_name), group_name: str(p.dealership_group_name),
    last_activity_ms: msOf(p.notes_last_updated), last_contacted_ms: msOf(p.notes_last_contacted),
    rooftop_last_activity_ms: msOf(p.rooftop_last_activity),
    num_contacts: intOf(p.num_associated_contacts), hs_lastmodified_ms: msOf(p.hs_lastmodifieddate),
  };
}

export function contactRow(id: string, p: Props, companyIds: string[]): AoContactRow {
  return {
    hs_id: id, first_name: str(p.firstname), last_name: str(p.lastname), title: str(p.jobtitle),
    email: str(p.email), phone: str(p.phone) ?? str(p.mobilephone), owner_id: str(p.hubspot_owner_id),
    icp: str(p.icp_non_icp), last_activity_ms: msOf(p.notes_last_updated), last_contacted_ms: msOf(p.notes_last_contacted),
    company_ids: [...new Set(companyIds)].sort(),
  };
}

/** Strip HTML + collapse whitespace; notes can be long rich text — keep an excerpt only. */
export function excerpt(html: string | null | undefined, max = 200): string | null {
  if (!html) return null;
  const t = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function activityRow(
  type: AoActivityType, id: string, p: Props,
  companyIds: string[], contactIds: string[], viaContactOnly: boolean,
): AoActivityRow | null {
  const ts = msOf(p.hs_timestamp);
  if (ts == null) return null; // cannot be dated → cannot be placed in any period
  const subject =
    type === "call" ? str(p.hs_call_title) :
    type === "email" ? str(p.hs_email_subject) :
    type === "meeting" ? str(p.hs_meeting_title) :
    type === "task" ? str(p.hs_task_subject) :
    excerpt(p.hs_note_body);
  return {
    hs_id: id, type, ts_ms: ts, owner_id: str(p.hubspot_owner_id),
    direction: type === "call" ? str(p.hs_call_direction) : type === "email" ? str(p.hs_email_direction) : null,
    disposition: type === "call" ? str(p.hs_call_disposition) : null,
    duration_ms: type === "call" ? intOf(p.hs_call_duration) : null,
    email_replied: type === "email" ? (intOf(p.hs_email_reply_count) ?? 0) > 0 : false,
    meeting_outcome: type === "meeting" ? str(p.hs_meeting_outcome) : null,
    meeting_start_ms: type === "meeting" ? msOf(p.hs_meeting_start_time) : null,
    subject: subject && subject.length > 200 ? `${subject.slice(0, 199)}…` : subject,
    company_ids: [...new Set(companyIds)].sort(), contact_ids: [...new Set(contactIds)].sort(),
    via_contact_only: viaContactOnly,
  };
}

/** Auto-Pipeline deal → row with demo dates from the EXISTING event-truth helpers. Non-Auto
 *  pipelines return null (the dashboard's demo metrics are Auto-Pipeline-only). */
export function dealRow(id: string, p: Props, companyIds: string[]): AoDealRow | null {
  if (p.pipeline !== AUTO_PIPELINE_ID) return null;
  const d: Deal = {
    id, pipeline: p.pipeline, dealstage: p.dealstage ?? null, stageKey: stageKey(p.pipeline, p.dealstage),
    dealOwnerId: str(p.hubspot_owner_id), sdrOwnerId: str(p.sdr_owner), companyId: companyIds[0] ?? null,
    contactIds: [], amount: null, demoScheduledForMs: null,
    discoveryDoneMs: msOf(p.discovery_call_done_stage_date), demoDoneMs: msOf(p.demo_done_stage_date),
    stageEvents: stageEventsOf(p),
  };
  return {
    hs_id: id, stage_key: d.stageKey, deal_owner_id: d.dealOwnerId, sdr_owner_id: d.sdrOwnerId,
    company_ids: [...new Set(companyIds)].sort(),
    demo_booked_ms: demoScheduledMs(d), demo_completed_ms: demoCompletedMs(d),
  };
}
