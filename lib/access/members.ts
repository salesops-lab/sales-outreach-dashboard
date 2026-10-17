/** Who has dashboard access — pure merge for the Admin "Dashboard access" section (unit-tested).
 *
 *  There is no separate invite system: anyone who signs in with a Google @spyne.ai account gets in
 *  (middleware.ts + lib/auth/domain.ts). So "who has access" = the people who have signed in
 *  (Supabase auth users) plus anyone an admin pre-registered in `sdr_roles` who hasn't signed in yet.
 *  Permission is the existing `sdr_roles.role`: admin/leadership → Admin, anything else → Member. */
import { isAllowedUser } from "../auth/domain";

export type Permission = "admin" | "member";

/** The bits of a Supabase auth user this section reads. */
export interface AuthUserLite {
  email?: string | null;
  last_sign_in_at?: string | null;
  created_at?: string | null;
  user_metadata?: { full_name?: string | null; name?: string | null } | null;
  app_metadata?: { provider?: string | null; providers?: string[] | null } | null;
}

export interface RoleRowLite { email: string; role: string }
export interface RosterLite { email: string | null; name: string; kind: string; active: boolean }

export interface AccessMember {
  email: string;
  name: string | null;
  permission: Permission;
  /** The raw sdr_roles value (null = no row) — shown when it's a manager/leadership nuance. */
  rawRole: string | null;
  signedIn: boolean;
  lastSignInAt: string | null;
  /** "SDR" / "AE" when this person is also a tracked rep, else null. */
  repType: string | null;
}

export function permissionOf(rawRole: string | null | undefined): Permission {
  return rawRole === "admin" || rawRole === "leadership" ? "admin" : "member";
}

/** Merge signed-in users + saved roles + the roster into one list (admins first, then by name). */
export function buildAccessList(users: AuthUserLite[], roles: RoleRowLite[], roster: RosterLite[]): AccessMember[] {
  const byEmail = new Map<string, AccessMember>();
  const roleOf = new Map(roles.map((r) => [r.email.toLowerCase(), r.role]));
  const rep = new Map<string, RosterLite>();
  for (const r of roster) if (r.email && r.active) rep.set(r.email.toLowerCase(), r);

  const upsert = (email: string): AccessMember => {
    let m = byEmail.get(email);
    if (!m) {
      const raw = roleOf.get(email) ?? null;
      const r = rep.get(email);
      m = { email, name: r?.name ?? null, permission: permissionOf(raw), rawRole: raw, signedIn: false, lastSignInAt: null, repType: r ? r.kind.toUpperCase() : null };
      byEmail.set(email, m);
    }
    return m;
  };

  // Only users who could actually pass the login gate (Google + @spyne.ai) count as having access.
  for (const u of users) {
    if (!isAllowedUser(u)) continue;
    const m = upsert(u.email!.trim().toLowerCase());
    m.signedIn = true;
    m.lastSignInAt = u.last_sign_in_at ?? null;
    m.name = m.name ?? u.user_metadata?.full_name ?? u.user_metadata?.name ?? null;
  }
  for (const r of roles) upsert(r.email.toLowerCase());

  return [...byEmail.values()].sort((a, b) =>
    (a.permission === b.permission ? 0 : a.permission === "admin" ? -1 : 1)
    || (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

/** What to write to sdr_roles when an admin sets a permission. `null` = leave the row as it is.
 *  Member never downgrades a manager row (its team_id still drives legacy views); it only replaces
 *  an admin/leadership row or creates a plain `viewer` row so the person shows up in the list. */
export function roleWriteFor(target: Permission, currentRole: string | null): { role: string } | null {
  if (target === "admin") return permissionOf(currentRole) === "admin" ? null : { role: "admin" };
  if (currentRole === "manager" || currentRole === "viewer") return null;
  return { role: "viewer" };
}
