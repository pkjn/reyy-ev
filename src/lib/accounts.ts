// Accounts are now first-class DynamoDB rows (PK=ACCOUNT#<id>, SK=PROFILE).
// A rent payment lands in exactly one account and is projected into that
// account's ledger via GSI1 (GSI1PK=ACCOUNT#<id>); transfers move money
// between accounts as a pair of ledger rows. This file holds the pure types
// and math shared by the API routes and the accounts UI — no AWS imports, so
// it's safe to pull into client components.

// Ledger kinds that move money through an account.
//   payment        — rent collected into this account (credit)
//   deposit        — security deposit collected into this account (credit)
//   deposit_refund — refundable deposit returned to the customer (debit)
//   transfer_in    — money moved into this account from another (credit)
//   transfer_out   — money moved out of this account to another (debit)
//   withdrawal     — money taken out for an expense, e.g. a referral bonus (debit)
export const LEDGER_KINDS = [
  "payment",
  "deposit",
  "deposit_refund",
  "transfer_in",
  "transfer_out",
  "withdrawal",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export function isLedgerKind(s: unknown): s is LedgerKind {
  return (
    typeof s === "string" && (LEDGER_KINDS as readonly string[]).includes(s)
  );
}

// A normalised account-ledger row, whether it originated as a rent payment
// (projected in via GSI1) or as a transfer between accounts.
export interface AccountLedgerEntry {
  id: string;
  kind: LedgerKind;
  date: string; // YYYY-MM-DD
  amount: number;
  note: string | null;
  screenshot_url: string | null;
  // Payment context — populated for `payment` rows, null for transfers.
  customer_id: string | null;
  customer_name: string | null;
  rental_id: string | null;
  // The other account in a transfer — null for payments.
  counterparty_id: string | null;
  counterparty_name: string | null;
  // Groups entries collected in one real payment (deposit + start rent share
  // one receiptId), so the UI can show them as a single screenshot-backed line.
  receipt_id: string | null;
  created_at: string;
}

// Roll a ledger into credit / debit / balance using the same definitions the
// listing and detail screens share.
//   credits = payments in + deposits in + transfers in
//   debits  = deposit refunds out + transfers out
export function isCredit(kind: LedgerKind): boolean {
  return kind === "payment" || kind === "deposit" || kind === "transfer_in";
}

export function computeAccountBalance(
  entries: Pick<AccountLedgerEntry, "kind" | "amount">[]
): { credits: number; debits: number; balance: number } {
  let credits = 0;
  let debits = 0;
  for (const e of entries) {
    if (isCredit(e.kind)) credits += e.amount;
    else debits += e.amount;
  }
  return { credits, debits, balance: credits - debits };
}
