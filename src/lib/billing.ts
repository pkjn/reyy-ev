export type RateUnit = "day" | "week" | "month";

export const RATE_UNITS: readonly RateUnit[] = ["day", "week", "month"];

export interface Payment {
  id: string;
  amount: number;
  paidOn: string; // YYYY-MM-DD
  account: string | null; // account id the payment was collected into
  accountName?: string | null; // denormalised account name for display
  receiptId?: string | null; // groups a combined deposit + start-rent payment
  note: string | null;
  screenshotUrl: string | null;
  createdAt: string;
}

// A span during which billing is frozen — the customer isn't charged and the
// days don't consume paid coverage. `end` is the resume date (the first day
// billed again, i.e. the span is half-open [start, end)); a null end means the
// rental is still paused.
export interface PauseInterval {
  start: string; // YYYY-MM-DD — first frozen day
  end: string | null; // YYYY-MM-DD resume date, or null while still paused
}

export interface Rental {
  id: string;
  customerId: string;
  customerName: string;
  scootyLabel: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // null = still active
  rate: number;
  rateUnit: RateUnit;
  securityDeposit: number;
  refundableDeposit: number;
  notes: string | null;
  pauses?: PauseInterval[]; // billing-frozen spans, chronological
  createdAt: string;
}

export type CoverageStatus = "paid" | "due_today" | "overdue";

export interface RentalBalances {
  daysBilled: number;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  // The last day the customer's payments cover. If they pay weekly rent on
  // Wed, paidThroughDate is the following Tue (7 days from start, inclusive).
  paidThroughDate: string | null;
  // Days of paid coverage from today: +N = N days left, 0 = today is last day,
  // -N = past the paid period by N days (BLOCK).
  daysRemaining: number;
  coverageStatus: CoverageStatus;
  status: "active" | "closed";
  // True while an open (unresolved) pause is in effect — billing is frozen.
  paused: boolean;
  pausedSince: string | null; // start date of the current open pause, if any
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseLocalDate(s);
  return !!d;
}

export function isValidRateUnit(s: unknown): s is RateUnit {
  return typeof s === "string" && (RATE_UNITS as readonly string[]).includes(s);
}

