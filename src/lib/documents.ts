// Documents are a standalone vault — bills, GST certificates, cheques,
// photos, signed papers: anything worth keeping a copy of. They deliberately
// do NOT link to customers/rentals/vehicles; a document stands on its own and
// is found by category, party and date.
//
// One DynamoDB row per document (PK=DOC#<id>, SK=PROFILE), listed under
// GSI1PK=DOCUMENTS with GSI1SK=<docDate>#<id> so the whole vault comes back in
// document-date order from one query — no scan, no per-file rows. The scanned
// files live inline on the row as a `files` array (fileId + s3Key), which
// keeps "one document, several pages" a single read and a single delete.
//
// GST tracking is kept light on purpose: a bill records what it totalled and
// how much GST sat inside it, plus whether that input tax credit has been
// claimed and in which return period. No CGST/SGST/IGST split — the scanned
// bill is the record of truth for anything finer.
//
// Pure types and helpers only (no AWS imports) so this file is safe to import
// into client components. Server-side reads live in `documentsStore.ts`.

// One uploaded file belonging to a document. `url` is a short-lived presigned
// GET link, filled in by the API — it is never stored.
export interface DocumentFile {
  id: string;
  name: string; // original filename, e.g. "ather-invoice-jul.pdf"
  content_type: string;
  url: string | null;
}

export interface DocumentRecord {
  id: string;
  title: string;
  category: string; // free text; DOCUMENT_CATEGORIES are just suggestions
  vendor: string; // the other party — supplier, issuer, payee
  doc_date: string; // YYYY-MM-DD, the date printed on the document
  ref_number: string; // invoice / cheque / certificate number
  amount: number | null; // total on the bill incl. GST; null = not recorded
  gst_amount: number | null; // GST inside that total; null = none / not recorded
  gst_claimed: boolean;
  gst_claim_period: string | null; // YYYY-MM the credit was claimed in
  gst_claimed_on: string | null; // ISO timestamp it was ticked off
  notes: string;
  files: DocumentFile[];
  created_at: string;
  updated_at: string;
}

// Suggestions offered in the category box — free text is still accepted, so
// anything not listed here can be filed without a code change.
export const DOCUMENT_CATEGORIES = [
  "Bill / Invoice",
  "GST certificate",
  "GST return",
  "Cheque",
  "Photo",
  "Signature",
  "Agreement",
  "Registration",
  "Insurance",
  "Other",
] as const;

// A document only participates in GST tracking once a GST amount is on it:
// "none" means there is nothing to claim, so no claim badge is shown.
export type GstStatus = "claimed" | "pending" | "none";

export function gstStatus(doc: {
  amount?: number | null;
  gst_amount: number | null;
  gst_claimed: boolean;
}): GstStatus {
  if (!doc.gst_amount) return "none";
  return doc.gst_claimed ? "claimed" : "pending";
}

export function isDocDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// GST return periods are month-granular: "2026-07" = the July 2026 return.
export function isClaimPeriod(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

// "2026-07" → "Jul 2026". Returns the input unchanged if it isn't a period.
export function formatPeriod(period: string | null): string {
  if (!isClaimPeriod(period)) return period || "";
  const [year, month] = period.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

// Money coming off a form arrives as a string. Empty means "not recorded"
// (null); anything that isn't a non-negative number comes back as NaN so the
// caller can reject it — `Number.isNaN` is false for null, so a single check
// separates the three cases.
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n =
    typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}

// Map a raw DynamoDB item to the API shape. File `url`s come back null — the
// server hydrates them with presigned links (see documentsStore.hydrate).
export function toDocumentRecord(item: Record<string, unknown>): DocumentRecord {
  const files = Array.isArray(item.files)
    ? (item.files as Record<string, unknown>[])
    : [];
  return {
    id: item.docId as string,
    title: (item.title as string) || "",
    category: (item.category as string) || "Other",
    vendor: (item.vendor as string) || "",
    doc_date: (item.docDate as string) || "",
    ref_number: (item.refNumber as string) || "",
    amount: typeof item.amount === "number" ? item.amount : null,
    gst_amount: typeof item.gstAmount === "number" ? item.gstAmount : null,
    gst_claimed: Boolean(item.gstClaimed),
    gst_claim_period: (item.gstClaimPeriod as string) || null,
    gst_claimed_on: (item.gstClaimedOn as string) || null,
    notes: (item.notes as string) || "",
    files: files.map((f) => ({
      id: f.fileId as string,
      name: (f.originalName as string) || "file",
      content_type: (f.contentType as string) || "",
      url: null,
    })),
    created_at: (item.createdAt as string) || "",
    updated_at: (item.updatedAt as string) || (item.createdAt as string) || "",
  };
}

// Totals for the GST ledger shown above the list: what's on record, what has
// been claimed, and what is still waiting to be claimed.
export function summariseGst(docs: DocumentRecord[]): {
  total: number;
  claimed: number;
  pending: number;
  pending_count: number;
} {
  let claimed = 0;
  let pending = 0;
  let pendingCount = 0;
  for (const d of docs) {
    const gst = d.gst_amount || 0;
    if (!gst) continue;
    if (d.gst_claimed) {
      claimed += gst;
    } else {
      pending += gst;
      pendingCount += 1;
    }
  }
  return {
    total: claimed + pending,
    claimed,
    pending,
    pending_count: pendingCount,
  };
}
