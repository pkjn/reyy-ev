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
  return Math.floor(diff) + 1;
}

export function computeRentalBalances(
  rental: Pick<Rental, "startDate" | "endDate" | "rate" | "rateUnit">,
  payments: Pick<Payment, "amount">[],
  asOf: Date = new Date(),
): RentalBalances {
  const daysBilled = daysBilledOn(rental.startDate, rental.endDate, asOf);
  const daily = perDayRate(rental.rate, rental.rateUnit);
  const totalBilled = daysBilled * daily;
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, totalBilled - totalPaid);
  const status: "active" | "closed" = rental.endDate ? "closed" : "active";

  // Convert payments into a "paid through" date by treating the total paid as
  // a number of whole days at the day-rate. Floor so a partial day isn't
  // counted — we'd rather flag BLOCK a day early than a day late.
  let paidThroughDate: string | null = null;
  let daysRemaining = 0;
  let coverageStatus: CoverageStatus = "due_today";

  const start = parseLocalDate(rental.startDate);
  if (start && daily > 0) {
    const paidDays = Math.floor(totalPaid / daily);
    if (paidDays > 0) {
      const through = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + paidDays - 1,
      );
      paidThroughDate = formatLocalDate(through);
      const todayMidnight = new Date(
        asOf.getFullYear(),
        asOf.getMonth(),
        asOf.getDate(),
      );
      daysRemaining = Math.round(
        (through.getTime() - todayMidnight.getTime()) / MS_PER_DAY,
      );
    } else {
      // No paid days yet — overdue from the start.
      const todayMidnight = new Date(
        asOf.getFullYear(),
        asOf.getMonth(),
        asOf.getDate(),
      );
      daysRemaining = Math.round(
        (start.getTime() - todayMidnight.getTime()) / MS_PER_DAY,
      ) - 1;
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
  };
}
