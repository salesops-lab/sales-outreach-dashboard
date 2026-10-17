"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { removeAccess, setAccess } from "../../app/admin/actions";
import type { AccessMember } from "../../lib/access/members";

type Result = { ok: boolean; message: string } | null;

const inputCls = "rounded-lg border border-slate-200 px-2 py-1.5 text-sm";

function Save({ label, small }: { label: string; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className={small
        ? "text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50"
        : "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"}
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

const fmt = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })
  : "—");

/** Dashboard access: give someone access (Admin / Member) and change anyone's permission.
 *  Login stays Google sign-in with a @spyne.ai account — nothing new to set up. */
export function AccessManager({ members, me }: { members: AccessMember[]; me: string }) {
  const [state, formAction] = useFormState<Result, FormData>(setAccess, null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? members.filter((m) => m.email.includes(s) || (m.name ?? "").toLowerCase().includes(s)) : members;
  }, [members, q]);
  const admins = members.filter((m) => m.permission === "admin").length;

  return (
    <div>
      {state && (
        <div
          role="status"
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            state.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"
          }`}
        >
          {state.message}
        </div>
      )}

      <form action={formAction} className="mb-5 flex flex-wrap items-center gap-2">
        <input name="email" required placeholder="name@spyne.ai" className={`${inputCls} min-w-[16rem]`} />
        <select name="permission" defaultValue="member" className={inputCls} aria-label="Permission">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <Save label="Give access" />
      </form>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {members.length} people · {admins} admin{admins === 1 ? "" : "s"} · {members.length - admins} members
        </p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className={inputCls} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
            <th className="py-1">Name</th><th>Email</th><th>Status</th><th>Rep</th><th>Permission</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.email} className="border-b border-slate-100">
              <td className="py-1.5 font-medium text-slate-800">
                {m.name ?? "—"}
                {m.email === me && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
              </td>
              <td className="text-slate-500">{m.email}</td>
              <td className="text-xs">
                {m.signedIn
                  ? <span className="text-emerald-700">Last login {fmt(m.lastSignInAt)}</span>
                  : <span className="text-amber-700">Not signed in yet</span>}
              </td>
              <td className="text-xs font-semibold text-slate-600">{m.repType ?? "—"}</td>
              <td>
                {m.email === me ? (
                  <span className="text-xs font-semibold text-slate-700">Admin</span>
                ) : (
                  <div className="flex items-center gap-3">
                    <form action={formAction} className="flex items-center gap-2">
                      <input type="hidden" name="email" value={m.email} />
                      <select name="permission" defaultValue={m.permission} className={inputCls} aria-label={`Permission for ${m.email}`}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <Save label="Save" small />
                    </form>
                    {!m.signedIn && m.rawRole && (
                      <form action={removeAccess}>
                        <input type="hidden" name="email" value={m.email} />
                        <button className="text-xs text-rose-600 hover:underline">remove</button>
                      </form>
                    )}
                  </div>
                )}
                {m.rawRole === "manager" && <span className="text-[11px] text-slate-400">manager</span>}
              </td>
            </tr>
          ))}
          {!shown.length && (
            <tr><td colSpan={5} className="py-3 text-center text-xs text-slate-400">No one matches.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
