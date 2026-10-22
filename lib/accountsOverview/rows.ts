/** Accounts Overview — pure HubSpot record → sdr_ao_* row mappers (no I/O; unit-tested). */
import { stageKey, AUTO_PIPELINE_ID } from "../../config/deal-stages";
import { teamValueById } from "../../config/accounts-overview";
import { etMidnightUtcMs } from "../sync/buckets";
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

/** A HubSpot DATE property ("2026-09-18", or epoch ms at UTC midnight) → the start of that calendar
 *  day in US/Eastern, so a demo dated Jul 1 lands in Q3 rather than on Jun 30 evening ET. */
export function dateMs(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (() => { const ms = msOf(v); return ms == null ? null : new Date(ms).toISOString().slice(0, 10); })();
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return etMidnightUtcMs(y, m, d);
}

const intOf = (v: string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

export function companyRow(id: string, p: Props): AoCompanyRow {
  return {
    hs_id: id, name: str(p.name), domain: str(p.domain), country: str(p.country_dropdown) ?? str(p.country), state: str(p.state), city: str(p.city),
    owner_id: str(p.hubspot_owner_id), team: teamValueById(p.hubspot_team_id), icp: str(p.icp),
    type_of_dealership: str(p.type_of_dealership), is_group: str(p.is_this_is_a_part_of_group_dealership_),
    gd_id: str(p.gd_id), gd_name: str(p.gd_name), group_name: str(p.dealership_group_name),
    last_activity_ms: msOf(p.notes_last_updated), last_contacted_ms: msOf(p.notes_last_contacted),
    rooftop_last_activity_ms: msOf(p.rooftop_last_activity),
    num_contacts: intOf(p.num_associated_contacts), hs_lastmodified_ms: msOf(p.hs_lastmodifieddate),
    potential_rooftops: intOf(p.potential_rooftops),
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

/** Auto-Pipeline deal → row. Non-Auto pipelines return null (demo metrics are Auto-Pipeline-only).
 *  Demo dates come straight from the deal's HubSpot date properties (user decision 2026-10-22):
 *  booked = "Demo Scheduled for Date" (`demo_scheduled_for_date`), conducted = "Demo Completed Date"
 *  (`demo_completed_date`). `team` = the deal's HubSpot Team (sync.ts), else its people's main team. */
export function dealRow(id: string, p: Props, companyIds: string[], team: string | null = null): AoDealRow | null {
  if (p.pipeline !== AUTO_PIPELINE_ID) return null;
  return {
    hs_id: id, stage_key: stageKey(p.pipeline, p.dealstage), deal_owner_id: str(p.hubspot_owner_id), sdr_owner_id: str(p.sdr_owner),
    company_ids: [...new Set(companyIds)].sort(),
    demo_booked_ms: dateMs(p.demo_scheduled_for_date), demo_completed_ms: dateMs(p.demo_completed_date),
    deal_name: str(p.dealname), amount: p.amount != null && p.amount !== "" && Number.isFinite(Number(p.amount)) ? Number(p.amount) : null,
    created_ms: msOf(p.createdate), close_ms: msOf(p.closedate), team,
  };
}

/** True when the deal was created, had its demo scheduled for, or its demo completed inside [fromMs, toMs). */
export function dealInWindow(d: AoDealRow, fromMs: number, toMs: number): boolean {
  return [d.created_ms, d.demo_booked_ms, d.demo_completed_ms].some((ms) => ms != null && ms >= fromMs && ms < toMs);
}
