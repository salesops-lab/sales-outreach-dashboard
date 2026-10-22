/**
 * Accounts Overview — verified HubSpot sources (portal 242626590).
 *
 * TEAM = the company's **HubSpot Team** (`hubspot_team_id`), which HubSpot sets from the company
 * owner's team (Settings → Users & Teams). This is the "Team" a user filters on in HubSpot — the
 * user confirmed Saarthak = 5,502 companies on 2026-10-16. (The separate hand-filled `team_accounts`
 * dropdown was used first and gave far smaller numbers — don't go back to it.)
 * Team MEMBERS come from each HubSpot user's MAIN team ("Default Team", `primary` on
 * /crm/v3/owners → teams). Extra teams are ignored: they made Shadman Khalid also a Central member
 * and put the shared cs.convertedaccounts@ login into three teams (fixed 2026-10-22).
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

/** Member role shown on the page (HubSpot has no role field). */
export type AoRole = "SDR" | "SDR-TL" | "AE" | "Team Lead" | "Team Lead / AE" | "Manager";

/**
 * The team mapping the user confirmed on 2026-10-22 — identical to every user's HubSpot main team
 * that day. Used for each person's ROLE, and as their team until the next sync stores HubSpot main
 * teams. People HubSpot puts in a team who are not listed here (new joiners) still appear, from
 * HubSpot, with their roster role. Emails are HubSpot user emails (Kshitij's is spelled
 * "kshiitj" in HubSpot).
 */
export const AO_TEAM_ROSTER: { team: string; name: string; email: string; role: AoRole }[] = [
  { team: "Central", name: "Ayushi Rawat", email: "ayushi.rawat@spyne.ai", role: "SDR" },
  { team: "Central", name: "Nikita Gandhi", email: "nikita.gandhi@spyne.ai", role: "SDR" },
  { team: "Central", name: "Daisy Kamra", email: "daisy.kamra@spyne.ai", role: "SDR" },
  { team: "Central", name: "Devansh Yadav", email: "devansh.yadav@spyne.ai", role: "SDR" },
  { team: "Neelima", name: "Dave Purgason", email: "david@spyne.ai", role: "AE" },
  { team: "Neelima", name: "Neelima Tiwari", email: "neelima.tiwari@spyne.ai", role: "Team Lead / AE" },
  { team: "Neelima", name: "Kshitij Agarwal", email: "kshiitj.agarwal@spyne.ai", role: "SDR-TL" },
  { team: "Neelima", name: "Himansshu Yadav", email: "himansshu.yadav@spyne.ai", role: "SDR" },
  { team: "Neelima", name: "Shadman Khalid", email: "mohd.khalid@spyne.ai", role: "SDR" },
  { team: "Neelima", name: "Anisha Jaiswal", email: "anisha.jaiswal@spyne.ai", role: "SDR" },
  { team: "Neelima", name: "utsav Yadav", email: "utsav.yadav@spyne.ai", role: "SDR" },
  { team: "Neelima", name: "Shubham Singha.", email: "shubham.singha@spyne.ai", role: "SDR" },
  { team: "Neelima", name: "Shivam Kaushik", email: "shivam.kaushik@spyne.ai", role: "AE" },
  { team: "Neelima", name: "Vaibhav Kumar", email: "vaibhav.kumar@spyne.ai", role: "Manager" },
  { team: "Neelima", name: "Arun Divya Prakash", email: "arun.prakash@spyne.ai", role: "AE" },
  { team: "Neelima", name: "Jatin Arora", email: "jatin.arora@spyne.ai", role: "AE" },
  { team: "Neelima", name: "Pallav Pandey", email: "pallav.pandey@spyne.ai", role: "AE" },
  { team: "Neelima", name: "Vans K", email: "vanshit.kothari@spyne.ai", role: "AE" },
  { team: "Neelima", name: "Simran Grover", email: "simran.grover@spyne.ai", role: "AE" },
  { team: "Prince", name: "Gagan Raj", email: "gagan.raj@spyne.ai", role: "AE" },
  { team: "Prince", name: "Prince Arora", email: "prince.arora@spyne.ai", role: "Team Lead / AE" },
  { team: "Prince", name: "Palak Narula", email: "palak.narula@spyne.ai", role: "SDR" },
  { team: "Prince", name: "Priyanka Sambyal", email: "priyanka.sambyal@spyne.ai", role: "SDR" },
  { team: "Prince", name: "Kreeti Chhabra", email: "kreeti.chhabra@spyne.ai", role: "SDR" },
  { team: "Prince", name: "Dev Patel", email: "dev.patel@spyne.ai", role: "SDR" },
  { team: "Prince", name: "Ketan Srivastava", email: "ketan.srivastava@spyne.ai", role: "AE" },
  { team: "Saarthak", name: "Saarthak Seth", email: "saarthak.seth@spyne.ai", role: "Team Lead" },
  { team: "Saarthak", name: "Nam Harrison", email: "namrata.sharma@spyne.ai", role: "SDR" },
  { team: "Saarthak", name: "Sahil Bakshi", email: "sahil.bakshi@spyne.ai", role: "SDR" },
  { team: "Saarthak", name: "Aayush Rai", email: "aayush.rai@spyne.ai", role: "SDR" },
  { team: "Saarthak", name: "Vaansh Sharma", email: "vaansh.sharma@spyne.ai", role: "SDR" },
  { team: "Saarthak", name: "Drishti Aggarwal", email: "drishti.aggarwal@spyne.ai", role: "SDR" },
  { team: "Saarthak", name: "Viplove Tyagi", email: "viplove.tyagi@spyne.ai", role: "SDR" },
  { team: "Saarthak", name: "Ankur Patel", email: "ankur.patel@spyne.ai", role: "AE" },
  { team: "Saarthak", name: "Devansh Verma", email: "devansh.verma@spyne.ai", role: "AE" },
  { team: "Saarthak", name: "Rishabh Sharma", email: "rishabh.sharma@spyne.ai", role: "AE" },
  { team: "Saarthak", name: "Liam Fallon", email: "liam.fallon@spyne.ai", role: "AE" },
];

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
