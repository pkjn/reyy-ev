"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatINR, formatLocalDate } from "@/lib/billing";
import { AccountLedgerEntry, LedgerKind, isCredit } from "@/lib/accounts";

interface AccountDetail {
  id: string;
  name: string;
  created_at: string;
  entries: AccountLedgerEntry[];
  credits: number;
  debits: number;
  balance: number;
}

interface AccountOption {
  id: string;
  name: string;
}

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [allAccounts, setAllAccounts] = useState<AccountOption[]>([]);
  const [renameMode, setRenameMode] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  const fetchAccount = useCallback(async () => {
    const res = await fetch(`/api/accounts/${id}`);
    if (!res.ok) {
      router.push("/accounts");
      return;
    }
    setAccount(await res.json());
  }, [id, router]);

  const fetchAllAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) setAllAccounts(await res.json());
  }, []);

  useEffect(() => {
    fetchAccount();
    fetchAllAccounts();
  }, [fetchAccount, fetchAllAccounts]);

  const handleRename = async () => {
    if (!draftName.trim()) return;
    setSaving(true);
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draftName.trim() }),
    });
    setSaving(false);
    setRenameMode(false);
    fetchAccount();
    fetchAllAccounts();
  };

  const handleDeleteTransfer = async (entry: AccountLedgerEntry) => {
    if (entry.kind === "payment" || !entry.counterparty_id) return;
    if (!confirm("Delete this transfer? It will be removed from both accounts."))
      return;
    // Resolve the two sides relative to which direction this row represents.
    const fromId = entry.kind === "transfer_out" ? id : entry.counterparty_id;
    const toId = entry.kind === "transfer_out" ? entry.counterparty_id : id;
    const qs = new URLSearchParams({
      from_account_id: fromId,
      to_account_id: toId,
    });
    const res = await fetch(`/api/transfers/${entry.id}?${qs.toString()}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to delete");
      return;
    }
    fetchAccount();
  };

  const handleDeleteWithdrawal = async (entry: AccountLedgerEntry) => {
    if (!confirm("Delete this withdrawal?")) return;
    const res = await fetch(
      `/api/accounts/${id}/withdrawals/${entry.id}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to delete");
      return;
    }
    fetchAccount();
  };

  // Dispatch a ledger row's delete to the right handler by kind.
  const handleEntryDelete = (entry: AccountLedgerEntry) => {
    if (entry.kind === "withdrawal") handleDeleteWithdrawal(entry);
    else handleDeleteTransfer(entry);
  };

  if (!account) return <p className="text-gray-500">Loading...</p>;

  // Pre-compute a running balance so each line shows the account's state right
  // after that entry posted (entries arrive chronological).
  // Group entries collected in one payment (shared receipt_id) into a single
  // unit, then walk units to build a running balance — so a combined
  // deposit + rent shows as one line whose total matches its screenshot.
  const units: AccountLedgerEntry[][] = [];
  const seenReceipts = new Set<string>();
  for (const e of account.entries) {
    if (e.receipt_id) {
      if (seenReceipts.has(e.receipt_id)) continue;
      seenReceipts.add(e.receipt_id);
      units.push(account.entries.filter((x) => x.receipt_id === e.receipt_id));
    } else {
      units.push([e]);
    }
  }

  const rows = units.reduce<
    Array<{
      unit: AccountLedgerEntry[];
      debit: number;
      credit: number;
      balance: number;
    }>
  >((acc, unit) => {
    let credit = 0;
    let debit = 0;
    for (const e of unit) {
      if (isCredit(e.kind)) credit += e.amount;
      else debit += e.amount;
    }
    const prev = acc.length > 0 ? acc[acc.length - 1].balance : 0;
    acc.push({ unit, debit, credit, balance: prev + credit - debit });
    return acc;
  }, []);

  const otherAccounts = allAccounts.filter((a) => a.id !== id);

  return (
    <div>
      <Link
        href="/accounts"
        className="text-sm text-emerald-700 hover:text-emerald-900 mb-4 inline-block"
      >
        ← Back to accounts
      </Link>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        {renameMode ? (
          <div className="space-y-3">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Account name"
            />
            <div className="flex gap-2">
              <button
                onClick={handleRename}
                disabled={saving}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setRenameMode(false)}
                disabled={saving}
                className="text-sm text-gray-600 hover:text-gray-800 px-4 py-2"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Renaming only updates the account going forward. Past ledger
              entries keep the name recorded at the time they were added.
            </p>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{account.name}</h1>
              <p className="text-sm text-gray-500 mt-2">
                Added {new Date(account.created_at).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => {
                setDraftName(account.name);
                setRenameMode(true);
              }}
              className="text-sm text-emerald-700 hover:text-emerald-900 font-medium"
            >
              Rename
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Money in" value={formatINR(account.credits)} tone="green" />
        <StatCard label="Money out" value={formatINR(account.debits)} tone="red" />
        <StatCard
          label="Current balance"
          value={formatINR(account.balance)}
          tone={account.balance < 0 ? "red" : "emerald"}
        />
      </div>

      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="font-semibold text-lg">
          Ledger ({account.entries.length})
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowWithdraw(false);
              setShowTransfer((v) => !v);
            }}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
          >
            {showTransfer ? "Cancel" : "+ Transfer out"}
          </button>
          <button
            onClick={() => {
              setShowTransfer(false);
              setShowWithdraw((v) => !v);
            }}
            className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700"
          >
            {showWithdraw ? "Cancel" : "+ Withdraw"}
          </button>
        </div>
      </div>

      {showTransfer && (
        <TransferForm
          fromAccountId={id}
          fromAccountName={account.name}
          otherAccounts={otherAccounts}
          onCancel={() => setShowTransfer(false)}
          onSaved={() => {
            setShowTransfer(false);
            fetchAccount();
          }}
        />
      )}

      {showWithdraw && (
        <WithdrawForm
          accountId={id}
          accountName={account.name}
          onCancel={() => setShowWithdraw(false)}
          onSaved={() => {
            setShowWithdraw(false);
            fetchAccount();
          }}
        />
      )}

      {account.entries.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          <p className="text-sm">No payments or transfers yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-3 py-2">Date</th>
                <th className="text-left font-medium px-3 py-2">Type</th>
                <th className="text-left font-medium px-3 py-2">Detail</th>
                <th className="text-left font-medium px-3 py-2">Note</th>
                <th className="text-right font-medium px-3 py-2">Out</th>
                <th className="text-right font-medium px-3 py-2">In</th>
                <th className="text-right font-medium px-3 py-2">Balance</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ unit, debit, credit, balance }) =>
                unit.length === 1 ? (
                  <LedgerRow
                    key={`${unit[0].kind}-${unit[0].id}`}
                    e={unit[0]}
                    debit={debit}
                    credit={credit}
                    balance={balance}
                    onDelete={handleEntryDelete}
                  />
                ) : (
                  <CombinedRow
                    key={unit[0].receipt_id!}
                    unit={unit}
                    debit={debit}
                    credit={credit}
                    balance={balance}
                  />
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TransferForm({
  fromAccountId,
  fromAccountName,
  otherAccounts,
  onCancel,
  onSaved,
}: {
  fromAccountId: string;
  fromAccountName: string;
  otherAccounts: AccountOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [toAccountId, setToAccountId] = useState(otherAccounts[0]?.id || "");
  const [date, setDate] = useState(formatLocalDate(new Date()));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(amount);
    if (!(amt > 0)) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (!toAccountId) {
      setError("Choose a destination account.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          amount: amt,
          date,
          note: note.trim() || undefined,
          screenshot_filename: screenshot?.name,
          screenshot_type: screenshot?.type,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to save");
        return;
      }
      const json = (await res.json()) as {
        screenshot_upload_url?: string | null;
      };
      if (screenshot && json.screenshot_upload_url) {
        await fetch(json.screenshot_upload_url, {
          method: "PUT",
          headers: { "Content-Type": screenshot.type },
          body: screenshot,
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (otherAccounts.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-4 mb-4">
        Add another account before recording a transfer.
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-4 mb-4 space-y-3"
    >
      <h5 className="text-sm font-semibold text-gray-800">
        Transfer out of {fromAccountName}
      </h5>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            To account *
          </label>
          <select
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {otherAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Date *
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Amount (₹) *
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
            required
            placeholder="0"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Note
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="UPI ref / reason"
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Screenshot (optional)
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setScreenshot(e.target.files?.[0] || null)}
          className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-emerald-100"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Record transfer"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1.5"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function WithdrawForm({
  accountId,
  accountName,
  onCancel,
  onSaved,
}: {
  accountId: string;
  accountName: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(formatLocalDate(new Date()));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(amount);
    if (!(amt > 0)) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/withdrawals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          date,
          note: note.trim() || undefined,
          screenshot_filename: screenshot?.name,
          screenshot_type: screenshot?.type,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to save");
        return;
      }
      const json = (await res.json()) as {
        screenshot_upload_url?: string | null;
      };
      if (screenshot && json.screenshot_upload_url) {
        await fetch(json.screenshot_upload_url, {
          method: "PUT",
          headers: { "Content-Type": screenshot.type },
          body: screenshot,
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="bg-orange-50/60 border border-orange-200 rounded-lg p-4 mb-4 space-y-3"
    >
      <h5 className="text-sm font-semibold text-gray-800">
        Withdraw from {accountName} (money out)
      </h5>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Date *
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Amount (₹) *
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
            required
            placeholder="0"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Reason / note
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. referral bonus to Raju"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Screenshot (optional)
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setScreenshot(e.target.files?.[0] || null)}
          className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-100 file:text-orange-800 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-orange-200"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Record withdrawal"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1.5"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function kindLabel(kind: LedgerKind): string {
  if (kind === "deposit") return "Deposit";
  if (kind === "deposit_refund") return "Refund";
  if (kind === "payment") return "Rent";
  if (kind === "withdrawal") return "Withdrawal";
  return kind === "transfer_out" ? "Transfer out" : "Transfer in";
}

function LedgerRow({
  e,
  debit,
  credit,
  balance,
  onDelete,
}: {
  e: AccountLedgerEntry;
  debit: number;
  credit: number;
  balance: number;
  onDelete: (entry: AccountLedgerEntry) => void;
}) {
  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2 whitespace-nowrap text-gray-800">{e.date}</td>
      <td className="px-3 py-2">
        <EntryBadge kind={e.kind} />
      </td>
      <td className="px-3 py-2 text-gray-800">
        {e.kind === "payment" ||
        e.kind === "deposit" ||
        e.kind === "deposit_refund" ? (
          e.customer_name && e.customer_id ? (
            <Link
              href={`/customers/${e.customer_id}`}
              className="text-emerald-700 hover:text-emerald-900"
            >
              {e.customer_name}
            </Link>
          ) : (
            <span className="text-gray-400">—</span>
          )
        ) : e.counterparty_name && e.counterparty_id ? (
          <Link
            href={`/accounts/${e.counterparty_id}`}
            className="text-emerald-700 hover:text-emerald-900"
          >
            {e.kind === "transfer_out" ? "→ " : "← "}
            {e.counterparty_name}
          </Link>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-600">
        {e.note || <span className="text-gray-400">—</span>}
        {e.screenshot_url && (
          <>
            {" "}
            <a
              href={e.screenshot_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-700 hover:text-emerald-900 underline"
            >
              (screenshot)
            </a>
          </>
        )}
      </td>
      <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-red-700">
        {debit > 0 ? formatINR(debit) : ""}
      </td>
      <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-green-700">
        {credit > 0 ? formatINR(credit) : ""}
      </td>
      <td
        className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${
          balance < 0 ? "text-red-700" : "text-gray-900"
        }`}
      >
        {formatINR(balance)}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {(e.kind === "transfer_in" ||
          e.kind === "transfer_out" ||
          e.kind === "withdrawal") && (
          <button
            onClick={() => onDelete(e)}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

// A combined receipt (deposit + start rent paid together) rendered as one
// ledger line — the In total matches the shared screenshot.
function CombinedRow({
  unit,
  debit,
  credit,
  balance,
}: {
  unit: AccountLedgerEntry[];
  debit: number;
  credit: number;
  balance: number;
}) {
  const withCustomer = unit.find((e) => e.customer_id);
  const screenshotUrl = unit.find((e) => e.screenshot_url)?.screenshot_url || null;
  const breakdown = unit
    .map((e) => `${kindLabel(e.kind)} ${formatINR(e.amount)}`)
    .join(" + ");
  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2 whitespace-nowrap text-gray-800">
        {unit[0].date}
      </td>
      <td className="px-3 py-2">
        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
          Collected
        </span>
      </td>
      <td className="px-3 py-2 text-gray-800">
        {withCustomer?.customer_name && withCustomer.customer_id ? (
          <Link
            href={`/customers/${withCustomer.customer_id}`}
            className="text-emerald-700 hover:text-emerald-900"
          >
            {withCustomer.customer_name}
          </Link>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-600">
        {breakdown}
        {screenshotUrl && (
          <>
            {" "}
            <a
              href={screenshotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-700 hover:text-emerald-900 underline"
            >
              (screenshot)
            </a>
          </>
        )}
      </td>
      <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-red-700">
        {debit > 0 ? formatINR(debit) : ""}
      </td>
      <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-green-700">
        {credit > 0 ? formatINR(credit) : ""}
      </td>
      <td
        className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${
          balance < 0 ? "text-red-700" : "text-gray-900"
        }`}
      >
        {formatINR(balance)}
      </td>
      <td className="px-3 py-2"></td>
    </tr>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "emerald";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-700"
      : tone === "red"
        ? "text-red-700"
        : "text-emerald-700";
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}

function EntryBadge({ kind }: { kind: LedgerKind }) {
  if (kind === "payment")
    return (
      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
        Payment
      </span>
    );
  if (kind === "deposit")
    return (
      <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">
        Deposit
      </span>
    );
  if (kind === "deposit_refund")
    return (
      <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
        Deposit refund
      </span>
    );
  if (kind === "transfer_in")
    return (
      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
        Transfer in
      </span>
    );
  if (kind === "withdrawal")
    return (
      <span className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-medium">
        Withdrawal
      </span>
    );
  return (
    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
      Transfer out
    </span>
  );
}
