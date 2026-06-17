"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/billing";

interface Account {
  id: string;
  name: string;
  created_at: string;
  balance: number;
  non_cash?: boolean;
}

function formatSignedINR(n: number): string {
  return n < 0 ? `−${formatINR(-n)}` : formatINR(n);
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [nonCash, setNonCash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = async () => {
    const res = await fetch("/api/accounts");
    setAccounts(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), non_cash: nonCash }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Failed to save");
      return;
    }
    setName("");
    setNonCash(false);
    setShowForm(false);
    fetchAccounts();
  };

  const handleDelete = async (a: Account) => {
    if (!confirm(`Delete account "${a.name}"?`)) return;
    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to delete");
      return;
    }
    fetchAccounts();
  };

  const cashAccounts = accounts.filter((a) => !a.non_cash);
  const nonCashAccounts = accounts.filter((a) => a.non_cash);
  const totalBalance = cashAccounts.reduce((s, a) => s + (a.balance || 0), 0);

  const renderAccount = (a: Account) => (
    <div
      key={a.id}
      className="bg-white rounded-lg border border-gray-200 p-5"
    >
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/accounts/${a.id}`}
          className="min-w-0 flex-1 hover:text-emerald-700"
        >
          <h2 className="font-semibold text-lg flex items-center gap-2">
            {a.name}
            {a.non_cash && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                Non-cash
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Added {new Date(a.created_at).toLocaleDateString()}
          </p>
        </Link>
        <div className="text-right shrink-0">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">
            {a.non_cash ? "Credited" : "Balance"}
          </p>
          <p
            className={`font-semibold ${
              a.balance < 0 ? "text-red-700" : "text-gray-900"
            }`}
          >
            {formatSignedINR(a.balance || 0)}
          </p>
        </div>
        <button
          onClick={() => handleDelete(a)}
          className="text-sm text-red-600 hover:text-red-800 font-medium shrink-0"
        >
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          {showForm ? "Cancel" : "+ Add Account"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg border border-gray-200 p-6 mb-6 space-y-4"
        >
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. Surbhi, Rajiv, HDFC bank"
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={nonCash}
              onChange={(e) => setNonCash(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Non-cash account (credits / adjustments)
              <span className="block text-xs text-gray-500">
                For rent waived or credited, not real money held. Excluded from
                the total balance.
              </span>
            </span>
          </label>
          <button
            type="submit"
            disabled={saving}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Account"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No accounts yet</p>
          <p className="text-sm mt-1">
            Add the accounts you collect rent into and move money between.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              Total balance
            </p>
            <p className="text-3xl font-bold mt-1 text-emerald-700">
              {formatSignedINR(totalBalance)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Sum of current balances across cash accounts.
            </p>
          </div>
          <div className="grid gap-4">{cashAccounts.map(renderAccount)}</div>
          {nonCashAccounts.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Non-cash (credits / adjustments)
              </h2>
              <div className="grid gap-4">
                {nonCashAccounts.map(renderAccount)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
