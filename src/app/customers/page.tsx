"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ID_TYPES, IdType } from "@/lib/idTypes";

interface Customer {
  id: string;
  name: string;
  phones: string[];
  address: string | null;
  map_location: string | null;
  id_count: number;
  rental_count: number;
  active_rentals: number;
  created_at: string;
}

interface IdRow {
  type: IdType;
  number: string;
  originalSubmitted: boolean;
}

const emptyIdRow = (): IdRow => ({
  type: "aadhaar",
  number: "",
  originalSubmitted: false,
});

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [phones, setPhones] = useState<string[]>([""]);
  const [address, setAddress] = useState("");
  const [mapLocation, setMapLocation] = useState("");
  const [ids, setIds] = useState<IdRow[]>([emptyIdRow()]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchCustomers = async () => {
    const res = await fetch("/api/customers");
    setCustomers(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const resetForm = () => {
    setName("");
    setPhones([""]);
    setAddress("");
    setMapLocation("");
    setIds([emptyIdRow()]);
  };

  const updatePhone = (idx: number, val: string) =>
    setPhones((prev) => prev.map((p, i) => (i === idx ? val : p)));
  const addPhone = () => setPhones((prev) => [...prev, ""]);
  const removePhone = (idx: number) =>
    setPhones((prev) =>
      prev.length === 1 ? [""] : prev.filter((_, i) => i !== idx)
    );

  const updateId = (idx: number, patch: Partial<IdRow>) =>
    setIds((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addId = () => setIds((prev) => [...prev, emptyIdRow()]);
  const removeId = (idx: number) =>
    setIds((prev) =>
      prev.length === 1 ? [emptyIdRow()] : prev.filter((_, i) => i !== idx)
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleanedPhones = phones.map((p) => p.trim()).filter(Boolean);
      const cleanedIds = ids
        .filter((r) => r.number.trim())
        .map((r) => ({
          type: r.type,
          number: r.number.trim(),
          original_submitted: r.originalSubmitted,
        }));
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phones: cleanedPhones,
          address,
          map_location: mapLocation,
          ids: cleanedIds,
        }),
      });
      const created = (await res.json()) as { id: string };
      resetForm();
      setShowForm(false);
      // Land on the new customer's page so the user can upload photos next.
      router.push(`/customers/${created.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Customers</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          {showForm ? "Cancel" : "+ Add Customer"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg border border-gray-200 p-6 mb-6 space-y-5"
        >
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
              placeholder="Customer name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone numbers
            </label>
            <div className="space-y-2">
              {phones.map((p, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="tel"
                    value={p}
                    onChange={(e) => updatePhone(idx, e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder={`Phone ${idx + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removePhone(idx)}
                    disabled={phones.length === 1 && !p}
                    className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Remove phone"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addPhone}
                className="text-sm text-emerald-600 hover:text-emerald-800 font-medium"
              >
                + Add another number
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Address"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              House location <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={mapLocation}
              onChange={(e) => setMapLocation(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Paste a Google Maps link or coordinates"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              IDs
            </label>
            <div className="space-y-2">
              {ids.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center"
                >
                  <select
                    value={row.type}
                    onChange={(e) =>
                      updateId(idx, { type: e.target.value as IdType })
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
                    onChange={(e) =>
                      updateId(idx, { number: e.target.value })
                    }
                    placeholder="Number"
                    className="col-span-5 sm:col-span-5 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <label className="col-span-2 sm:col-span-3 inline-flex items-center gap-1.5 text-xs text-gray-700 select-none">
                    <input
                      type="checkbox"
                      checked={row.originalSubmitted}
                      onChange={(e) =>
                        updateId(idx, { originalSubmitted: e.target.checked })
                      }
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Original
                  </label>
                  <button
                    type="button"
                    onClick={() => removeId(idx)}
                    disabled={ids.length === 1 && !row.number}
                    className="col-span-1 px-2 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Remove ID"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addId}
                className="text-sm text-emerald-600 hover:text-emerald-800 font-medium"
              >
                + Add another ID
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Tick &ldquo;Original&rdquo; if the customer handed over the
              physical document.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save & add photos →"}
            </button>
            <span className="text-xs text-gray-500">
              You&apos;ll be taken to the customer page to upload photos.
            </span>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No customers yet</p>
          <p className="text-sm mt-1">Add your first customer to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {customers.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="block bg-white rounded-lg border border-gray-200 p-5 hover:border-emerald-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-semibold text-lg">{c.name}</h2>
                  <div className="text-sm text-gray-500 mt-1 space-x-4">
                    {c.phones.length > 0 && <span>{c.phones.join(", ")}</span>}
                    {c.address && <span>{c.address}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0 flex flex-wrap items-center justify-end gap-2">
                  {c.active_rentals > 0 && (
                    <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-sm font-medium px-3 py-1 rounded-full">
                      {c.active_rentals} active
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full">
                    {c.rental_count} rental
                    {c.rental_count !== 1 ? "s" : ""}
                  </span>
                  {c.id_count > 0 && (
                    <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-sm font-medium px-3 py-1 rounded-full">
                      {c.id_count} ID
                      {c.id_count !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
