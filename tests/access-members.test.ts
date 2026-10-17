import { describe, expect, it } from "vitest";
import { buildAccessList, permissionOf, roleWriteFor } from "../lib/access/members";

const g = { provider: "google", providers: ["google"] };

describe("buildAccessList", () => {
  it("merges signed-in users, saved roles and the roster; drops non-spyne / non-Google users", () => {
    const list = buildAccessList(
      [
        { email: "Ana@spyne.ai", last_sign_in_at: "2026-10-10T10:00:00Z", user_metadata: { full_name: "Ana A" }, app_metadata: g },
        { email: "bob@spyne.ai", app_metadata: g },
        { email: "x@gmail.com", app_metadata: g },
        { email: "pw@spyne.ai", app_metadata: { provider: "email" } },
      ],
      [{ email: "boss@spyne.ai", role: "admin" }, { email: "bob@spyne.ai", role: "manager" }],
      [{ email: "bob@spyne.ai", name: "Bob Rep", kind: "sdr", active: true }],
    );
    expect(list.map((m) => m.email)).toEqual(["boss@spyne.ai", "ana@spyne.ai", "bob@spyne.ai"]);
    const [boss, ana, bob] = list;
    expect(boss).toMatchObject({ permission: "admin", signedIn: false });
    expect(ana).toMatchObject({ name: "Ana A", permission: "member", signedIn: true, lastSignInAt: "2026-10-10T10:00:00Z", repType: null });
    expect(bob).toMatchObject({ name: "Bob Rep", permission: "member", rawRole: "manager", repType: "SDR" });
  });
});

describe("permission writes", () => {
  it("maps roles to Admin/Member", () => {
    expect(permissionOf("admin")).toBe("admin");
    expect(permissionOf("leadership")).toBe("admin");
    expect(permissionOf("manager")).toBe("member");
    expect(permissionOf(null)).toBe("member");
  });
  it("only writes when the permission actually changes; never downgrades a manager row", () => {
    expect(roleWriteFor("admin", null)).toEqual({ role: "admin" });
    expect(roleWriteFor("admin", "leadership")).toBeNull();
    expect(roleWriteFor("admin", "manager")).toEqual({ role: "admin" });
    expect(roleWriteFor("member", "admin")).toEqual({ role: "viewer" });
    expect(roleWriteFor("member", null)).toEqual({ role: "viewer" });
    expect(roleWriteFor("member", "manager")).toBeNull();
    expect(roleWriteFor("member", "viewer")).toBeNull();
  });
});
