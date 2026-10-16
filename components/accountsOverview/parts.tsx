"use client";
/** Accounts Overview — small shared presentational pieces (built on components/ui primitives). */
import { cn, Surface } from "../ui";

export const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
export const pct = (r: number | null | undefined) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
export function etDay(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "2-digit" });
}
export function etTime(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export const TYPE_LABEL: Record<string, string> = {
  single_franchise: "Single Franchise", independent: "Independent", group: "Group Dealership", unknown: "Unknown / Needs Review",
};
export const ICP_LABEL: Record<string, string> = { yes: "ICP", no: "Non-ICP", unknown: "ICP unknown" };

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-good-weak text-good" },
  inactive_60: { label: "Inactive", cls: "bg-warm-weak text-warm" },
  inactive_90: { label: "Deep inactive", cls: "bg-danger-weak text-danger" },
  no_activity: { label: "No recorded activity", cls: "bg-surface-muted text-ink-muted" },
  missing_date: { label: "Missing date", cls: "bg-surface-muted text-ink-muted" },
  needs_review: { label: "Needs review", cls: "bg-warn-weak text-warn" },
};

/** Status labels carry the live thresholds ("Inactive 60–89d") so the chip never lies when the
 *  user changes them. */
export function statusLabel(s: string, th: { inact: number; deep: number }): string {
  if (s === "inactive_60") return `Inactive ${th.inact}+`;
  if (s === "inactive_90") return `Inactive ${th.deep}+`;
  return STATUS_META[s]?.label ?? s;
}

export function StatusChip({ s, th, days }: { s: string; th: { inact: number; deep: number }; days?: number | null }) {
  const m = STATUS_META[s] ?? STATUS_META.needs_review;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", m.cls)}>
      {statusLabel(s, th)}{days != null && s !== "needs_review" ? <span className="font-mono opacity-70">{days}d</span> : null}
    </span>
  );
}

/** KPI tile; clickable tiles open the matching filtered account list. */
export function Kpi({ label, value, sub, onClick, tone }: {
  label: string; value: string; sub?: React.ReactNode; onClick?: () => void; tone?: "good" | "warm" | "danger" | "muted";
}) {
  const accent = tone === "good" ? "border-l-good" : tone === "warm" ? "border-l-warm" : tone === "danger" ? "border-l-danger" : tone === "muted" ? "border-l-line" : "border-l-primary";
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-subtle">{label}</div>
      <div className="mt-1.5 font-mono text-[22px] font-bold leading-none tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] tabular-nums text-ink-muted">{sub}</div>}
    </>
  );
  const cls = cn("rounded-card border border-line border-l-4 bg-surface p-3 text-left shadow-card", accent);
  return onClick
    ? <button onClick={onClick} title="Open the matching accounts" className={cn(cls, "transition hover:border-primary/40 hover:bg-surface-muted/40")}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/** Single-series horizontal magnitude bars (one hue; values in text ink; hover = exact value). */
export function Bars({ rows, onClick }: { rows: { key: string; label: string; value: number; tone?: string }[]; onClick?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <button key={r.key} onClick={onClick ? () => onClick(r.key) : undefined} disabled={!onClick}
          title={`${r.label}: ${fmt(r.value)}${total ? ` (${((r.value / total) * 100).toFixed(1)}%)` : ""}`}
          className={cn("grid w-full grid-cols-[minmax(110px,180px)_1fr_64px] items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs", onClick && "hover:bg-surface-muted")}>
          <span className="truncate text-ink-muted">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-muted">
            <span className={cn("block h-full rounded-full", r.tone ?? "bg-primary")} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono tabular-nums text-ink">{fmt(r.value)}</span>
        </button>
      ))}
    </div>
  );
}

export function Card({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Surface className={cn("p-4", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">{title}</h3>
        {right}
      </div>
      {children}
    </Surface>
  );
}

export function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warn" }) {
  return (
    <p className={cn("rounded-lg px-3 py-2 text-[11px] leading-relaxed", tone === "warn" ? "bg-warn-weak text-warn" : "bg-surface-muted text-ink-muted")}>
      {children}
    </p>
  );
}

/** Compact numeric table cell that drills when clickable. */
export function Num({ v, onClick }: { v: number | null | undefined; onClick?: () => void }) {
  if (!onClick || !v) return <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(v)}</td>;
  return (
    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
      <button onClick={onClick} className="text-primary underline-offset-2 hover:underline">{fmt(v)}</button>
    </td>
  );
}

export const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) =>
  <th className={cn("whitespace-nowrap px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle", right ? "text-right" : "text-left")}>{children}</th>;
