"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatINR, RATE_UNITS, RateUnit } from "@/lib/billing";
import { ID_TYPES, IdType, ID_TYPE_LABELS, KmsLog, LocationLog } from "@/lib/idTypes";

interface AccountOption {
  id: string;
  name: string;
}

interface Photo {
  id: string;
  original_name: string;
  url: string;
  created_at: string;
}

interface Payment {
  id: string;
  amount: number;
  paidOn: string;
  account: string | null;
  accountName: string | null;
  receiptId: string | null;
  note: string | null;
  screenshotUrl: string | null;
  createdAt: string;
}

interface Refund {
  id: string;
  amount: number;
  date: string;
  account: string | null;
  account_name: string | null;
  note: string | null;
  screenshot_url: string | null;
  created_at: string;
}

// A security-deposit collection. A rental's deposit may arrive in installments,
// so there can be several of these.
interface Deposit {
  id: string;
  amount: number;
  date: string;
  account: string | null;
  account_name: string | null;
  receipt_id: string | null;
  note: string | null;
  screenshot_url: string | null;
}

interface RentalView {
  id: string;
  scootyLabel: string;
  startDate: string;
  endDate: string | null;
  rate: number;
  rateUnit: RateUnit;
  securityDeposit: number;
  refundableDeposit: number;
  notes: string | null;
  createdAt: string;
  payments: Payment[];
  refunds: Refund[];
  deposits: Deposit[];
  kmsLogs: Omit<KmsLog, "customerId">[];
  scooties: { label: string; from: string; note: string | null }[];
  locationLogs?: LocationLog[];
  balances: {
    daysBilled: number;
    totalBilled: number;
    totalPaid: number;
    outstanding: number;
    paidThroughDate: string | null;
    daysRemaining: number;
    coverageStatus: "paid" | "due_today" | "overdue";
    status: "active" | "closed";
  };
}

interface CustomerIdView {
  id: string;
  type: IdType;
  number: string;
  originalSubmitted: boolean;
  createdAt: string;
}

interface CustomerDetail {
  id: string;
  name: string;
  phones: string[];
  address: string | null;
  map_location: string | null;
  notes: string | null;
  ids: CustomerIdView[];
  created_at: string;
  photos: Photo[];
  rentals: RentalView[];
}

function useLeaflet() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).L) {
      setLoaded(true);
      return;
    }

    const existingScript = document.getElementById("leaflet-js");
    if (existingScript) {
      const handleLoad = () => setLoaded(true);
      existingScript.addEventListener("load", handleLoad);
      return () => {
        existingScript.removeEventListener("load", handleLoad);
      };
    }

    // Load CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/leaflet.css";
    document.head.appendChild(link);

    // Load JS
    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = "/leaflet.js";
    script.onload = () => setLoaded(true);
    document.body.appendChild(script);
  }, []);

  return loaded;
}

