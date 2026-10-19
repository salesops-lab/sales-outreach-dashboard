"use client";

import { useState, useTransition } from "react";
import { setRosterAssignment } from "../../app/admin/actions";

type Option = { key: string; name: string };

/** Inline dropdown in the roster table: pick a Manager (SDR team) or AE pod and it saves at once.
 *  Shows "Saved" or the error next to it; on failure the dropdown snaps back to the stored value. */
export function RosterAssign({ ownerId, field, value, options, emptyLabel, disabled }: {
  ownerId: string; field: "manager_key" | "ae_pod"; value: string | null; options: Option[]; emptyLabel: string; disabled?: boolean;
}) {
  const [current, setCurrent] = useState(value ?? "");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  // A key that is no longer an active manager / pod still shows, so nothing is silently cleared.
  const opts = current && !options.some((o) => o.key === current) ? [...options, { key: current, name: `${current} (inactive)` }] : options;

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={current}
        disabled={disabled || pending}
        aria-label={field === "manager_key" ? "Manager" : "AE pod"}
        onChange={(e) => {
          const next = e.target.value;
          const prev = current;
          setCurrent(next);
          setStatus(null);
          start(async () => {
            const r = await setRosterAssignment(ownerId, field, next);
            setStatus(r);
            if (!r.ok) setCurrent(prev);
          });
        }}
        className="max-w-[11rem] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-sm text-slate-700 disabled:opacity-50"
      >
        <option value="">{emptyLabel}</option>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
      </select>
      {pending && <span className="text-[11px] text-slate-400">Saving…</span>}
      {!pending && status && <span className={`text-[11px] ${status.ok ? "text-emerald-600" : "text-rose-600"}`}>{status.message}</span>}
    </span>
  );
}
