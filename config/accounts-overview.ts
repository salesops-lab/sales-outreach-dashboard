/**
 * Accounts Overview — verified HubSpot sources (portal 242626590).
 *
 * TEAM = the company's **HubSpot Team** (`hubspot_team_id`), which HubSpot sets from the company
 * owner's team (Settings → Users & Teams). This is the "Team" a user filters on in HubSpot — the
 * user confirmed Saarthak = 5,502 companies on 2026-10-16. (The separate hand-filled `team_accounts`
 * dropdown was used first and gave far smaller numbers — don't go back to it.)
 * Team MEMBERS likewise come from HubSpot team membership (/crm/v3/owners → teams).
 */
export const AO_TEAMS = [
  { value: "Neelima", label: "Neelima Team", hubspotTeamId: "362172280" },
  { value: "Prince", label: "Prince Team", hubspotTeamId: "362172539" },
  { value: "Saarthak", label: "Saarthak Team", hubspotTeamId: "362172393" },
  { value: "Central", label: "Central Team", hubspotTeamId: "362172526" },
] as const;

/** HubSpot team id → our team value (null when outside the four teams). */
export const teamValueById = (id: string | null | undefined): string | null =>
  AO_TEAMS.find((t) => t.hubspotTeamId === String(id ?? "").trim())?.value ?? null;

/** How far back the sync keeps activities (calls/emails/meetings/notes/tasks). Covers the
 *  60-day threshold, the rolling 3 months, and custom ranges inside it. Inactivity itself
 *  uses HubSpot's own all-history date properties, NOT this window. */
export const AO_ACTIVITY_WINDOW_DAYS = 180;

/** Inactivity thresholds (days). */
export const AO_INACTIVE_DAYS = 60;
export const AO_DEEP_INACTIVE_DAYS = 90;

/** Company properties read by the Accounts Overview sync (all verified to exist). */
export const AO_COMPANY_PROPERTIES = [
  "name", "domain", "country", "country_dropdown", "state", "city",
  "hubspot_owner_id", "hubspot_team_id", "icp",
  "type_of_dealership", "is_this_is_a_part_of_group_dealership_",
  "gd_id", "gd_name", "dealership_group_name",
  "notes_last_updated",     // "Last Activity Date" — HubSpot-maintained, any logged activity incl. notes
  "notes_last_contacted",   // "Last Contacted" — HubSpot-maintained, excludes notes
  "rooftop_last_activity",  // "Rooftop Last Activity" — custom property (null ≠ never contacted)
  "num_associated_contacts",
  "potential_rooftops",     // "#Potential Rooftops" — custom number
  "hs_lastmodifieddate",
];

/** Contact properties (verified). `icp_non_icp` = contact-level ICP (ICP / Non ICP). */
export const AO_CONTACT_PROPERTIES = [
  "firstname", "lastname", "jobtitle", "email", "phone", "mobilephone",
  "hubspot_owner_id", "icp_non_icp", "notes_last_updated", "notes_last_contacted",
];

/**
 * HubSpot TAM = every company whose **Country Dropdown** (`country_dropdown`) is "United States".
 * Verified 2026-10-17: 119,645 companies — the same number the old TAM dashboard showed. The free-text
 * `country` field is far less complete (only ~67k say us/usa/united states), so it is NOT used here.
 */
export const AO_TAM_COUNTRY = { property: "country_dropdown", value: "United States" } as const;
