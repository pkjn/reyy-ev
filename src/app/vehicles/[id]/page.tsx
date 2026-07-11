"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { JourneyLeg, OdometerReading } from "@/lib/vehicles";

interface VehicleDetail {
  id: string;
  number: string;
  make: string;
  chassis_number: string;
  battery_provider: string;
  created_at: string;
  journey: JourneyLeg[];
  odometer: OdometerReading[];
  latest_km: number | null;
  total_km: number | null;
}

const km = (n: number) => `${n.toLocaleString("en-IN")} km`;

export default function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<VehicleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/vehicles/${id}`);
    if (!res.ok) {
      setError("Vehicle not found");
      setLoading(false);
      return;
    }
    setData(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return null;

  const current = data.journey.find((l) => l.current) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/vehicles"
            className="text-sm text-emerald-700 hover:text-emerald-900"
          >
            ← Back to vehicles
          </Link>
          <h1 className="text-2xl font-bold mt-1 flex flex-wrap items-center gap-2">
            {data.number}
            {current ? (
              <span className="text-[11px] font-medium uppercase tracking-wide text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">
                On rent
              </span>
            ) : (
              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                Available
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {data.make} · Chassis {data.chassis_number} · {data.battery_provider}
          </p>
          {current && (
            <p className="text-sm text-gray-700 mt-1">
              Currently with{" "}
              <Link
                href={`/customers/${current.customer_id}`}
                className="text-emerald-700 hover:text-emerald-900 font-medium"
              >
                {current.customer_name}
              </Link>
              <span className="text-gray-500"> · since {current.from}</span>
            </p>
          )}
        </div>
      </div>

      <JourneySection journey={data.journey} />

      <OdometerSection
        vehicleId={id}
        odometer={data.odometer}
        latestKm={data.latest_km}
        totalKm={data.total_km}
        onChange={() => {
          refresh();
          router.refresh();
        }}
      />
    </div>
  );
}

function JourneySection({ journey }: { journey: JourneyLeg[] }) {
  const customers = new Set(journey.map((l) => l.customer_id));
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Journey</h2>
        {journey.length > 0 && (
          <span className="text-xs text-gray-500">
            {journey.length} stint{journey.length === 1 ? "" : "s"} ·{" "}
            {customers.size} customer{customers.size === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {journey.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6 bg-gray-50 border border-gray-200 rounded-lg">
          This vehicle hasn&apos;t been out on any rental yet.
        </p>
      ) : (
        <ol className="relative border-l-2 border-gray-200 ml-2 space-y-5">
          {journey.map((leg, i) => (
            <li key={`${leg.rental_id}-${leg.from}-${i}`} className="ml-4">
              <span
                className={`absolute -left-[7px] w-3 h-3 rounded-full border-2 border-white ${
                  leg.current ? "bg-emerald-500" : "bg-gray-300"
                }`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/customers/${leg.customer_id}`}
                  className="font-medium text-emerald-700 hover:text-emerald-900"
                >
                  {leg.customer_name}
                </Link>
                {leg.current && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">
                    Current
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {leg.from} → {leg.to || "now"}
              </div>
              {(leg.handover_note || leg.return_note) && (
                <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                  {leg.handover_note && (
                    <div>
                      <span className="text-gray-400">handed over:</span>{" "}
                      {leg.handover_note}
                    </div>
                  )}
                  {leg.return_note && (
                    <div>
                      <span className="text-gray-400">swapped out:</span>{" "}
                      {leg.return_note}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function OdometerSection({
  vehicleId,
  odometer,
  latestKm,
  totalKm,
  onChange,
}: {
  vehicleId: string;
  odometer: OdometerReading[];
  latestKm: number | null;
  totalKm: number | null;
  onChange: () => void;
}) {
  const [showForm, setShowForm] = useState(false);

  const handleDelete = async (r: OdometerReading) => {
    if (!confirm(`Delete the ${km(r.km)} reading from ${r.date}?`)) return;
    await fetch(
      `/api/vehicles/${vehicleId}/odometer/${r.id}?date=${r.date}`,
      { method: "DELETE" }
    );
    onChange();
  };

  // Newest first for display, with the gain since the previous (older) reading.
  const rows = odometer
    .map((r, i) => ({
      ...r,
      delta: i > 0 ? r.km - odometer[i - 1].km : null,
    }))
    .reverse();

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Odometer</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          {showForm ? "Cancel" : "+ Log reading"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Latest reading
          </p>
          <p className="text-2xl font-bold mt-1 text-gray-900">
            {latestKm != null ? km(latestKm) : "—"}
          </p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Distance logged
          </p>
          <p className="text-2xl font-bold mt-1 text-emerald-700">
            {totalKm != null ? km(totalKm) : "—"}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            since first reading
          </p>
        </div>
      </div>

      {showForm && (
        <OdometerForm
          vehicleId={vehicleId}
          lastKm={latestKm}
          onSaved={() => {
            setShowForm(false);
            onChange();
          }}
        />
      )}

      {odometer.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6 bg-gray-50 border border-gray-200 rounded-lg">
          No readings yet. Log the current odometer to start tracking this
          scooter&apos;s life.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="text-gray-700">{r.date}</span>
                {r.note && (
                  <span className="text-gray-500"> · {r.note}</span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {r.delta != null && (
                  <span
                    className={`text-xs ${
                      r.delta >= 0 ? "text-gray-400" : "text-amber-600"
                    }`}
                  >
                    {r.delta >= 0 ? "+" : "−"}
                    {Math.abs(r.delta).toLocaleString("en-IN")}
                  </span>
                )}
                <span className="font-medium tabular-nums text-gray-900">
                  {km(r.km)}
                </span>
                <button
                  onClick={() => handleDelete(r)}
                  className="text-xs text-red-600 hover:underline"
                >
                  delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OdometerForm({
  vehicleId,
  lastKm,
  onSaved,
}: {
  vehicleId: string;
  lastKm: number | null;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [kmValue, setKmValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseFloat(kmValue);
  const goesDown = lastKm != null && !isNaN(parsed) && parsed < lastKm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isNaN(parsed) || parsed < 0) {
      setError("Enter the current km reading.");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/vehicles/${vehicleId}/odometer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, km: parsed, note: note.trim() || undefined }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Failed to save");
      return;
    }
    onSaved();
  };

  return (
    <form
      onSubmit={submit}
      className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3"
    >
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Date *
          </label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Odometer (km) *
          </label>
          <input
            type="number"
            min="0"
            step="1"
            required
            value={kmValue}
            onChange={(e) => setKmValue(e.target.value)}
            placeholder={lastKm != null ? `last: ${lastKm}` : "e.g. 3450"}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Note
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. at service"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>
      {goesDown && (
        <p className="text-xs text-amber-700">
          This is lower than the last reading ({km(lastKm!)}). Saving anyway is
          fine (e.g. odometer/cluster replaced) — just double-check.
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save reading"}
      </button>
    </form>
  );
}
