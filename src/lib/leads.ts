// Simple sales pipeline for prospects. A lead is just a name, some numbers, a
// status and a free-text notes blob. Follow-up reminders are written *inside*
// the notes using @-dates (e.g. "call back @tomorrow" or "@22-08-2026 send
// quote") and parsed back out — see parseFollowups below.
export const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number]["value"];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = Object.fromEntries(
  LEAD_STATUSES.map((s) => [s.value, s.label])
) as Record<LeadStatus, string>;

export function isValidStatus(s: unknown): s is LeadStatus {
  return typeof s === "string" && LEAD_STATUSES.some((x) => x.value === s);
}

export const STATUS_BADGE: Record<LeadStatus, string> = {
  new: "bg-gray-100 text-gray-700",
  contacted: "bg-amber-50 text-amber-700",
  won: "bg-emerald-50 text-emerald-700",
  lost: "bg-rose-50 text-rose-700",
};

// --- follow-up parsing ------------------------------------------------------

export interface Followup {
  lineIndex: number; // which line of the notes this came from
  token: string; // the literal "@…" matched, so we can strip it later
  text: string; // the line with the @token removed
  date: string; // resolved YYYY-MM-DD
}

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => toISO(new Date());

// Build a YYYY-MM-DD string, rejecting impossible dates like 31-02.
function buildDate(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d)
    return null;
  return toISO(dt);
}

// Resolve a single date token (the bit after "@") to YYYY-MM-DD, or null if it
// isn't a date we understand. Supported: today, tomorrow, DD-MM-YYYY,
// DD/MM/YYYY, DD-MM (upcoming), and YYYY-MM-DD.
function resolveDateToken(raw: string): string | null {
  const t = raw.toLowerCase().replace(/[.,;:!?]+$/, ""); // drop trailing punctuation
  const now = new Date();

  if (t === "today") return todayISO();
  if (t === "tomorrow")
    return toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t); // ISO
  if (m) return buildDate(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t); // DD-MM-YYYY
  if (m) return buildDate(+m[3], +m[2], +m[1]);

  m = /^(\d{1,2})[-/](\d{1,2})$/.exec(t); // DD-MM → upcoming occurrence
  if (m) {
    const day = +m[1];
    const mon = +m[2];
    let iso = buildDate(now.getFullYear(), mon, day);
    if (iso && iso < todayISO()) iso = buildDate(now.getFullYear() + 1, mon, day);
    return iso;
  }

  return null;
}

// Scan a notes blob and pull out one follow-up per line that contains a valid
// @-date. The remaining words on that line become the reminder text.
export function parseFollowups(notes: string | null | undefined): Followup[] {
  if (!notes) return [];
  const out: Followup[] = [];
  notes.split("\n").forEach((line, lineIndex) => {
    const m = /@(\S+)/.exec(line);
    if (!m) return;
    const date = resolveDateToken(m[1]);
    if (!date) return;
    const token = m[0];
    const text = line.replace(token, "").replace(/\s+/g, " ").trim() || "Follow up";
    out.push({ lineIndex, token, text, date });
  });
  return out;
}

// Remove a follow-up's @-date from the notes (used to "complete" it) — keeps
// the surrounding text, just drops the date token so it stops being a reminder.
export function stripFollowup(notes: string, f: Followup): string {
  const lines = notes.split("\n");
  if (lines[f.lineIndex] !== undefined) {
    lines[f.lineIndex] = lines[f.lineIndex]
      .replace(f.token, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return lines.join("\n");
}
