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
  single_franchise: "Single Franchise", independent: "Single Independent", group: "Group Dealership", unknown: "Unknown",
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

export const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) =>
  <th className={cn("whitespace-nowrap px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle", right ? "text-right" : "text-left")}>{children}</th>;
