/** Accounts Overview colour tones. Literal class strings only — Tailwind's JIT purges classes built
 *  at runtime (`text-${x}`), so every tone spells its classes out in full. Mid-range (-500) hues on
 *  low-alpha tints read on both the light and the dark theme. */
export type Tone = "indigo" | "violet" | "emerald" | "amber" | "sky" | "rose" | "slate" | "orange" | "teal";

/** How much colour the page uses: "subtle" (white cards, colour only in dots and chips), "balanced"
 *  (white cards with a coloured top edge + coloured numbers, faint background) or "vivid" (tinted
 *  cards, animated gradient header and background). */
export type Look = "subtle" | "balanced" | "vivid";
export const LOOK = "balanced" as Look; // user's choice (2026-10-19) after comparing all three

/** Soft coloured shadow behind a card, and a lift + stronger shadow on hover. */
const LIFT: Record<Tone, string> = {
  indigo: "shadow-[0_6px_18px_-8px_rgba(99,102,241,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(99,102,241,0.55)]",
  violet: "shadow-[0_6px_18px_-8px_rgba(139,92,246,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(139,92,246,0.55)]",
  emerald: "shadow-[0_6px_18px_-8px_rgba(16,185,129,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(16,185,129,0.55)]",
  amber: "shadow-[0_6px_18px_-8px_rgba(245,158,11,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(245,158,11,0.55)]",
  sky: "shadow-[0_6px_18px_-8px_rgba(14,165,233,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(14,165,233,0.55)]",
  rose: "shadow-[0_6px_18px_-8px_rgba(244,63,94,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(244,63,94,0.55)]",
  slate: "shadow-[0_6px_18px_-8px_rgba(100,116,139,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(100,116,139,0.55)]",
  orange: "shadow-[0_6px_18px_-8px_rgba(249,115,22,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(249,115,22,0.55)]",
  teal: "shadow-[0_6px_18px_-8px_rgba(20,184,166,0.40)] hover:shadow-[0_14px_30px_-10px_rgba(20,184,166,0.55)]",
};
/** Shared hover motion for every card. */
export const LIFT_MOTION = "transition duration-200 ease-out hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** White card with a coloured top edge (balanced look). */
const TOP: Record<Tone, string> = {
  indigo: "border-t-indigo-500", violet: "border-t-violet-500", emerald: "border-t-emerald-500", amber: "border-t-amber-500",
  sky: "border-t-sky-500", rose: "border-t-rose-500", slate: "border-t-slate-400", orange: "border-t-orange-500", teal: "border-t-teal-500",
};

const VIVID: Record<Tone, { card: string; text: string; ring: string; soft: string; dot: string; bar: string; lift?: string }> = {
  indigo: { card: "border-indigo-500/25 bg-gradient-to-br from-indigo-500/[0.16] via-indigo-500/[0.06] to-surface", text: "text-indigo-500", ring: "border-indigo-500 ring-2 ring-indigo-500/30", soft: "bg-indigo-500/10 text-indigo-500", dot: "bg-indigo-500", bar: "from-indigo-500 to-violet-500" },
  violet: { card: "border-violet-500/25 bg-gradient-to-br from-violet-500/[0.16] via-violet-500/[0.06] to-surface", text: "text-violet-500", ring: "border-violet-500 ring-2 ring-violet-500/30", soft: "bg-violet-500/10 text-violet-500", dot: "bg-violet-500", bar: "from-violet-500 to-fuchsia-500" },
  emerald: { card: "border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.16] via-emerald-500/[0.06] to-surface", text: "text-emerald-500", ring: "border-emerald-500 ring-2 ring-emerald-500/30", soft: "bg-emerald-500/10 text-emerald-500", dot: "bg-emerald-500", bar: "from-emerald-500 to-teal-400" },
  amber: { card: "border-amber-500/25 bg-gradient-to-br from-amber-500/[0.18] via-amber-500/[0.06] to-surface", text: "text-amber-500", ring: "border-amber-500 ring-2 ring-amber-500/30", soft: "bg-amber-500/10 text-amber-500", dot: "bg-amber-500", bar: "from-amber-500 to-orange-400" },
  sky: { card: "border-sky-500/25 bg-gradient-to-br from-sky-500/[0.16] via-sky-500/[0.06] to-surface", text: "text-sky-500", ring: "border-sky-500 ring-2 ring-sky-500/30", soft: "bg-sky-500/10 text-sky-500", dot: "bg-sky-500", bar: "from-sky-500 to-cyan-400" },
  rose: { card: "border-rose-500/25 bg-gradient-to-br from-rose-500/[0.16] via-rose-500/[0.06] to-surface", text: "text-rose-500", ring: "border-rose-500 ring-2 ring-rose-500/30", soft: "bg-rose-500/10 text-rose-500", dot: "bg-rose-500", bar: "from-rose-500 to-pink-400" },
  slate: { card: "border-slate-500/25 bg-gradient-to-br from-slate-500/[0.14] via-slate-500/[0.05] to-surface", text: "text-slate-500", ring: "border-slate-500 ring-2 ring-slate-500/30", soft: "bg-slate-500/10 text-slate-500", dot: "bg-slate-500", bar: "from-slate-500 to-slate-400" },
  orange: { card: "border-orange-500/25 bg-gradient-to-br from-orange-500/[0.16] via-orange-500/[0.06] to-surface", text: "text-orange-500", ring: "border-orange-500 ring-2 ring-orange-500/30", soft: "bg-orange-500/10 text-orange-500", dot: "bg-orange-500", bar: "from-orange-500 to-amber-400" },
  teal: { card: "border-teal-500/25 bg-gradient-to-br from-teal-500/[0.16] via-teal-500/[0.06] to-surface", text: "text-teal-500", ring: "border-teal-500 ring-2 ring-teal-500/30", soft: "bg-teal-500/10 text-teal-500", dot: "bg-teal-500", bar: "from-teal-500 to-emerald-400" },
};

export const TONE: typeof VIVID = Object.fromEntries(Object.entries(VIVID).map(([k, v]) => [k, {
  ...v,
  card: LOOK === "vivid" ? v.card : LOOK === "balanced" ? `border-line border-t-[3px] ${TOP[k as Tone]} bg-surface` : "border-line bg-surface",
  text: LOOK === "subtle" ? "text-ink" : v.text,
  lift: `${LIFT[k as Tone]} ${LIFT_MOTION}`,
}])) as typeof VIVID;

/** One colour per team, used on its card, chips, avatars and table rows. */
export const TEAM_TONE: Record<string, Tone> = { Neelima: "violet", Prince: "sky", Saarthak: "emerald", Central: "amber" };
export const teamTone = (team: string | null | undefined): Tone => (team && TEAM_TONE[team]) || "slate";

/** Account-list cards. */
export const CARD_TONE: Record<string, Tone> = {
  "": "indigo", "type:group": "violet", "type:single_franchise": "emerald", "type:independent": "amber",
  "cstatus:active": "teal", "cstatus:inactive_60plus": "rose", "cstatus:no_activity": "slate", never_contacted: "orange",
};
