/** Accounts Overview — row shapes (sdr_ao_* tables) + the API payload contracts.
 *  Pure types, safe to import from client components. */

export type AoActivityType = "call" | "email" | "meeting" | "note" | "task";
export type AccountType = "single_franchise" | "independent" | "group" | "unknown";
export type IcpStatus = "yes" | "no" | "unknown";
/** One date-based inactivity status. Company + rooftop are measured independently. */
export type InactivityStatus =
  | "active" | "inactive_60" | "inactive_90"
  | "no_activity"    // company: HubSpot Last Activity Date empty (HubSpot auto-sets it on any logged activity)
  | "missing_date"   // rooftop: custom Rooftop Last Activity empty — NOT proof of no contact
  | "needs_review";  // date in the future, or contradicts another HubSpot date

export interface AoCompanyRow {
  hs_id: string;
  name: string | null;
  domain: string | null;
  country: string | null;          // raw HubSpot free text
  state: string | null;
  city: string | null;
  owner_id: string | null;         // hubspot_owner_id — ACCOUNT owner
  team: string | null;             // team_accounts — ASSIGNED team
  icp: string | null;              // raw `icp` (yes/no/empty)
  type_of_dealership: string | null;
  is_group: string | null;         // raw flag value ("true"/"false"/legacy "Yes"/null)
  gd_id: string | null;
  gd_name: string | null;
  group_name: string | null;       // dealership_group_name
  last_activity_ms: number | null;   // notes_last_updated
  last_contacted_ms: number | null;  // notes_last_contacted
  rooftop_last_activity_ms: number | null; // rooftop_last_activity
  num_contacts: number | null;     // HubSpot num_associated_contacts (reconciliation reference)
  hs_lastmodified_ms: number | null;
}

export interface AoContactRow {
  hs_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  owner_id: string | null;         // CONTACT owner
  icp: string | null;              // raw icp_non_icp ("ICP"/"Non ICP"/null)
  last_activity_ms: number | null;
  last_contacted_ms: number | null;
  company_ids: string[];           // in-scope companies this contact is associated with
}

export interface AoActivityRow {
  hs_id: string;
  type: AoActivityType;
  ts_ms: number;                   // hs_timestamp (meetings: the meeting's activity date)
  owner_id: string | null;         // ACTIVITY owner (hubspot_owner_id on the engagement)
  direction: string | null;        // calls: hs_call_direction; emails: hs_email_direction
  disposition: string | null;      // calls: hs_call_disposition GUID
  duration_ms: number | null;      // calls: hs_call_duration
  email_replied: boolean;
  meeting_outcome: string | null;  // SCHEDULED/COMPLETED/RESCHEDULED/NO_SHOW/CANCELED/null
  meeting_start_ms: number | null;
  subject: string | null;          // call title / email subject / meeting title / task subject / note excerpt
  company_ids: string[];           // in-scope companies (direct OR via an associated contact)
  contact_ids: string[];
  via_contact_only: boolean;       // true = attributed to the company only through a contact
}

export interface AoDealRow {
  hs_id: string;
  stage_key: string;
  deal_owner_id: string | null;
  sdr_owner_id: string | null;
  company_ids: string[];
  demo_booked_ms: number | null;     // demoScheduledMs() — entered Discovery Call Done
  demo_completed_ms: number | null;  // demoCompletedMs() — first Demo Done/Accepted/In Discussion
}

export interface AoSyncState {
  status: "never" | "running" | "ok" | "error";
  started_at: string | null;
  finished_at: string | null;
  window_start_ms: number | null;
  counts: Record<string, number>;
  reconciliation: AoReconRow[];
  owners: Record<string, { name: string; active: boolean }>;
  error: string | null;
}

/** Sync-time reconciliation: HubSpot Search `total` per team vs rows actually stored. */
export interface AoReconRow { check: string; team: string | null; hubspot: number | null; stored: number; ok: boolean; note?: string }

// ── request filters ──────────────────────────────────────────────────────────
export interface DateRange { fromMs: number | null; toMs: number | null; includeMissing?: boolean }

export type DealerTypeFilter = "all" | "franchise" | "independent" | "none";

export interface AoFilters {
  teams: string[];                 // team_accounts values; [] = all four
  member: string | null;           // ACTIVITY owner id (team member who did the work)
  country: string;                 // "USA" (default) | "all" | normalized country label | "Unknown"
  state: string;                   // "all" | exact state text (case-insensitive)
  gdName: string;                  // "" = any; otherwise exact GD Name (case-insensitive)
  dealerType: DealerTypeFilter;    // Type of Dealership
  owner: string | null;            // ACCOUNT owner id
  companyDate: DateRange | null;   // on HubSpot Last Activity Date (notes_last_updated)
  q: string;                       // list search: company name / domain / record id
  activityTypes: AoActivityType[]; // [] = all
  activityFrom: number;            // [from, to) ms — the reporting period
  activityTo: number;
}
