/**
 * Accounts Overview — verified HubSpot sources (portal 242626590), checked twice on 2026-10-16
 * (pass 1: CRM reporting/SQL group-bys; pass 2: CRM Search API totals — they matched).
 *
 * ASSIGNED TEAM is the company property `team_accounts` (enumeration). Live options:
 * Archit · Neelima · Saarthak · Central · Prince. It is INDEPENDENT of the company owner
 * (most team accounts are owned by the `salesops .` placeholder user) and of the roster's
 * owner→AE-pod mapping — never derive one from the other.
 *
 * Only the four teams below are in scope for this view. Archit is a real `team_accounts`
 * value but deliberately excluded (the request named four teams); it is reported, not hidden.
 */

/** `team_accounts` option value → the roster pod key (`sdr_pods.pod_key`) used for the
 *  activity-owner "roster pod" lens. Keys are the HubSpot option VALUES (case-sensitive). */
export const AO_TEAMS = [
  { value: "Neelima", label: "Neelima Team", podKey: "neelima" },
  { value: "Prince", label: "Prince Team", podKey: "prince" },
  { value: "Saarthak", label: "Saarthak Team", podKey: "saarthak" },
  { value: "Central", label: "Central Team", podKey: "central" },
] as const;

/** `team_accounts` values that exist in HubSpot but are out of this view's scope. */
export const AO_EXCLUDED_TEAMS = ["Archit"] as const;

/** How far back the sync keeps activities (calls/emails/meetings/notes/tasks). Covers the
 *  60/90-day thresholds, the rolling 3 months, and custom ranges inside it. Inactivity itself
 *  uses HubSpot's own all-history date properties, NOT this window. */
export const AO_ACTIVITY_WINDOW_DAYS = 180;

/** Default inactivity thresholds (days). Both are adjustable in the UI. */
export const AO_INACTIVE_DAYS = 60;
export const AO_DEEP_INACTIVE_DAYS = 90;

/** Company properties read by the Accounts Overview sync (all verified to exist). */
export const AO_COMPANY_PROPERTIES = [
  "name", "domain", "country", "state", "city",
  "hubspot_owner_id", "team_accounts", "icp",
  "type_of_dealership", "is_this_is_a_part_of_group_dealership_",
  "gd_id", "gd_name", "dealership_group_name",
  "notes_last_updated",     // "Last Activity Date" — HubSpot-maintained, any logged activity incl. notes
  "notes_last_contacted",   // "Last Contacted" — HubSpot-maintained, excludes notes
  "rooftop_last_activity",  // "Rooftop Last Activity" — custom property (null ≠ never contacted)
  "num_associated_contacts",
  "hs_lastmodifieddate",
];

/** Contact properties (verified). `icp_non_icp` = contact-level ICP (ICP / Non ICP). */
export const AO_CONTACT_PROPERTIES = [
  "firstname", "lastname", "jobtitle", "email", "phone", "mobilephone",
  "hubspot_owner_id", "icp_non_icp", "notes_last_updated", "notes_last_contacted",
];
