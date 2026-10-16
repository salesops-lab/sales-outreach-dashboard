"use client";
/** Accounts Overview — the eight sub-tab bodies. Every number that maps to a set of accounts is a
 *  drill-down: clicking opens the matching list (same filters + the row's scope). */
import { Bars, Card, etDay, fmt, ICP_LABEL, Kpi, Note, Num, pct, statusLabel, TH, TYPE_LABEL } from "./parts";
import { ListSpec, ListTable } from "./ListPanel";
import type { UiFilters } from "./AccountsOverview";
import { cn } from "../ui";

type Th = { inact: number; deep: number };
type Open = (s: ListSpec) => void;
interface P { data: any; th: Th; f: UiFilters; openList: Open; openDetail: (id: string) => void; qs: string }

const acc = (title: string, drill: string, extra?: Record<string, string>): ListSpec => ({ view: "accounts", title, drill, extra });

function periodLabel(meta: any) {
  return `${etDay(meta.period.from)} → ${etDay(meta.period.to - 1)}`;
}

// ── shared tables ────────────────────────────────────────────────────────────
function TeamTable({ rows, total, openList, th, mode }: { rows: any[]; total: any; openList: Open; th: Th; mode: "distribution" | "activity" }) {
  const all = [...rows, { team: "", label: "All selected teams", t: total }];
  const scope = (r: any): Record<string, string> | undefined => (r.team ? { teams: r.team } : undefined);
  const d = (r: any, key: string, title: string) => () => openList(acc(`${r.label} · ${title}`, key, scope(r)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-line">
          {mode === "distribution" ? (
            <tr><TH>Team</TH><TH right>Accounts</TH><TH right>Single Fr.</TH><TH right>Indep.</TH><TH right>Group</TH><TH right>Unknown</TH><TH right>Unique GDs</TH>
              <TH right>Active</TH><TH right>Inactive {th.inact}+</TH><TH right>Inactive {th.deep}+</TH><TH right>No activity</TH><TH right>Never contacted</TH><TH right>Contacts</TH></tr>
          ) : (
            <tr><TH>Team</TH><TH right>Accounts</TH><TH right>Contacted</TH><TH right>Calls</TH><TH right>Connected</TH><TH right>Conn. rate</TH><TH right>Emails</TH><TH right>Meetings</TH>
              <TH right>Touchpoints</TH><TH right>0 touch</TH><TH right>1 touch</TH><TH right>2+ touch</TH><TH right>Contacts touched</TH><TH right>Contacts reached</TH><TH>Last touch</TH></tr>
          )}
        </thead>
        <tbody>
          {all.map((r) => (
            <tr key={r.label} className={cn("border-b border-line/60", !r.team && "bg-surface-muted/50 font-semibold")}>
              <td className="px-2 py-1.5">{r.label}</td>
              <Num v={r.t.accounts} onClick={d(r, "", "all accounts")} />
              {mode === "distribution" ? (
                <>
                  <Num v={r.t.single_franchise} onClick={d(r, "type:single_franchise", "Single Franchise")} />
                  <Num v={r.t.independent} onClick={d(r, "type:independent", "Independent")} />
                  <Num v={r.t.group} onClick={d(r, "type:group", "Group Dealership")} />
                  <Num v={r.t.unknown} onClick={d(r, "type:unknown", "Unknown / Needs Review")} />
                  <Num v={r.t.unique_gds} />
                  <Num v={r.t.c_active} onClick={d(r, "cstatus:active", "Active (company)")} />
                  <Num v={r.t.c_inactive_60 + r.t.c_inactive_90} onClick={d(r, "cstatus:inactive_60plus", `Inactive ${th.inact}+ (company)`)} />
                  <Num v={r.t.c_inactive_90} onClick={d(r, "cstatus:inactive_90", `Inactive ${th.deep}+ (company)`)} />
                  <Num v={r.t.c_no_activity} onClick={d(r, "cstatus:no_activity", "No recorded activity")} />
                  <Num v={r.t.never_contacted} onClick={d(r, "never_contacted", "Never contacted (verified)")} />
                  <Num v={r.t.contacts} />
                </>
              ) : (
                <>
                  <Num v={r.t.contacted} onClick={d(r, "contacted", "Contacted in period")} />
                  <Num v={r.t.calls} /><Num v={r.t.connected} />
                  <td className="px-2 py-1.5 text-right font-mono">{pct(r.t.calls ? r.t.connected / r.t.calls : null)}</td>
                  <Num v={r.t.emails} /><Num v={r.t.meetings} /><Num v={r.t.touchpoints} />
                  <Num v={r.t.touch_0} onClick={d(r, "touch:0", "Zero touchpoints")} />
                  <Num v={r.t.touch_1} onClick={d(r, "touch:1", "One touchpoint")} />
                  <Num v={r.t.touch_2plus} onClick={d(r, "touch:2", "Two or more touchpoints")} />
                  <Num v={r.t.contacts_touched} /><Num v={r.t.contacts_reached} />
                  <td className="px-2 py-1.5">{etDay(r.t.last_touch_ms)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OwnerTable({ rows, openList, kind, th }: { rows: any[]; openList: Open; kind: "account" | "activity"; th: Th }) {
  const scope = (r: any): Record<string, string> => kind === "account"
    ? { ...(r.team ? { teams: r.team } : {}), owner: r.owner_id }
    : { ...(r.team ? { teams: r.team } : {}), member: r.owner_id };
  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 border-b border-line bg-surface">
          <tr>
            <TH>{kind === "account" ? "Account owner" : "Activity owner"}</TH><TH>{kind === "account" ? "Assigned team" : "Account team"}</TH><TH>Roster pod</TH>
            {kind === "account" ? (
              <><TH right>Accounts</TH><TH right>SF</TH><TH right>Ind.</TH><TH right>GD</TH><TH right>Unk.</TH><TH right>Active</TH><TH right>Inact {th.inact}+</TH><TH right>Inact {th.deep}+</TH><TH right>No act.</TH><TH right>Contacts</TH><TH right>Contacted</TH></>
            ) : (
              <><TH right>Accounts touched</TH><TH right>Calls</TH><TH right>Connected</TH><TH right>Emails</TH><TH right>Meetings</TH><TH right>Touchpoints</TH><TH right>Contacts touched</TH><TH right>Contacts reached</TH></>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = (key: string, title: string) => () => openList(acc(`${r.name}${r.team ? ` · ${r.team}` : ""} · ${title}`, key, scope(r)));
            return (
              <tr key={`${r.team}-${r.owner_id}`} className="border-b border-line/60">
                <td className="px-2 py-1.5">{r.name}{!r.on_roster && <span className="ml-1 rounded bg-surface-muted px-1 text-[10px] text-ink-subtle" title="Not on the TrackerAI roster">not tracked</span>}</td>
                <td className="px-2 py-1.5">{r.team ?? "—"}</td>
                <td className={cn("px-2 py-1.5", r.pod_matches_team === false && "text-warn")} title={r.pod_matches_team === false ? "Roster pod differs from the account's assigned team" : undefined}>{r.roster_pod ?? "—"}</td>
                {kind === "account" ? (
                  <>
                    <Num v={r.t.accounts} onClick={d("", "accounts")} />
                    <Num v={r.t.single_franchise} onClick={d("type:single_franchise", "Single Franchise")} />
                    <Num v={r.t.independent} onClick={d("type:independent", "Independent")} />
                    <Num v={r.t.group} onClick={d("type:group", "Group")} />
                    <Num v={r.t.unknown} onClick={d("type:unknown", "Unknown")} />
                    <Num v={r.t.c_active} onClick={d("cstatus:active", "Active")} />
                    <Num v={r.t.c_inactive_60 + r.t.c_inactive_90} onClick={d("cstatus:inactive_60plus", `Inactive ${th.inact}+`)} />
                    <Num v={r.t.c_inactive_90} onClick={d("cstatus:inactive_90", `Inactive ${th.deep}+`)} />
                    <Num v={r.t.c_no_activity} onClick={d("cstatus:no_activity", "No activity")} />
                    <Num v={r.t.contacts} />
                    <Num v={r.t.contacted} onClick={d("contacted", "Contacted in period")} />
                  </>
                ) : (
                  <>
                    <Num v={r.t.contacted} onClick={d("contacted", "accounts touched")} />
                    <Num v={r.t.calls} /><Num v={r.t.connected} /><Num v={r.t.emails} /><Num v={r.t.meetings} /><Num v={r.t.touchpoints} />
                    <Num v={r.t.contacts_touched} /><Num v={r.t.contacts_reached} />
                  </>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={14} className="px-2 py-6 text-center text-ink-subtle">Nothing in the current filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── tabs ─────────────────────────────────────────────────────────────────────
function Summary({ data, th, openList }: P) {
  const t = data.total;
  const o = (title: string, drill: string) => () => openList(acc(title, drill));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Total accounts" value={fmt(t.accounts)} sub={`${fmt(t.accounts)} unique rooftops (1 record = 1 rooftop)`} onClick={o("All accounts", "")} />
        <Kpi label="Single Franchise" value={fmt(t.single_franchise)} onClick={o("Single Franchise accounts", "type:single_franchise")} />
        <Kpi label="Independent" value={fmt(t.independent)} onClick={o("Independent accounts", "type:independent")} />
        <Kpi label="Group Dealership accounts" value={fmt(t.group)} onClick={o("Group Dealership accounts", "type:group")} />
        <Kpi label="Unique Group Dealerships" value={fmt(t.unique_gds)} sub="distinct GD ID / group name" />
        <Kpi label="Unknown / Needs Review" value={fmt(t.unknown)} tone="muted" onClick={o("Unknown / Needs Review accounts", "type:unknown")} />
        <Kpi label="Active (company)" value={fmt(t.c_active)} tone="good" sub={`last activity < ${th.inact}d`} onClick={o("Active accounts", "cstatus:active")} />
        <Kpi label={`Inactive ${th.inact}+ days`} value={fmt(t.c_inactive_60 + t.c_inactive_90)} tone="warm" sub={`incl. ${fmt(t.c_inactive_90)} at ${th.deep}+`} onClick={o(`Inactive ${th.inact}+ days`, "cstatus:inactive_60plus")} />
        <Kpi label={`Inactive ${th.deep}+ days`} value={fmt(t.c_inactive_90)} tone="danger" onClick={o(`Inactive ${th.deep}+ days`, "cstatus:inactive_90")} />
        <Kpi label="Never contacted" value={fmt(t.never_contacted)} tone="muted" sub="HubSpot Last Contacted empty + no touch synced" onClick={o("Never contacted (verified)", "never_contacted")} />
        <Kpi label="No recorded activity" value={fmt(t.c_no_activity)} tone="muted" sub="HubSpot Last Activity Date empty" onClick={o("No recorded activity", "cstatus:no_activity")} />
        <Kpi label="Associated contacts" value={fmt(t.contacts)} sub={`HubSpot count: ${fmt(t.hubspot_contacts)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Account type">
          <Bars rows={["single_franchise", "independent", "group", "unknown"].map((k) => ({ key: k, label: TYPE_LABEL[k], value: t[k] }))}
            onClick={(k) => openList(acc(TYPE_LABEL[k], `type:${k}`))} />
        </Card>
        <Card title="Company activity status">
          <Bars rows={[["active", "bg-good"], ["inactive_60", "bg-warm"], ["inactive_90", "bg-danger"], ["no_activity", "bg-ink-subtle"], ["needs_review", "bg-warn"]].map(([k, tone]) => ({ key: k, label: statusLabel(k, th), value: t[`c_${k}`], tone }))}
            onClick={(k) => openList(acc(`Company: ${statusLabel(k, th)}`, `cstatus:${k}`))} />
        </Card>
        <Card title="Company ICP">
          <Bars rows={["yes", "no", "unknown"].map((k) => ({ key: k, label: ICP_LABEL[k], value: t[`icp_${k}`] }))} onClick={(k) => openList(acc(ICP_LABEL[k], `icp:${k}`))} />
        </Card>
      </div>
      <Card title={`Teams · reporting period ${periodLabel(data.meta)}`}>
        <TeamTable rows={data.teams} total={t} openList={openList} th={th} mode="distribution" />
      </Card>
      <Note>
        Assigned team = HubSpot <b>Team Accounts</b> on the company. Account owner = company owner. These are independent in HubSpot
        (many team accounts are owned by a placeholder user) — see Team Distribution and Data Quality.
      </Note>
    </div>
  );
}

function Teams({ data, th, openList }: P) {
  return (
    <div className="space-y-4">
      <Card title="Team distribution"><TeamTable rows={data.teams} total={data.total} openList={openList} th={th} mode="distribution" /></Card>
      <Card title="Members by ACCOUNT owner (company owner, grouped by the account's assigned team)">
        <OwnerTable rows={data.account_owners} openList={openList} kind="account" th={th} />
      </Card>
      <Card title="Members by ACTIVITY owner (who did the work in the period, grouped by the account's team)">
        <OwnerTable rows={data.activity_owners} openList={openList} kind="activity" th={th} />
      </Card>
      <Card title="Roster membership per team (TrackerAI roster pods, loaded live from the DB)">
        <div className="grid gap-3 md:grid-cols-4">
          {data.roster.map((r: any) => (
            <div key={r.team} className="rounded-lg border border-line p-2">
              <div className="text-xs font-semibold">{r.label} <span className="font-normal text-ink-subtle">· pod “{r.pod_key}”</span></div>
              {r.members.length === 0
                ? <div className="mt-1 text-[11px] text-warn">No active roster members in this pod.</div>
                : <ul className="mt-1 space-y-0.5 text-[11px] text-ink-muted">{r.members.map((m: any) => <li key={m.owner_id}>{m.name} <span className="text-ink-subtle">({m.kind.toUpperCase()})</span></li>)}</ul>}
            </div>
          ))}
        </div>
        <div className="mt-3"><Note>Roster pods describe who a rep reports into. They do not assign accounts: account team comes only from HubSpot Team Accounts. Mismatches are flagged in amber, never auto-corrected.</Note></div>
      </Card>
    </div>
  );
}

function Health({ data, th, openList, qs, openDetail }: P) {
  const t = data.total;
  const measure = (k: "c" | "r", title: string, dist: any, statuses: [string, string][]) => (
    <Card title={title}>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {statuses.map(([s, tone]) => (
          <Kpi key={s} label={statusLabel(s, th)} value={fmt(t[`${k}_${s}`])} tone={tone as any}
            onClick={() => openList(acc(`${k === "c" ? "Company" : "Rooftop"}: ${statusLabel(s, th)}`, `${k === "c" ? "cstatus" : "rstatus"}:${s}`))} />
        ))}
      </div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Days since last activity</div>
      <Bars rows={dist.buckets.map((b: any) => ({ key: b.label, label: `${b.label} days`, value: b.count }))} />
      <div className="mt-1 text-[11px] text-ink-subtle">No date: {fmt(dist.no_date)} · future-dated: {fmt(dist.future)}</div>
    </Card>
  );
  const cs = ["active", "inactive_60", "inactive_90", "no_activity", "needs_review"];
  const rs = ["active", "inactive_60", "inactive_90", "missing_date", "needs_review"];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {measure("c", "Company inactivity — HubSpot Last Activity Date", data.company_days, [["active", "good"], ["inactive_60", "warm"], ["inactive_90", "danger"], ["no_activity", "muted"], ["needs_review", "muted"]])}
        {measure("r", "Rooftop inactivity — Rooftop Last Activity", data.rooftop_days, [["active", "good"], ["inactive_60", "warm"], ["inactive_90", "danger"], ["missing_date", "muted"], ["needs_review", "muted"]])}
      </div>
      <Card title="Company status × rooftop status (accounts)">
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><TH>Company ↓ / Rooftop →</TH>{rs.map((s) => <TH key={s} right>{statusLabel(s, th)}</TH>)}</tr></thead>
            <tbody>{cs.map((c) => (
              <tr key={c} className="border-t border-line/60"><td className="px-2 py-1.5">{statusLabel(c, th)}</td>
                {rs.map((r) => <td key={r} className="px-2 py-1.5 text-right font-mono">{fmt(data.cross[c]?.[r] ?? 0)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
        <div className="mt-2"><Note>Two independent dates: a company can be active while its rooftop date is stale or missing (and vice versa). A missing date is never treated as 0 days or as “never contacted”.</Note></div>
      </Card>
      <Card title="Accounts — longest company inactivity first">
        <ListTable spec={{ view: "accounts", drill: "", title: "" }} qs={qs} th={th} onOpenAccount={openDetail} compact initialSort="company_days" initialDir="desc" />
      </Card>
    </div>
  );
}

function Activity({ data, th, openList, qs, openDetail }: P) {
  const t = data.total;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="Calls" value={fmt(t.calls)} sub="outbound" />
        <Kpi label="Connected" value={fmt(t.connected)} sub={`${pct(t.calls ? t.connected / t.calls : null)} of calls`} />
        <Kpi label="Emails" value={fmt(t.emails)} sub="outgoing" />
        <Kpi label="Meetings" value={fmt(t.meetings)} sub="meeting records" />
        <Kpi label="Touchpoints" value={fmt(t.touchpoints)} sub="calls + emails + meetings" />
        <Kpi label="Accounts contacted" value={fmt(t.contacted)} onClick={() => openList(acc("Accounts contacted in period", "contacted"))} />
        <Kpi label="Contacts reached" value={fmt(t.contacts_reached)} sub={`${fmt(t.contacts_touched)} touched`} />
        <Kpi label="Last touchpoint" value={etDay(t.last_touch_ms)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Accounts by touchpoints in period">
          <Bars rows={[["0", "Zero", t.touch_0], ["1", "One", t.touch_1], ["2", "Two or more", t.touch_2plus]].map(([k, l, v]) => ({ key: k as string, label: l as string, value: v as number }))}
            onClick={(k) => openList(acc(`Accounts with ${k === "2" ? "2+" : k} touchpoints`, `touch:${k}`))} />
        </Card>
        <Card title="Logged but not touchpoints" className="lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            <Kpi label="Notes" value={fmt(t.notes)} tone="muted" />
            <Kpi label="Tasks" value={fmt(t.tasks)} tone="muted" />
            <Kpi label="Meeting-booked call outcomes" value={fmt(t.meeting_disposition_calls)} tone="muted" sub="call disposition, not a meeting record" />
          </div>
          <div className="mt-2"><Note>Connected = the dashboard&apos;s 11 connected call dispositions. Each activity counts once per account even if it is linked directly and through a contact; totals de-duplicate by activity ID.</Note></div>
        </Card>
      </div>
      <Card title="By team (account's assigned team)"><TeamTable rows={data.teams} total={t} openList={openList} th={th} mode="activity" /></Card>
      <Card title="By activity owner (roster pod shown — not the account team)"><OwnerTable rows={data.activity_owners} openList={openList} kind="activity" th={th} /></Card>
      <Card title="Activity log (team / rep timeline — use Team and Team member filters)">
        <ListTable spec={{ view: "activities", drill: "", title: "" }} qs={qs} th={th} onOpenAccount={openDetail} compact />
      </Card>
    </div>
  );
}

function IcpRowCells({ r, openList, extra }: { r: any; openList: Open; extra?: Record<string, string> }) {
  const d = (key: string, title: string) => () => openList(acc(`${r.name} · ${title}`, key, extra));
  return (
    <>
      <Num v={r.total_icp} onClick={d("icp:yes", "ICP accounts")} />
      <Num v={r.contacted} onClick={d("icp_contacted", "ICP contacted")} />
      <Num v={r.not_contacted} onClick={d("icp_not_contacted", "ICP not contacted")} />
      <Num v={r.inactive_60plus} onClick={d("icp_inactive:60", "ICP inactive")} />
      <Num v={r.inactive_90} onClick={d("icp_inactive:90", "ICP deep inactive")} />
      <Num v={r.calls} /><Num v={r.connected} /><Num v={r.emails} /><Num v={r.meetings} /><Num v={r.demos_booked} />
      <td className="px-2 py-1.5 text-right font-mono">{pct(r.coverage)}</td>
      <td className="px-2 py-1.5 text-right font-mono" title={`${r.contacts_touched} of ${r.contacts_at_icp} contacts`}>{pct(r.contact_coverage)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{pct(r.meeting_rate)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{pct(r.demo_rate)}</td>
    </>
  );
}

const IcpHead = ({ first, th }: { first: string; th: Th }) => (
  <tr><TH>{first}</TH><TH right>ICP accts</TH><TH right>Contacted</TH><TH right>Not contacted</TH><TH right>Inact {th.inact}+</TH><TH right>Inact {th.deep}+</TH>
    <TH right>Calls</TH><TH right>Conn.</TH><TH right>Emails</TH><TH right>Mtgs</TH><TH right>Demos</TH><TH right>Acct coverage</TH><TH right>Contact coverage</TH><TH right>Mtg rate</TH><TH right>Demo rate</TH></tr>
);

function Icp({ data, th, openList }: P) {
  const a = data.all;
  const cross = data.contact_icp_cross;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="ICP accounts" value={fmt(a.total_icp)} onClick={() => openList(acc("ICP accounts", "icp:yes"))} />
        <Kpi label="ICP contacted" value={fmt(a.contacted)} tone="good" onClick={() => openList(acc("ICP accounts contacted", "icp_contacted"))} />
        <Kpi label="ICP not contacted" value={fmt(a.not_contacted)} tone="warm" onClick={() => openList(acc("ICP accounts not contacted", "icp_not_contacted"))} />
        <Kpi label={`ICP inactive ${th.inact}+`} value={fmt(a.inactive_60plus)} tone="warm" onClick={() => openList(acc("ICP inactive", "icp_inactive:60"))} />
        <Kpi label={`ICP inactive ${th.deep}+`} value={fmt(a.inactive_90)} tone="danger" onClick={() => openList(acc("ICP deep inactive", "icp_inactive:90"))} />
        <Kpi label="Account coverage" value={pct(a.coverage)} sub="ICP contacted ÷ ICP accounts" />
        <Kpi label="Contact coverage" value={pct(a.contact_coverage)} sub={`${fmt(a.contacts_touched)} of ${fmt(a.contacts_at_icp)} contacts`} />
        <Kpi label="Demo booking rate" value={pct(a.demo_rate)} sub="ICP accts w/ demo ÷ ICP contacted" />
      </div>
      <Note>
        ICP = the company property <b>ICP</b> (yes / no / empty) — never inferred. “Contacted” = at least one outbound call, outgoing email or meeting
        on the account or its associated contacts within the reporting period. Contact-level ICP (<b>ICP/Non-ICP</b> on the contact) is reported separately below.
      </Note>
      <Card title="ICP coverage by team">
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="border-b border-line"><IcpHead first="Team" th={th} /></thead>
          <tbody>{data.teams.map((r: any) => <tr key={r.key} className="border-b border-line/60"><td className="px-2 py-1.5">{r.name}</td><IcpRowCells r={r} openList={openList} extra={{ teams: r.key }} /></tr>)}</tbody></table></div>
      </Card>
      <Card title="ICP coverage by account owner">
        <div className="max-h-[480px] overflow-auto"><table className="w-full text-xs"><thead className="sticky top-0 border-b border-line bg-surface"><IcpHead first="Account owner · team" th={th} /></thead>
          <tbody>{data.account_owners.map((r: any) => {
            const [team, owner] = r.key.split("|");
            return <tr key={r.key} className="border-b border-line/60"><td className="px-2 py-1.5">{r.name} <span className="text-ink-subtle">· {team}</span></td><IcpRowCells r={r} openList={openList} extra={{ teams: team, owner }} /></tr>;
          })}</tbody></table></div>
      </Card>
      <Card title="ICP work by activity owner">
        <table className="w-full text-xs"><thead className="border-b border-line"><tr><TH>Activity owner</TH><TH right>ICP accts touched</TH><TH right>Calls</TH><TH right>Connected</TH><TH right>Emails</TH><TH right>Meetings</TH><TH right>Contacts touched</TH></tr></thead>
          <tbody>{data.activity_owners.map((r: any) => (
            <tr key={r.owner_id} className="border-b border-line/60"><td className="px-2 py-1.5">{r.name}</td>
              <Num v={r.icp_accounts_touched} onClick={() => openList(acc(`${r.name} · ICP accounts touched`, "icp_contacted", { member: r.owner_id }))} />
              <Num v={r.calls} /><Num v={r.connected} /><Num v={r.emails} /><Num v={r.meetings} /><Num v={r.contacts_touched} /></tr>
          ))}</tbody></table>
      </Card>
      <Card title="Contact ICP vs company ICP (distinct contacts at the filtered accounts)">
        <table className="text-xs"><thead><tr><TH>Company ICP ↓ / Contact ICP →</TH><TH right>ICP</TH><TH right>Non-ICP</TH><TH right>Not set</TH></tr></thead>
          <tbody>{(["yes", "no", "unknown"] as const).map((k) => (
            <tr key={k} className="border-t border-line/60"><td className="px-2 py-1.5">{ICP_LABEL[k]}</td>
              {(["yes", "no", "unknown"] as const).map((c) => <td key={c} className="px-2 py-1.5 text-right font-mono">{fmt(cross[k][c])}</td>)}</tr>
          ))}</tbody></table>
      </Card>
    </div>
  );
}

function Meetings({ data, th, openList }: P) {
  const t = data.total; const i = data.icp; const r = data.rates;
  const mtgOutcomeKnown = t.meetings - t.meetings_no_outcome;
  const split = (rows: any[], label: (k: string) => string) => (
    <table className="w-full text-xs"><thead className="border-b border-line"><tr><TH>Segment</TH><TH right>Accounts</TH><TH right>Contacted</TH><TH right>Meetings</TH><TH right>Accts w/ mtg</TH><TH right>Demos booked</TH><TH right>Demos done</TH><TH right>Accts w/ demo</TH><TH right>Mtg rate</TH><TH right>Demo rate</TH></tr></thead>
      <tbody>{rows.map((x) => (
        <tr key={x.key ?? x.team} className="border-b border-line/60"><td className="px-2 py-1.5">{label(x.key ?? x.team) ?? x.label}</td>
          <Num v={x.t.accounts} /><Num v={x.t.contacted} /><Num v={x.t.meetings} /><Num v={x.t.accounts_with_meeting} /><Num v={x.t.demos_booked} /><Num v={x.t.demos_completed} /><Num v={x.t.accounts_with_demo} />
          <td className="px-2 py-1.5 text-right font-mono">{pct(x.t.contacted ? x.t.accounts_with_meeting / x.t.contacted : null)}</td>
          <td className="px-2 py-1.5 text-right font-mono">{pct(x.t.contacted ? x.t.accounts_with_demo / x.t.contacted : null)}</td></tr>
      ))}</tbody></table>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Demos booked" value={fmt(t.demos_booked)} sub="deals entering Discovery Call Done" />
        <Kpi label="Demos completed" value={fmt(t.demos_completed)} tone="good" sub="first Demo Done / Accepted / In Discussion" />
        <Kpi label="Meetings (records)" value={fmt(t.meetings)} sub={`${fmt(t.meetings_no_outcome)} with no outcome recorded`} />
        <Kpi label="Meetings completed" value={mtgOutcomeKnown ? fmt(t.meetings_completed) : "n/a"} tone="good" sub={mtgOutcomeKnown ? `of ${fmt(mtgOutcomeKnown)} with an outcome` : "outcome not recorded in HubSpot"} />
        <Kpi label="Cancelled / no-show" value={mtgOutcomeKnown ? `${fmt(t.meetings_canceled)} / ${fmt(t.meetings_no_show)}` : "n/a"} tone="muted" sub={`${fmt(t.meetings_rescheduled)} rescheduled`} />
        <Kpi label="Meeting-booked calls" value={fmt(t.meeting_disposition_calls)} tone="muted" sub="call disposition Meeting Scheduled/Rescheduled" />
        <Kpi label="Accounts with meetings" value={fmt(t.accounts_with_meeting)} onClick={() => openList(acc("Accounts with meetings", "with_meeting"))} />
        <Kpi label="Accounts with demos" value={fmt(t.accounts_with_demo)} onClick={() => openList(acc("Accounts with demos booked", "with_demo"))} />
        <Kpi label="Meeting booking rate" value={pct(r.meeting_booking)} sub="accts w/ meeting ÷ accts contacted" />
        <Kpi label="Demo booking rate" value={pct(r.demo_booking)} sub="accts w/ demo booked ÷ accts contacted" />
        <Kpi label="ICP accts w/ meetings" value={fmt(i.accounts_with_meeting)} onClick={() => openList(acc("ICP accounts with meetings", "icp_with_meeting"))} />
        <Kpi label="ICP accts w/ demos" value={fmt(i.accounts_with_demo)} onClick={() => openList(acc("ICP accounts with demos", "icp_with_demo"))} />
        <Kpi label="ICP contacted, no meeting" value={fmt(data.icp_contacted_no_meeting)} tone="warm" onClick={() => openList(acc("ICP contacted without meetings", "icp_contacted_no_meeting"))} />
        <Kpi label="ICP contacted, no demo" value={fmt(data.icp_contacted_no_demo)} tone="warm" onClick={() => openList(acc("ICP contacted without demos", "icp_contacted_no_demo"))} />
        <Kpi label="ICP not contacted" value={fmt(data.icp_not_contacted)} tone="danger" onClick={() => openList(acc("ICP not contacted", "icp_not_contacted"))} />
        <Kpi label="ICP demo booking rate" value={pct(r.icp_demo_booking)} sub={`ICP meeting rate ${pct(r.icp_meeting_booking)}`} />
      </div>
      <Note tone={t.meetings && t.meetings_no_outcome / t.meetings > 0.5 ? "warn" : "muted"}>
        Period {periodLabel(data.meta)}. Activity-record counts (meetings, demos) count records; “Accounts with …” count unique accounts.
        A scheduled meeting is never counted as completed, and a booked demo never as a completed demo. Meeting outcome comes from HubSpot&apos;s
        Meeting outcome field{t.meetings ? ` — ${fmt(t.meetings_no_outcome)} of ${fmt(t.meetings)} meetings in this view have no outcome recorded, so completed/cancelled counts understate reality` : ""}.
      </Note>
      <Card title="By team">{split(data.by_team, (k) => k)}</Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="By account type">{split(data.by_type, (k) => TYPE_LABEL[k])}</Card>
        <Card title="By company ICP">{split(data.by_icp, (k) => ICP_LABEL[k])}</Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Meetings by activity owner">
          <table className="w-full text-xs"><thead className="border-b border-line"><tr><TH>Owner</TH><TH right>Meetings</TH><TH right>Mtg-booked calls</TH><TH right>Accts</TH></tr></thead>
            <tbody>{data.by_activity_owner.map((x: any) => <tr key={x.owner_id} className="border-b border-line/60"><td className="px-2 py-1.5">{x.name}</td><Num v={x.t.meetings} /><Num v={x.t.meeting_disposition_calls} /><Num v={x.t.contacted} /></tr>)}</tbody></table>
        </Card>
        <Card title="Demos by SDR (deal sdr_owner)">
          <table className="w-full text-xs"><thead className="border-b border-line"><tr><TH>SDR</TH><TH right>Booked</TH><TH right>Completed</TH></tr></thead>
            <tbody>{data.demos_by_sdr.map((x: any) => <tr key={x.owner_id} className="border-b border-line/60"><td className="px-2 py-1.5">{x.name}</td><Num v={x.booked} /><Num v={x.completed} /></tr>)}</tbody></table>
        </Card>
        <Card title="Demos by AE (deal owner)">
          <table className="w-full text-xs"><thead className="border-b border-line"><tr><TH>AE</TH><TH right>Booked</TH><TH right>Completed</TH></tr></thead>
            <tbody>{data.demos_by_ae.map((x: any) => <tr key={x.owner_id} className="border-b border-line/60"><td className="px-2 py-1.5">{x.name}</td><Num v={x.booked} /><Num v={x.completed} /></tr>)}</tbody></table>
        </Card>
      </div>
      <div className="text-[11px] text-ink-subtle">Inactivity thresholds in effect: {th.inact}/{th.deep} days.</div>
    </div>
  );
}

function Contacts({ data, th, qs, openDetail }: P) {
  const e = data.engagement;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
        <Kpi label="Engaged" value={fmt(e.engaged)} tone="good" sub="connected call, meeting or email reply" />
        <Kpi label="Touched only" value={fmt(e.touched)} sub="outbound touch, no engagement" />
        <Kpi label="Not touched" value={fmt(e.not_touched)} tone="muted" sub="in the reporting period" />
      </div>
      <Note>Drill path: Team → member (filters) → account (click company) → contact → timeline (inside the account view, click a contact). Contact owner and contact ICP are the contact&apos;s own HubSpot fields; account owner and company ICP come from the company.</Note>
      <Card title="Contacts at the filtered accounts">
        <ListTable spec={{ view: "contacts", drill: "", title: "" }} qs={qs} th={th} onOpenAccount={openDetail} />
      </Card>
    </div>
  );
}

function Quality({ data, openList }: P) {
  const recon = data.reconciliation as any[];
  return (
    <div className="space-y-4">
      <Card title="Data-quality findings (country filter lifted — missing country is itself a finding)">
        <table className="w-full text-xs"><thead className="border-b border-line"><tr><TH>Check</TH><TH right>Accounts</TH><TH>What it means</TH></tr></thead>
          <tbody>{data.checks.map((c: any) => (
            <tr key={c.key} className="border-b border-line/60">
              <td className="px-2 py-1.5 font-medium">{c.label}</td>
              <Num v={c.count} onClick={() => openList(acc(c.label, `dq:${c.key}`, { country: "all" }))} />
              <td className="px-2 py-1.5 text-ink-muted">{c.detail}</td>
            </tr>
          ))}</tbody></table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Why accounts are Unknown / Needs Review">
          <Bars rows={data.unknown_type_reasons.map((r: any) => ({ key: r.reason, label: r.reason, value: r.count, tone: "bg-warn" }))}
            onClick={(k) => openList(acc(`Unknown: ${k}`, `unknown_reason:${encodeURIComponent(k)}`, { country: "all" }))} />
        </Card>
        <Card title="Other gaps">
          <ul className="space-y-1 text-xs">
            <li>Contacts without contact-level ICP: <b className="font-mono">{fmt(data.contact_icp_unset)}</b> of {fmt(data.contacts_total)}</li>
            <li>Meetings with no outcome recorded: <b className="font-mono">{fmt(data.meetings_no_outcome)}</b> of {fmt(data.meetings_total)}</li>
            {data.meta.excluded_teams.map((x: any) => <li key={x.team}>Team Accounts “{x.team}” (out of scope): <b className="font-mono">{fmt(x.hubspot)}</b> companies, not included</li>)}
            {data.roster_not_in_hubspot && data.roster_not_in_hubspot.length > 0 && (
              <li className="text-warn">Roster owner IDs not found among HubSpot owners ({data.roster_not_in_hubspot.length}): {data.roster_not_in_hubspot.map((r: any) => `${r.name} (${r.owner_id})`).join(", ")}</li>
            )}
          </ul>
        </Card>
      </div>
      <Card title="Sync reconciliation (HubSpot vs stored, checked at sync time)">
        {recon.length === 0 ? <Note tone="warn">No reconciliation recorded yet — the sync has not completed.</Note> : (
          <table className="w-full text-xs"><thead className="border-b border-line"><tr><TH>Check</TH><TH>Team</TH><TH right>HubSpot</TH><TH right>Stored</TH><TH>Result</TH><TH>Note</TH></tr></thead>
            <tbody>{recon.map((r, i) => (
              <tr key={i} className="border-b border-line/60"><td className="px-2 py-1.5 font-mono">{r.check}</td><td className="px-2 py-1.5">{r.team ?? "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.hubspot)}</td><td className="px-2 py-1.5 text-right font-mono">{fmt(r.stored)}</td>
                <td className={cn("px-2 py-1.5 font-semibold", r.ok ? "text-good" : "text-warn")}>{r.ok ? "✓ match" : "✗ mismatch"}</td><td className="px-2 py-1.5 text-ink-muted">{r.note ?? ""}</td></tr>
            ))}</tbody></table>
        )}
        <div className="mt-2 text-[11px] text-ink-subtle">Sync counts: {Object.entries(data.sync_counts).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</div>
      </Card>
    </div>
  );
}

export function TabBody(p: P & { tab: string }) {
  switch (p.tab) {
    case "summary": return <Summary {...p} />;
    case "teams": return <Teams {...p} />;
    case "health": return <Health {...p} />;
    case "activity": return <Activity {...p} />;
    case "icp": return <Icp {...p} />;
    case "meetings": return <Meetings {...p} />;
    case "contacts": return <Contacts {...p} />;
    case "quality": return <Quality {...p} />;
    default: return null;
  }
}