// Turn a saved house location (a pasted Maps URL, or coordinates / free text)
// into an openable Maps link.
function mapsHref(loc: string): string {
  const v = loc.trim();
  if (/^https?:\/\//i.test(v)) return v;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLoc, setEditingLoc] = useState(false);
  const [locDraft, setLocDraft] = useState("");
  const [savingLoc, setSavingLoc] = useState(false);

  const saveLocation = async () => {
    setSavingLoc(true);
    await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ map_location: locDraft.trim() }),
    });
    setSavingLoc(false);
    setEditingLoc(false);
    refresh();
  };

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/customers/${id}`);
    if (!res.ok) {
      setError("Customer not found");
      setLoading(false);
      return;
    }
    setData(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    refresh();
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [refresh]);

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/customers"
            className="text-sm text-emerald-700 hover:text-emerald-900"
          >
            ← Back to customers
          </Link>
          <h1 className="text-2xl font-bold mt-1">{data.name}</h1>
          <div className="text-sm text-gray-600 mt-1 space-x-4">
            {data.phones.length > 0 && <span>{data.phones.join(", ")}</span>}
            {data.address && <span>{data.address}</span>}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {editingLoc ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={locDraft}
                  onChange={(e) => setLocDraft(e.target.value)}
                  placeholder="Paste a Google Maps link or coordinates"
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-80 max-w-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={saveLocation}
                  disabled={savingLoc}
                  className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingLoc ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditingLoc(false)}
                  disabled={savingLoc}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            ) : data.map_location ? (
              <span className="space-x-3">
                <a
                  href={mapsHref(data.map_location)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700 hover:text-emerald-900 underline"
                >
                  📍 Open in Maps
                </a>
                <button
                  onClick={() => {
                    setLocDraft(data.map_location ?? "");
                    setEditingLoc(true);
                  }}
                  className="text-xs text-emerald-700 hover:underline"
                >
                  Edit
                </button>
              </span>
            ) : (
              <button
                onClick={() => {
                  setLocDraft("");
                  setEditingLoc(true);
                }}
                className="text-emerald-700 hover:underline"
              >
                + Add house location
              </button>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            if (!confirm("Delete this customer and all their rentals?")) return;
            await fetch(`/api/customers/${id}`, { method: "DELETE" });
            router.push("/customers");
          }}
          className="text-sm text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg"
        >
          Delete
        </button>
      </div>

      <NotesSection
        customerId={id}
        notes={data.notes}
        onChange={refresh}
      />

      <IdsSection
        customerId={id}
        initialIds={data.ids}
        onChange={refresh}
      />

      <PhotosSection
        customerId={id}
        photos={data.photos}
        onChange={refresh}
      />

      <RentalsSection
        customerId={id}
        customerName={data.name}
        rentals={data.rentals}
        accounts={accounts}
        onChange={refresh}
      />
    </div>
  );
}

// Free-text notes about the customer — e.g. "house on 2nd floor", "call before
// visiting". Saved on the customer profile; blank clears it.
function NotesSection({
  customerId,
  notes,
  onChange,
}: {
  customerId: string;
  notes: string | null;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(notes ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: draft.trim() }),
      });
      setEditing(false);
      onChange();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Notes</h2>
        {!editing ? (
          <button
            onClick={startEdit}
            className="text-sm text-emerald-700 hover:text-emerald-900 font-medium"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-sm bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {!editing ? (
        notes ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{notes}</p>
        ) : (
          <p className="text-sm text-gray-500">
            No notes yet. Click <span className="font-medium">Edit</span> to add
            something like &ldquo;house on 2nd floor&rdquo;.
          </p>
        )
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          autoFocus
          placeholder="e.g. House on 2nd floor, call before visiting"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      )}
    </section>
  );
}

function PhotosSection({
  customerId,
  photos,
  onChange,
}: {
  customerId: string;
  photos: Photo[];
  onChange: () => void;
}) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      const fileList = Array.from(files);
      const res = await fetch(`/api/customers/${customerId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: fileList.map((f) => ({
            name: f.name,
            type: f.type,
          })),
        }),
      });
      const { uploads } = (await res.json()) as {
        uploads: { id: string; upload_url: string }[];
      };
      await Promise.all(
        uploads.map((u, i) =>
          fetch(u.upload_url, {
            method: "PUT",
            headers: { "Content-Type": fileList[i].type },
            body: fileList[i],
          })
        )
      );
      onChange();
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (photoId: string) => {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/api/customers/${customerId}/photos/${photoId}`, {
      method: "DELETE",
    });
    onChange();
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold">Photos</h2>
        <label className="cursor-pointer bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-700">
          {uploading ? "Uploading…" : "+ Upload"}
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={handleUpload}
          />
        </label>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6 bg-gray-50 border border-gray-200 rounded-lg">
          No photos yet
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {photos.map((p) => (
            <div
              key={p.id}
              className="relative group border border-gray-200 rounded-lg overflow-hidden"
            >
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.original_name}
                  className="w-full h-32 object-cover cursor-pointer"
                />
              </a>
              <button
                onClick={() => handleDelete(p.id)}
                className="absolute top-1 right-1 bg-white/90 text-red-600 text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RentalsSection({
  customerId,
  customerName,
  rentals,
  accounts,
  onChange,
}: {
  customerId: string;
  customerName: string;
  rentals: RentalView[];
  accounts: AccountOption[];
  onChange: () => void;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Rentals</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          {showForm ? "Cancel" : "+ New Rental"}
        </button>
      </div>

      {showForm && (
        <NewRentalForm
          customerId={customerId}
          customerName={customerName}
          accounts={accounts}
          onSaved={() => {
            setShowForm(false);
            onChange();
          }}
        />
      )}

      {rentals.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6 bg-gray-50 border border-gray-200 rounded-lg">
          No rentals yet
        </p>
      ) : (
        <div className="space-y-4">
          {rentals.map((r) => (
            <RentalCard
              key={r.id}
              rental={r}
              customerId={customerId}
              accounts={accounts}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function NewRentalForm({
  customerId,
  customerName,
  accounts,
  onSaved,
}: {
  customerId: string;
  customerName: string;
  accounts: AccountOption[];
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [scootyLabel, setScootyLabel] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [startKms, setStartKms] = useState("");
  const [rate, setRate] = useState("");
  const [rateUnit, setRateUnit] = useState<RateUnit>("day");
  const [securityDeposit, setSecurityDeposit] = useState("");
  const [refundableDeposit, setRefundableDeposit] = useState("");
  const [depositCollectedNow, setDepositCollectedNow] = useState("");
  const [advancePayment, setAdvancePayment] = useState("");
  const [advanceAccount, setAdvanceAccount] = useState<string>("");
  const [depositAccount, setDepositAccount] = useState<string>("");
  const [advanceScreenshot, setAdvanceScreenshot] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Fall back to the first account until the user picks one explicitly.
  const selectedAccount = advanceAccount || accounts[0]?.id || "";
  const selectedDepositAccount = depositAccount || accounts[0]?.id || "";
  const depositTarget = parseFloat(securityDeposit) || 0;
  const hasDeposit = depositTarget > 0;
  // The deposit field is the agreed *target*; "collect now" is how much of it
  // the customer actually pays today. Blank = collect the whole target now
  // (the common case); enter a smaller amount (incl. 0) when they'll pay the
  // rest in installments.
  const collectedNow =
    depositCollectedNow.trim() === ""
      ? depositTarget
      : parseFloat(depositCollectedNow) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const hasAdvance = !!parseFloat(advancePayment);
      const includeScreenshot = hasAdvance && advanceScreenshot;
      const res = await fetch("/api/rentals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          customer_name: customerName,
          scooty_label: scootyLabel,
          start_date: startDate,
          rate: parseFloat(rate),
          rate_unit: rateUnit,
          security_deposit: securityDeposit ? parseFloat(securityDeposit) : 0,
          refundable_deposit: refundableDeposit ? parseFloat(refundableDeposit) : 0,
          deposit_collected: collectedNow,
          deposit_account: collectedNow > 0 ? selectedDepositAccount : undefined,
          advance_payment: hasAdvance ? parseFloat(advancePayment) : 0,
          start_kms: startKms ? parseInt(startKms, 10) : undefined,
          advance_account: hasAdvance ? selectedAccount : undefined,
          advance_screenshot_filename: includeScreenshot
            ? advanceScreenshot!.name
            : undefined,
          advance_screenshot_type: includeScreenshot
            ? advanceScreenshot!.type
            : undefined,
          notes,
        }),
      });
      const json = (await res.json()) as {
        advance_screenshot_upload_url?: string | null;
      };
      if (includeScreenshot && json.advance_screenshot_upload_url) {
        // Upload the screenshot to the presigned URL we just got back. If this
        // step fails the payment still exists; the user can delete + recreate
        // to re-attach a screenshot.
        await fetch(json.advance_screenshot_upload_url, {
          method: "PUT",
          headers: { "Content-Type": advanceScreenshot!.type },
          body: advanceScreenshot!,
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
      className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Scooty (number / model) *">
          <input
            required
            value={scootyLabel}
            onChange={(e) => setScootyLabel(e.target.value)}
            placeholder="MH12 AB 1234"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Start date *">
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Odometer reading at start (km) *">
          <input
            type="number"
            min="0"
            step="1"
            required
            value={startKms}
            onChange={(e) => setStartKms(e.target.value)}
            placeholder="e.g. 15000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Rate (₹) *">
          <input
            type="number"
            min="0"
            step="1"
            required
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Per *">
          <select
            value={rateUnit}
            onChange={(e) => setRateUnit(e.target.value as RateUnit)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {RATE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Security deposit (₹)">
          <input
            type="number"
            min="0"
            step="1"
            value={securityDeposit}
            onChange={(e) => setSecurityDeposit(e.target.value)}
            placeholder="e.g. 1750"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Refundable on return (₹)">
          <input
            type="number"
            min="0"
            step="1"
            value={refundableDeposit}
            onChange={(e) => setRefundableDeposit(e.target.value)}
            placeholder="e.g. 1000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        {hasDeposit && (
          <Field label="Collect deposit now (₹)">
            <input
              type="number"
              min="0"
              max={depositTarget}
              step="1"
              value={depositCollectedNow}
              onChange={(e) => setDepositCollectedNow(e.target.value)}
              placeholder={`Blank = full ₹${depositTarget.toLocaleString("en-IN")}`}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
        )}
        {collectedNow > 0 && (
          <Field label="Deposit into account *">
            <select
              value={selectedDepositAccount}
              onChange={(e) => setDepositAccount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {accounts.length === 0 && <option value="">No accounts</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Rent paid now (₹)">
          <input
            type="number"
            min="0"
            step="1"
            value={advancePayment}
            onChange={(e) => setAdvancePayment(e.target.value)}
            placeholder="Rent only — not deposit"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        {parseFloat(advancePayment) > 0 && (
          <>
            <Field label="Into account *">
              <select
                value={selectedAccount}
                onChange={(e) => setAdvanceAccount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {accounts.length === 0 && <option value="">No accounts</option>}
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment screenshot (optional)">
              <input
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setAdvanceScreenshot(e.target.files?.[0] || null)
                }
                className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-emerald-100"
              />
            </Field>
          </>
        )}
      </div>
      {(collectedNow > 0 || advancePayment) && (
        <div className="text-xs text-gray-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          Cash to collect now:{" "}
          <span className="font-semibold text-gray-900">
            ₹{(
              collectedNow + (parseFloat(advancePayment) || 0)
            ).toLocaleString("en-IN")}
          </span>{" "}
          <span className="text-gray-500">
            (deposit ₹{collectedNow.toLocaleString("en-IN")} + rent ₹
            {(parseFloat(advancePayment) || 0).toLocaleString("en-IN")})
          </span>
          {hasDeposit && collectedNow < depositTarget && (
            <span className="block mt-0.5 text-amber-700">
              Remaining deposit ₹
              {(depositTarget - collectedNow).toLocaleString("en-IN")} to be
              collected later — record each installment with “+ Record Payment”.
            </span>
          )}
        </div>
      )}
      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      </Field>
      <button
        type="submit"
        disabled={saving}
        className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Rental"}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function RentalCard({
  rental,
  customerId,
  accounts,
  onChange,
}: {
  rental: RentalView;
  customerId: string;
  accounts: AccountOption[];
  onChange: () => void;
}) {
  type FormKind = "pay" | "refund" | "deposit" | "swap" | "kms" | null;
  const [activeForm, setActiveForm] = useState<FormKind>(null);
  const toggleForm = (kind: FormKind) => setActiveForm((v) => (v === kind ? null : kind));
  const [pulling, setPulling] = useState(false);
  const isActive = rental.balances.status === "active";

  const leafletLoaded = useLeaflet();
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!leafletLoaded || !rental.locationLogs || rental.locationLogs.length === 0) return;
    const L = (window as any).L;
    if (!L) return;

    const containerId = `map-${rental.id}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Initialize map if not yet done
    if (!mapRef.current) {
      const latestLog = rental.locationLogs[0];
      const map = L.map(containerId).setView([latestLog.latitude, latestLog.longitude], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      mapRef.current = map;
    }

    // Clear existing transient markers/polylines from map
    mapRef.current.eachLayer((layer: any) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        mapRef.current.removeLayer(layer);
      }
    });

    const sortedLogs = [...rental.locationLogs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const latlngs = sortedLogs.map((log) => [log.latitude, log.longitude]);

    // Draw historical polyline path
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: "#0ea5e9", weight: 3, opacity: 0.8 }).addTo(mapRef.current);
    }

    // Add markers with custom style DivIcons (pulse animations for current, simple dot for historical)
    sortedLogs.forEach((log, idx) => {
      const isLatest = idx === sortedLogs.length - 1;
      const marker = L.marker([log.latitude, log.longitude], {
        icon: L.divIcon({
          className: "custom-leaflet-div-icon",
          html: isLatest
            ? `<div style="position: relative; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
                <span style="position: absolute; width: 100%; height: 100%; border-radius: 50%; background-color: #38bdf8; opacity: 0.75; transform: scale(1); animation: leaflet-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
                <span style="position: relative; width: 12px; height: 12px; border-radius: 50%; background-color: #0284c7; border: 2px solid white;"></span>
               </div>`
            : `<div style="width: 8px; height: 8px; border-radius: 50%; background-color: #64748b; border: 1.5px solid white;"></div>`,
          iconSize: isLatest ? [24, 24] : [8, 8],
          iconAnchor: isLatest ? [12, 12] : [4, 4],
        }),
      }).addTo(mapRef.current);

      marker.bindPopup(
        `<div style="font-family: sans-serif; font-size: 12px; color: #1e293b;">` +
        `<strong>${isLatest ? "Current Location" : "History Pin"}</strong><br/>` +
        `Time: ${new Date(log.timestamp).toLocaleTimeString()}<br/>` +
        `Date: ${new Date(log.timestamp).toLocaleDateString()}<br/>` +
        `${log.batteryLevel !== undefined ? "Battery: " + Math.round(log.batteryLevel * 100) + "%" : ""}` +
        `</div>`
      );
    });

    // Adjust view to fit all coords in history
    if (latlngs.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
    } else if (latlngs.length === 1) {
      mapRef.current.setView(latlngs[0], 14);
    }
  }, [leafletLoaded, rental.locationLogs, rental.id]);

  // Cleanup map on final component unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);
  const { coverageStatus, daysRemaining, paidThroughDate } = rental.balances;

  const latestKms = rental.kmsLogs && rental.kmsLogs.length > 0 ? rental.kmsLogs[0].kms : null;
  const odometerValue = latestKms !== null ? `${latestKms.toLocaleString("en-IN")} km` : "—";

  const totalRefunded = rental.refunds.reduce((s, r) => s + r.amount, 0);
  // The deposit may be collected in installments — sum what's actually in.
  const depositCollected = rental.deposits.reduce((s, d) => s + d.amount, 0);
  const depositOutstanding = Math.max(
    0,
    rental.securityDeposit - depositCollected
  );
  // Can only refund money actually collected, capped at the refundable target.
  const remainingRefundable = Math.max(
    0,
    Math.min(rental.refundableDeposit, depositCollected) - totalRefunded
  );

  // One chronological cash list for the rental: the deposit collected, rent
  // payments, and deposit refunds — mirroring the account ledger.
  type Tx = {
    key: string;
    date: string;
    kind: "deposit" | "payment" | "refund";
    amount: number;
    accountName: string | null;
    note: string | null;
    screenshotUrl: string | null;
    deleteUrl: string | null;
    receiptId: string | null;
  };
  const transactions: Tx[] = [
    ...rental.deposits.map((d) => ({
      key: `dep-${d.id}`,
      date: d.date,
      kind: "deposit" as const,
      amount: d.amount,
      accountName: d.account_name,
      // The badge already says "Deposit"; the stored note is just the system
      // default, so don't repeat it.
      note: null,
      screenshotUrl: d.screenshot_url,
      deleteUrl: `/api/rentals/${rental.id}/deposits/${d.id}?customer_id=${customerId}`,
      receiptId: d.receipt_id,
    })),
    ...rental.payments.map((p) => ({
      key: `pay-${p.id}`,
      date: p.paidOn,
      kind: "payment" as const,
      amount: p.amount,
      accountName: p.accountName || p.account,
      note: p.note,
      screenshotUrl: p.screenshotUrl,
      deleteUrl: `/api/rentals/${rental.id}/payments/${p.id}?customer_id=${customerId}`,
      receiptId: p.receiptId,
    })),
    ...rental.refunds.map((r) => ({
      key: `ref-${r.id}`,
      date: r.date,
      kind: "refund" as const,
      amount: r.amount,
      accountName: r.account_name,
      note: r.note,
      screenshotUrl: r.screenshot_url,
      deleteUrl: `/api/rentals/${rental.id}/refund/${r.id}?customer_id=${customerId}`,
      receiptId: null,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Group rows collected in one payment (shared receiptId) into a single unit.
  const txUnits: Tx[][] = [];
  const seenReceipts = new Set<string>();
  for (const t of transactions) {
    if (t.receiptId) {
      if (seenReceipts.has(t.receiptId)) continue;
      seenReceipts.add(t.receiptId);
      txUnits.push(transactions.filter((x) => x.receiptId === t.receiptId));
    } else {
      txUnits.push([t]);
    }
  }

  const handleTxDelete = async (url: string) => {
    if (!confirm("Delete this entry?")) return;
    await fetch(url, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{rental.scootyLabel}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {rental.startDate} → {rental.endDate || "active"} · {formatINR(rental.rate)}/{rental.rateUnit}
          </div>
          {rental.scooties.length > 1 && (
            <div className="text-xs text-gray-600 mt-1">
              <span className="uppercase tracking-wide text-[10px] text-gray-400">
                Scooty history
              </span>
              <ul className="mt-0.5 space-y-0.5">
                {rental.scooties.map((s, i) => {
                  const next = rental.scooties[i + 1];
                  const to = next?.from || rental.endDate || null;
                  // The swap reason is stored on the assignment the swap
                  // created, but it explains why THIS scooty was swapped out —
                  // so show it on the scooty that ended.
                  const swappedOutReason = next?.note;
                  return (
                    <li key={`${s.label}-${s.from}-${i}`} className="flex flex-wrap gap-x-1.5">
                      <span className="font-medium text-gray-800">{s.label}</span>
                      <span className="text-gray-500">
                        {s.from} → {to || "active"}
                      </span>
                      {swappedOutReason && (
                        <span className="text-gray-400 italic">
                          · {swappedOutReason}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {rental.securityDeposit > 0 && (
            <div className="text-xs text-gray-600 mt-0.5">
              Deposit{" "}
              {depositOutstanding > 0 ? (
                <span className="font-medium text-gray-800">
                  {formatINR(depositCollected)} of{" "}
                  {formatINR(rental.securityDeposit)}
                </span>
              ) : (
                formatINR(rental.securityDeposit)
              )}{" "}
              · refundable {formatINR(rental.refundableDeposit)}
              {rental.securityDeposit > rental.refundableDeposit && (
                <span className="text-gray-500">
                  {" "}
                  (kept {formatINR(rental.securityDeposit - rental.refundableDeposit)})
                </span>
              )}
              {depositOutstanding > 0 && (
                <span className="ml-1 inline-block bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium">
                  {formatINR(depositOutstanding)} pending
                </span>
              )}
            </div>
          )}
          {(() => {
            // Cash collected on the rental's start date = deposit + any
            // payments dated that day. Useful for tying back to a day's cash.
            const startDayPayments = rental.payments
              .filter((p) => p.paidOn === rental.startDate)
              .reduce((s, p) => s + p.amount, 0);
            const startDayDeposit = rental.deposits
              .filter((d) => d.date === rental.startDate)
              .reduce((s, d) => s + d.amount, 0);
            const initialCash = startDayDeposit + startDayPayments;
            if (initialCash === 0) return null;
            return (
              <div className="text-xs text-emerald-700 mt-0.5 font-medium">
                Collected at start: {formatINR(initialCash)}
                <span className="text-gray-500 font-normal">
                  {" "}
                  (deposit {formatINR(startDayDeposit)} + rent{" "}
                  {formatINR(startDayPayments)})
                </span>
              </div>
            );
          })()}
          {rental.notes && (
            <div className="text-xs text-gray-600 mt-1 italic">{rental.notes}</div>
          )}
        </div>
        {isActive && <CoverageBadge status={coverageStatus} days={daysRemaining} />}
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Stat
          label="Paid through"
          value={paidThroughDate || "—"}
        />
        <Stat label="Days billed" value={String(rental.balances.daysBilled)} />
        <Stat label="Paid" value={formatINR(rental.balances.totalPaid)} />
        <Stat label="Odometer" value={odometerValue} />
      </div>

      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={() => toggleForm("pay")}
          className="text-sm bg-white border border-emerald-300 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50"
        >
          {activeForm === "pay" ? "Cancel" : "+ Record Payment"}
        </button>
        {isActive && (
          <button
            onClick={() => toggleForm("kms")}
            className="text-sm bg-white border border-orange-300 text-orange-700 px-3 py-1.5 rounded-lg hover:bg-orange-50"
          >
            {activeForm === "kms" ? "Cancel" : "+ Log KMS"}
          </button>
        )}
        {rental.securityDeposit > 0 && (
          <button
            onClick={() => toggleForm("refund")}
            className="text-sm bg-white border border-amber-300 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-50"
          >
            {activeForm === "refund" ? "Cancel" : "+ Refund Deposit"}
          </button>
        )}
        <button
          onClick={() => toggleForm("deposit")}
          className="text-sm bg-white border border-sky-300 text-sky-700 px-3 py-1.5 rounded-lg hover:bg-sky-50"
        >
          {activeForm === "deposit" ? "Cancel" : "Edit deposit"}
        </button>
        {isActive && (
          <button
            onClick={() => toggleForm("swap")}
            className="text-sm bg-white border border-sky-300 text-sky-700 px-3 py-1.5 rounded-lg hover:bg-sky-50"
          >
            {activeForm === "swap" ? "Cancel" : "Swap scooty"}
          </button>
        )}
        {isActive && (
          <button
            disabled={pulling}
            onClick={async () => {
              setPulling(true);
              try {
                const res = await fetch(`/api/rentals/${rental.id}/pull`, {
                  method: "POST",
                });
                if (!res.ok) throw new Error("Failed to send pull command");
                
                // Poll for updates in the background to automatically refresh the location list
                setTimeout(onChange, 2000);
                setTimeout(onChange, 4000);
                setTimeout(() => {
                  onChange();
                  setPulling(false);
                }, 6000);
              } catch (err: any) {
                alert("Pull error: " + err.message);
                setPulling(false);
              }
            }}
            className="text-sm bg-white border border-purple-300 text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-50 disabled:opacity-50"
          >
            {pulling ? "Pulling..." : "Pull Location"}
          </button>
        )}
        {isActive && (
          <button
            onClick={async () => {
              const today = new Date().toISOString().slice(0, 10);
              const date = prompt("End date (YYYY-MM-DD):", today);
              if (!date) return;
              await fetch(`/api/rentals/${rental.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ end_date: date, customer_id: customerId }),
              });
              onChange();
            }}
            className="text-sm bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            Close rental
          </button>
        )}
        <button
          onClick={async () => {
            if (!confirm("Delete this rental and all payments?")) return;
            await fetch(
              `/api/rentals/${rental.id}?customer_id=${customerId}`,
              { method: "DELETE" }
            );
            onChange();
          }}
          className="text-sm text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg"
        >
          Delete
        </button>
      </div>

      {activeForm === "pay" && (
        <CollectForm
          rentalId={rental.id}
          customerId={customerId}
          accounts={accounts}
          depositOutstanding={depositOutstanding}
          onSaved={() => {
            setActiveForm(null);
            onChange();
          }}
        />
      )}

      {activeForm === "refund" && (
        <RefundForm
          rentalId={rental.id}
          customerId={customerId}
          accounts={accounts}
          defaultAmount={remainingRefundable}
          defaultAccount={rental.deposits[0]?.account || ""}
          onSaved={() => {
            setActiveForm(null);
            onChange();
          }}
        />
      )}

      {activeForm === "swap" && (
        <SwapForm
          rentalId={rental.id}
          customerId={customerId}
          currentLabel={rental.scootyLabel}
          onSaved={() => {
            setActiveForm(null);
            onChange();
          }}
        />
      )}

      {activeForm === "deposit" && (
        <DepositEditForm
          rentalId={rental.id}
          customerId={customerId}
          currentSecurity={rental.securityDeposit}
          currentRefundable={rental.refundableDeposit}
          collected={depositCollected}
          onSaved={() => {
            setActiveForm(null);
            onChange();
          }}
        />
      )}

      {activeForm === "kms" && (
        <KmsForm
          rentalId={rental.id}
          customerId={customerId}
          onSaved={() => {
            setActiveForm(null);
            onChange();
          }}
          onCancel={() => setActiveForm(null)}
        />
      )}

      {rental.kmsLogs && rental.kmsLogs.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            Odometer History
          </div>
          <ul className="space-y-1 text-sm text-gray-700 max-h-36 overflow-y-auto font-mono">
            {rental.kmsLogs.map((log) => (
              <li key={log.id} className="flex justify-between py-1 border-b border-gray-50 last:border-0">
                <span className="min-w-0">
                  <span className="font-semibold text-gray-800">{log.kms.toLocaleString("en-IN")} km</span>
                  <span className="text-gray-400 mx-2">·</span>
                  <span className="text-gray-500">{log.date}</span>
                  <span className="ml-2 inline-block bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 rounded font-medium">
                    {log.scootyLabel}
                  </span>
                  {log.note ? ` · ${log.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rental.locationLogs && rental.locationLogs.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <style>{`
            @keyframes leaflet-ping {
              0% {
                transform: scale(0.5);
                opacity: 1;
              }
              100% {
                transform: scale(2.5);
                opacity: 0;
              }
            }
          `}</style>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            Driver Location History
          </div>
          {/* Leaflet map container */}
          <div
            id={`map-${rental.id}`}
            className="h-64 w-full rounded-xl mt-1 mb-3 overflow-hidden shadow-inner border border-gray-200 z-0"
          />
          <ul className="space-y-1 text-sm text-gray-700 max-h-40 overflow-y-auto font-mono">
            {rental.locationLogs.map((log: any) => (
              <li
                key={log.id}
                onClick={() => {
                  if (mapRef.current) {
                    mapRef.current.setView([log.latitude, log.longitude], 16);
                  }
                }}
                className="flex justify-between py-1.5 border-b border-gray-50 last:border-0 hover:bg-slate-50 cursor-pointer px-2 rounded transition"
                title="Click to focus map here"
              >
                <span className="min-w-0 flex items-center">
                  <span className="font-semibold text-sky-600 hover:underline">
                    {log.latitude.toFixed(6)}, {log.longitude.toFixed(6)}
                  </span>
                  <span className="text-gray-400 mx-2">·</span>
                  <span className="text-gray-500 text-xs">
                    {new Date(log.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}{" "}
                    ({new Date(log.timestamp).toLocaleDateString()})
                  </span>
                  {log.batteryLevel !== undefined && (
                    <>
                      <span className="text-gray-400 mx-2">·</span>
                      <span className="text-gray-500 text-[10px]">🔋 {Math.round(log.batteryLevel * 100)}%</span>
                    </>
                  )}
                </span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${log.latitude},${log.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-sky-600 transition ml-2 text-xs flex items-center"
                  title="Open in Google Maps"
                  onClick={(e) => e.stopPropagation()}
                >
                  🗺️ Maps
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {txUnits.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            Transactions
          </div>
          <ul className="space-y-2 text-sm">
            {txUnits.map((unit) =>
              unit.length === 1 ? (
                <TxRow
                  key={unit[0].key}
                  t={unit[0]}
                  onDelete={handleTxDelete}
                />
              ) : (
                <TxGroup
                  key={unit[0].receiptId!}
                  unit={unit}
                  onDelete={handleTxDelete}
                />
              )
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// Shared 40px screenshot slot — keeps rows aligned whether or not a
// transaction has a screenshot.
function TxThumb({ url, alt }: { url: string | null; alt: string }) {
  return (
    <div className="w-10 h-10 shrink-0">
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            className="w-10 h-10 object-cover rounded border border-gray-200 hover:opacity-80"
          />
        </a>
      )}
    </div>
  );
}

type TxLike = {
  key: string;
  date: string;
  kind: "deposit" | "payment" | "refund";
  amount: number;
  accountName: string | null;
  note: string | null;
  screenshotUrl: string | null;
  deleteUrl: string | null;
};

function TxRow({
  t,
  onDelete,
}: {
  t: TxLike;
  onDelete: (url: string) => void;
}) {
  const isRefund = t.kind === "refund";
  return (
    <li className="flex justify-between items-start gap-2">
      <div className="flex items-start gap-3 min-w-0">
        <TxThumb url={t.screenshotUrl} alt={`${t.kind} screenshot`} />
        <span className="text-gray-600 mt-0.5">
          {t.date}
          <TxBadge kind={t.kind} />
          {t.accountName && (
            <span className="ml-1 inline-block bg-gray-100 text-gray-700 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded">
              {isRefund ? "from " : ""}
              {t.accountName}
            </span>
          )}
          {t.note ? ` · ${t.note}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`font-medium tabular-nums text-right ${
            isRefund ? "text-amber-800" : "text-gray-900"
          }`}
        >
          {isRefund ? "−" : ""}
          {formatINR(t.amount)}
        </span>
        <span className="w-12 text-right">
          {t.deleteUrl && (
            <button
              onClick={() => onDelete(t.deleteUrl!)}
              className="text-xs text-red-600 hover:underline"
            >
              delete
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

// A combined receipt — deposit + start rent paid in one transaction. Shown as
// a single screenshot-backed line at the combined total, with the split (and
// per-entry deletes) beneath, so the screenshot value matches the line total.
function TxGroup({
  unit,
  onDelete,
}: {
  unit: TxLike[];
  onDelete: (url: string) => void;
}) {
  const total = unit.reduce((s, t) => s + t.amount, 0);
  const screenshotUrl = unit.find((t) => t.screenshotUrl)?.screenshotUrl || null;
  const accountName = unit.find((t) => t.accountName)?.accountName || null;
  return (
    <li className="flex justify-between items-start gap-2">
      <div className="flex items-start gap-3 min-w-0">
        <TxThumb url={screenshotUrl} alt="payment screenshot" />
        <div className="min-w-0">
          <span className="text-gray-600">
            {unit[0].date}
            <span className="ml-2 inline-block bg-indigo-100 text-indigo-700 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium">
              Collected
            </span>
            {accountName && (
              <span className="ml-1 inline-block bg-gray-100 text-gray-700 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded">
                {accountName}
              </span>
            )}
          </span>
          <div className="mt-1 space-y-0.5">
            {unit.map((t) => (
              <div
                key={t.key}
                className="flex items-center gap-2 text-xs text-gray-500"
              >
                <TxBadge kind={t.kind} />
                <span className="tabular-nums">{formatINR(t.amount)}</span>
                {t.deleteUrl && (
                  <button
                    onClick={() => onDelete(t.deleteUrl!)}
                    className="text-red-600 hover:underline"
                  >
                    delete
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-medium tabular-nums text-right text-gray-900">
          {formatINR(total)}
        </span>
        <span className="w-12 text-right" />
      </div>
    </li>
  );
}

function TxBadge({ kind }: { kind: "deposit" | "payment" | "refund" }) {
  if (kind === "deposit")
    return (
      <span className="ml-2 inline-block bg-sky-100 text-sky-700 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium">
        Deposit
      </span>
    );
  if (kind === "refund")
    return (
      <span className="ml-2 inline-block bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium">
        Refund
      </span>
    );
  return (
    <span className="ml-2 inline-block bg-emerald-100 text-emerald-700 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium">
      Rent
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function CoverageBadge({
  status,
  days,
}: {
  status: "paid" | "due_today" | "overdue";
  days: number;
}) {
  if (status === "overdue") {
    const behind = Math.abs(days);
    return (
      <div className="text-right">
        <div className="inline-block bg-red-600 text-white text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded">
          BLOCK
        </div>
        <div className="text-xs text-red-700 mt-1 font-medium">
          {behind} day{behind === 1 ? "" : "s"} unpaid
        </div>
      </div>
    );
  }
  if (status === "due_today") {
    return (
      <div className="text-right">
        <div className="inline-block bg-amber-500 text-white text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded">
          Due today
        </div>
        <div className="text-xs text-amber-700 mt-1">Last paid day</div>
      </div>
    );
  }
  return (
    <div className="text-right">
      <div className="inline-block bg-emerald-100 text-emerald-800 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded">
        {days} day{days === 1 ? "" : "s"} left
      </div>
    </div>
  );
}

// One collection that can carry rent and/or a security-deposit installment.
// Filling both fields records them as a single combined receipt (one
// screenshot); filling just one records that alone. Posts to /collect, which
// writes the matching rows in one transaction.
function CollectForm({
  rentalId,
  customerId,
  accounts,
  depositOutstanding,
  onSaved,
}: {
  rentalId: string;
  customerId: string;
  accounts: AccountOption[];
  depositOutstanding: number;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [rentAmount, setRentAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [date, setDate] = useState(today);
  const [account, setAccount] = useState<string>("");
  const [note, setNote] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Fall back to the first account until the user picks one explicitly.
  const selectedAccount = account || accounts[0]?.id || "";
  const rent = parseFloat(rentAmount) || 0;
  const deposit = parseFloat(depositAmount) || 0;
  const total = rent + deposit;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (total <= 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/${rentalId}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          rent_amount: rent,
          deposit_amount: deposit,
          date,
          account: selectedAccount,
          note,
          screenshot_filename: screenshot?.name,
          screenshot_type: screenshot?.type,
        }),
      });
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
      className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2"
    >
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <Field label="Rent (₹)">
          <input
            type="number"
            min="0"
            step="1"
            value={rentAmount}
            onChange={(e) => setRentAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field
          label={
            depositOutstanding > 0
              ? `Deposit (₹) · ${formatINR(depositOutstanding)} pending`
              : "Deposit (₹)"
          }
        >
          <input
            type="number"
            min="0"
            step="1"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="Installment"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Date *">
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Into account *">
          <select
            value={selectedAccount}
            onChange={(e) => setAccount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {accounts.length === 0 && <option value="">No accounts</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Note">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="UPI ref / cash etc."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      </Field>
      {rent > 0 && deposit > 0 && (
        <div className="text-xs text-gray-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          Recording {formatINR(total)} as one receipt
          <span className="text-gray-500">
            {" "}
            (rent {formatINR(rent)} + deposit {formatINR(deposit)})
          </span>
        </div>
      )}
      <div className="flex items-end gap-3">
        <Field label="Screenshot (optional)">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setScreenshot(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-emerald-100"
          />
        </Field>
        <button
          type="submit"
          disabled={saving || total <= 0}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function RefundForm({
  rentalId,
  customerId,
  accounts,
  defaultAmount,
  defaultAccount,
  onSaved,
}: {
  rentalId: string;
  customerId: string;
  accounts: AccountOption[];
  defaultAmount: number;
  defaultAccount: string;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(
    defaultAmount > 0 ? String(defaultAmount) : ""
  );
  const [date, setDate] = useState(today);
  const [account, setAccount] = useState<string>(defaultAccount);
  const [note, setNote] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Default to the deposit's account, then any account.
  const selectedAccount = account || defaultAccount || accounts[0]?.id || "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/${rentalId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          amount: parseFloat(amount),
          date,
          account: selectedAccount,
          note,
          screenshot_filename: screenshot?.name,
          screenshot_type: screenshot?.type,
        }),
      });
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
      className="mt-3 bg-amber-50/60 border border-amber-200 rounded-lg p-3 space-y-2"
    >
      <div className="text-xs font-semibold text-amber-800">
        Refund deposit (money out)
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <Field label="Amount (₹) *">
          <input
            type="number"
            min="0"
            step="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Date *">
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="From account *">
          <select
            value={selectedAccount}
            onChange={(e) => setAccount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {accounts.length === 0 && <option value="">No accounts</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="UPI ref / cash etc."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
      </div>
      <div className="flex items-end gap-3">
        <Field label="Screenshot (optional)">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setScreenshot(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-100 file:text-amber-800 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-amber-200"
          />
        </Field>
        <button
          type="submit"
          disabled={saving}
          className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Refund"}
        </button>
      </div>
    </form>
  );
}

// Edit a rental's deposit *targets* after creation — e.g. you first recorded
// ₹1750 but ended up collecting ₹2000. The new deposit can't drop below what's
// already been collected, and refundable can't exceed the deposit.
function DepositEditForm({
  rentalId,
  customerId,
  currentSecurity,
  currentRefundable,
  collected,
  onSaved,
}: {
  rentalId: string;
  customerId: string;
  currentSecurity: number;
  currentRefundable: number;
  collected: number;
  onSaved: () => void;
}) {
  const [security, setSecurity] = useState(
    currentSecurity ? String(currentSecurity) : ""
  );
  const [refundable, setRefundable] = useState(
    currentRefundable ? String(currentRefundable) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const securityNum = parseFloat(security) || 0;
  const refundableNum = parseFloat(refundable) || 0;
  const tooLow = securityNum < collected;
  const refundOver = refundableNum > securityNum;
  const invalid = tooLow || refundOver;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/${rentalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          security_deposit: securityNum,
          refundable_deposit: refundableNum,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error || "Could not save");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-3 bg-sky-50/60 border border-sky-200 rounded-lg p-3 space-y-2"
    >
      <div className="text-xs font-semibold text-sky-800">
        Edit deposit targets
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="Security deposit (₹)">
          <input
            type="number"
            min="0"
            step="1"
            value={security}
            onChange={(e) => setSecurity(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Refundable on return (₹)">
          <input
            type="number"
            min="0"
            step="1"
            value={refundable}
            onChange={(e) => setRefundable(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
      </div>
      {collected > 0 && (
        <div className="text-xs text-gray-600">
          ₹{collected.toLocaleString("en-IN")} already collected — the deposit
          can&apos;t be set below this.
        </div>
      )}
      {tooLow && (
        <div className="text-xs text-red-600">
          Deposit can&apos;t be below the {formatINR(collected)} already
          collected.
        </div>
      )}
      {refundOver && (
        <div className="text-xs text-red-600">
          Refundable can&apos;t exceed the security deposit.
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}
      <button
        type="submit"
        disabled={saving || invalid}
        className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save deposit"}
      </button>
    </form>
  );
}

function SwapForm({
  rentalId,
  customerId,
  currentLabel,
  onSaved,
}: {
  rentalId: string;
  customerId: string;
  currentLabel: string;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [label, setLabel] = useState("");
  const [swapDate, setSwapDate] = useState(today);
  const [note, setNote] = useState("");
  const [startKms, setStartKms] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!label.trim()) {
      setError("Enter the new scooty.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/${rentalId}/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          scooty_label: label.trim(),
          swap_date: swapDate,
          note: note.trim() || undefined,
          start_kms: startKms ? parseInt(startKms, 10) : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to swap");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-3 bg-sky-50/60 border border-sky-200 rounded-lg p-3 space-y-2"
    >
      <div className="text-xs font-semibold text-sky-800">
        Swap scooty — currently {currentLabel}
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <Field label="New scooty *">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            placeholder="MH12 XY 9999"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Swap date *">
          <input
            type="date"
            required
            value={swapDate}
            onChange={(e) => setSwapDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Odometer reading (km) *">
          <input
            type="number"
            min="0"
            step="1"
            required
            value={startKms}
            onChange={(e) => setStartKms(e.target.value)}
            placeholder="e.g. 15000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Reason / note">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. customer complaint"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
      </div>
      <button
        type="submit"
        disabled={saving}
        className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Record swap"}
      </button>
    </form>
  );
}

function KmsForm({
  rentalId,
  customerId,
  onSaved,
  onCancel,
}: {
  rentalId: string;
  customerId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [kms, setKms] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const kmsNum = parseInt(kms, 10);
    if (isNaN(kmsNum) || kmsNum < 0) {
      setError("Enter a non-negative odometer reading.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/${rentalId}/kms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          kms: kmsNum,
          date,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to log odometer.");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-3 bg-orange-50/60 border border-orange-200 rounded-lg p-3 space-y-2"
    >
      <div className="text-xs font-semibold text-orange-800">
        Log Odometer Reading (km)
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Odometer (km) *">
          <input
            type="number"
            min="0"
            step="1"
            required
            value={kms}
            onChange={(e) => setKms(e.target.value)}
            placeholder="e.g. 15420"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Date *">
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Note">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. regular checkup"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Record Odometer"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-sm text-gray-600 hover:text-gray-800 px-4 py-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface IdDraft {
  id?: string;
  type: IdType;
  number: string;
  originalSubmitted: boolean;
  createdAt?: string;
}

function IdsSection({
  customerId,
  initialIds,
  onChange,
}: {
  customerId: string;
  initialIds: CustomerIdView[];
  onChange: () => void;
}) {
  // Track an editing draft separately from the view list so the user can edit
  // without their in-flight changes being clobbered by a refresh.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IdDraft[]>(() => toDraft(initialIds));
  const [saving, setSaving] = useState(false);

  // Reset draft when entering edit mode (latest committed state).
  const startEdit = () => {
    setDraft(toDraft(initialIds));
    setEditing(true);
  };

  const updateRow = (idx: number, patch: Partial<IdDraft>) =>
    setDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () =>
    setDraft((prev) => [
      ...prev,
      { type: "aadhaar", number: "", originalSubmitted: false },
    ]);
  const removeRow = (idx: number) =>
    setDraft((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    try {
      const payload = draft
        .filter((r) => r.number.trim())
        .map((r) => ({
          id: r.id,
          type: r.type,
          number: r.number.trim(),
          original_submitted: r.originalSubmitted,
          created_at: r.createdAt,
        }));
      await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: payload }),
      });
      setEditing(false);
      onChange();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">IDs</h2>
        {!editing ? (
          <button
            onClick={startEdit}
            className="text-sm text-emerald-700 hover:text-emerald-900 font-medium"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-sm bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {!editing ? (
        initialIds.length === 0 ? (
          <p className="text-sm text-gray-500">
            No IDs recorded. Click <span className="font-medium">Edit</span> to add.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {initialIds.map((rec) => (
              <li
                key={rec.id}
                className="flex items-center justify-between py-2 gap-3"
              >
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">
                    {ID_TYPE_LABELS[rec.type]}
                  </span>
                  <span className="text-gray-500 mx-2">·</span>
                  <span className="font-mono text-sm text-gray-700">
                    {rec.number}
                  </span>
                </div>
                {rec.originalSubmitted && (
                  <span className="text-[11px] uppercase tracking-wide bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-full">
                    Original held
                  </span>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-2">
          {draft.map((row, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
              <select
                value={row.type}
                onChange={(e) =>
                  updateRow(idx, { type: e.target.value as IdType })
                }
                className="col-span-4 sm:col-span-3 border border-gray-300 rounded-lg px-2 py-2 text-sm"
              >
                {ID_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={row.number}
                onChange={(e) => updateRow(idx, { number: e.target.value })}
                placeholder="Number"
                className="col-span-5 sm:col-span-5 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <label className="col-span-2 sm:col-span-3 inline-flex items-center gap-1.5 text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={row.originalSubmitted}
                  onChange={(e) =>
                    updateRow(idx, { originalSubmitted: e.target.checked })
                  }
                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                Original
              </label>
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="col-span-1 px-2 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                aria-label="Remove ID"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="text-sm text-emerald-600 hover:text-emerald-800 font-medium"
          >
            + Add another ID
          </button>
        </div>
      )}
    </section>
  );
}

function toDraft(ids: CustomerIdView[]): IdDraft[] {
  if (ids.length === 0) {
    return [{ type: "aadhaar", number: "", originalSubmitted: false }];
  }
  return ids.map((r) => ({
    id: r.id,
    type: r.type,
    number: r.number,
    originalSubmitted: r.originalSubmitted,
    createdAt: r.createdAt,
  }));
}