export function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const date = new Date(y, mo - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Read the pause history off a raw DDB item, tolerating legacy rows that never
// had one. Mirrors readScooties' defensive shape-mapping.
export function readPauses(item: Record<string, unknown>): PauseInterval[] {
  if (!Array.isArray(item.pauses)) return [];
  return (item.pauses as Record<string, unknown>[])
    .filter((p) => typeof p.start === "string")
    .map((p) => ({
      start: p.start as string,
      end: typeof p.end === "string" ? (p.end as string) : null,
    }));
}

// Is `d` (a local-midnight Date) inside any pause span? An open pause (end
// null) freezes every day from its start onward; a closed pause covers the
// half-open range [start, end) so the resume date itself is billed again.
function isPausedDay(d: Date, pauses: PauseInterval[]): boolean {
  const t = d.getTime();
  for (const p of pauses) {
    const ps = parseLocalDate(p.start);
    if (!ps || t < ps.getTime()) continue;
    if (p.end === null) return true;
    const pe = parseLocalDate(p.end);
    if (pe && t < pe.getTime()) return true;
  }
  return false;
}

// Count frozen days within the inclusive billing window [start, cutoff].
// Assumes pauses don't overlap each other (enforced on write).
function pausedDaysInWindow(
  start: Date,
  cutoff: Date,
  pauses: PauseInterval[],
): number {
  // Work in a half-open window [start, cutoff + 1 day) so the cutoff day counts.
  const winStart = start.getTime();
  const winEnd = cutoff.getTime() + MS_PER_DAY;
  let paused = 0;
  for (const p of pauses) {
    const ps = parseLocalDate(p.start);
    if (!ps) continue;
    const pStart = ps.getTime();
    // Open pause runs to the window's end; closed pause is half-open [start,end).
    const pEnd = p.end ? (parseLocalDate(p.end)?.getTime() ?? pStart) : winEnd;
    const s = Math.max(winStart, pStart);
    const e = Math.min(winEnd, pEnd);
    if (e > s) paused += Math.round((e - s) / MS_PER_DAY);
  }
  return paused;
}

// Calendar date of the `n`-th billable (non-frozen) day counting from start,
// 1-indexed. Returns null if `n` can't be reached — either n <= 0 or an open
// pause caps the billable days before we get there (surplus is banked, not
// tied to a date). The walk is bounded so bad data can't spin forever.
function billableDateFrom(
  startDate: string,
  n: number,
  pauses: PauseInterval[],
): string | null {
  const start = parseLocalDate(startDate);
  if (!start || n <= 0) return null;
  const cur = new Date(start);
  let count = 0;
  for (let i = 0; i < 20000; i++) {
    if (!isPausedDay(cur, pauses)) {
      count++;
      if (count === n) return formatLocalDate(cur);
    } else if (
      // Sitting inside an open pause — no further billable day will ever accrue.
      pauses.some(
        (p) => p.end === null && parseLocalDate(p.start)!.getTime() <= cur.getTime(),
      )
    ) {
      return null;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return null;
}

// Normalise weekly / monthly rates to a per-day amount so a single
// daysBilled × dailyRate multiplication covers every rate unit.
// Month = 30 days for billing simplicity.
export function perDayRate(rate: number, unit: RateUnit): number {
  if (unit === "day") return rate;
  if (unit === "week") return rate / 7;
  return rate / 30;
}

export function formatINR(n: number): string {
  const rounded = Math.round(n);
  return `₹${rounded.toLocaleString("en-IN")}`;
}

// Days billed = days elapsed since startDate, inclusive of the start day,
// capped at endDate when the rental is closed. Today still counts as a billed
// day once startDate has passed.
export function daysBilledOn(
  startDate: string,
  endDate: string | null,
  asOf: Date,
  pauses: PauseInterval[] = [],
): number {
  const start = parseLocalDate(startDate);
  if (!start) return 0;
  const end = endDate ? parseLocalDate(endDate) : null;
  const cutoff = end && end.getTime() < asOf.getTime() ? end : asOf;
  const cutoffMidnight = new Date(
    cutoff.getFullYear(),
    cutoff.getMonth(),
    cutoff.getDate(),
  );
  const diff =
    (cutoffMidnight.getTime() - start.getTime()) / MS_PER_DAY;
  if (diff < 0) return 0;
  const rawDays = Math.floor(diff) + 1;
  const frozen = pausedDaysInWindow(start, cutoffMidnight, pauses);
  return Math.max(0, rawDays - frozen);
}

export function computeRentalBalances(
  rental: Pick<
    Rental,
    "startDate" | "endDate" | "rate" | "rateUnit" | "pauses"
  >,
  payments: Pick<Payment, "amount">[],
  asOf: Date = new Date(),
): RentalBalances {
  const pauses = rental.pauses ?? [];
  const daysBilled = daysBilledOn(
    rental.startDate,
    rental.endDate,
    asOf,
    pauses,
  );
  const daily = perDayRate(rental.rate, rental.rateUnit);
  const totalBilled = daysBilled * daily;
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, totalBilled - totalPaid);
  const status: "active" | "closed" = rental.endDate ? "closed" : "active";
  const openPause = pauses.find((p) => p.end === null) ?? null;

  // Convert payments into a "paid through" date by treating the total paid as
  // a number of whole days at the day-rate. Floor so a partial day isn't
  // counted — we'd rather flag BLOCK a day early than a day late. With pauses,
  // those paid days are laid down onto the calendar skipping any frozen span.
  let paidThroughDate: string | null = null;
  let daysRemaining = 0;
  let coverageStatus: CoverageStatus = "due_today";

  const start = parseLocalDate(rental.startDate);
  if (start && daily > 0) {
    const paidDays = Math.floor(totalPaid / daily);
    paidThroughDate = billableDateFrom(rental.startDate, paidDays, pauses);
    const todayMidnight = new Date(
      asOf.getFullYear(),
      asOf.getMonth(),
      asOf.getDate(),
    );
    const startMidnight = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    );
    if (todayMidnight.getTime() < startMidnight.getTime()) {
      // Rental hasn't started yet — count the runway until it does (plus any
      // advance already paid), matching the pre-pause behaviour.
      daysRemaining =
        Math.round(
          (startMidnight.getTime() - todayMidnight.getTime()) / MS_PER_DAY,
        ) +
        paidDays -
        1;
    } else {
      // Billable days of coverage left: everything paid for, minus everything
      // billed so far. daysBilled already excludes frozen days, so a pause
      // neither eats coverage nor counts against the customer.
      daysRemaining = paidDays - daysBilled;
    }
    coverageStatus =
      daysRemaining > 0 ? "paid" : daysRemaining === 0 ? "due_today" : "overdue";
  }

  return {
    daysBilled,
    totalBilled: Math.round(totalBilled),
    totalPaid: Math.round(totalPaid),
    outstanding: Math.round(outstanding),
    paidThroughDate,
    daysRemaining,
    coverageStatus,
    status,
    paused: openPause !== null,
    pausedSince: openPause?.start ?? null,
  };
}
