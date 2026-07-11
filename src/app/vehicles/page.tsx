"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Vehicle, VEHICLE_MAKES, BATTERY_PROVIDERS } from "@/lib/vehicles";

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [number, setNumber] = useState("");
  const [make, setMake] = useState<string>(VEHICLE_MAKES[0]);
  const [chassis, setChassis] = useState("");
  const [battery, setBattery] = useState<string>(BATTERY_PROVIDERS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVehicles = async () => {
    const res = await fetch("/api/vehicles");
    setVehicles(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  const resetForm = () => {
    setNumber("");
    setMake(VEHICLE_MAKES[0]);
    setChassis("");
    setBattery(BATTERY_PROVIDERS[0]);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!number.trim() || !make.trim() || !chassis.trim() || !battery.trim()) {
      setError("All fields are required.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        number: number.trim(),
        make: make.trim(),
        chassis_number: chassis.trim(),
        battery_provider: battery.trim(),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Failed to save");
      return;
    }
    resetForm();
    setShowForm(false);
    fetchVehicles();
  };

  const handleDelete = async (v: Vehicle) => {
    if (!confirm(`Delete vehicle "${v.number}"?`)) return;
    const res = await fetch(`/api/vehicles/${v.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to delete");
      return;
    }
    fetchVehicles();
  };

  const assignedCount = vehicles.filter((v) => v.assignment).length;
  const availableCount = vehicles.length - assignedCount;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Vehicles</h1>
        <button
          onClick={() => {
            resetForm();
            setShowForm(!showForm);
          }}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          {showForm ? "Cancel" : "+ Add Vehicle"}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Number (plate) *
              </label>
              <input
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="MH12 AB 1234"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Make *
              </label>
              <select
                value={make}
                onChange={(e) => setMake(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {VEHICLE_MAKES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Chassis number *
              </label>
              <input
                type="text"
                value={chassis}
                onChange={(e) => setChassis(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g. MD9ABCD1234567890"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Battery provider *
              </label>
              <select
                value={battery}
                onChange={(e) => setBattery(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {BATTERY_PROVIDERS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Vehicle"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No vehicles yet</p>
          <p className="text-sm mt-1">
            Add your scooters here, then pick them when creating a rental.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <SummaryTile label="Total" value={vehicles.length} />
            <SummaryTile label="On rent" value={assignedCount} tone="emerald" />
            <SummaryTile label="Available" value={availableCount} tone="gray" />
          </div>
          <div className="grid gap-4">
            {vehicles.map((v) => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                onDelete={() => handleDelete(v)}
                onChange={fetchVehicles}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: number;
  tone?: "emerald" | "gray";
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p
        className={`text-2xl font-bold mt-1 ${
          tone === "emerald" ? "text-emerald-700" : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function VehicleCard({
  vehicle,
  onDelete,
  onChange,
}: {
  vehicle: Vehicle;
  onDelete: () => void;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [make, setMake] = useState(vehicle.make);
  const [chassis, setChassis] = useState(vehicle.chassis_number);
  const [battery, setBattery] = useState(vehicle.battery_provider);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setMake(vehicle.make);
    setChassis(vehicle.chassis_number);
    setBattery(vehicle.battery_provider);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!make.trim() || !chassis.trim() || !battery.trim()) {
      setError("Fields cannot be empty.");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/vehicles/${vehicle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        make: make.trim(),
        chassis_number: chassis.trim(),
        battery_provider: battery.trim(),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Failed to save");
      return;
    }
    setEditing(false);
    onChange();
  };

  const a = vehicle.assignment;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-lg flex flex-wrap items-center gap-2">
            <Link
              href={`/vehicles/${vehicle.id}`}
              className="hover:text-emerald-700"
            >
              {vehicle.number}
            </Link>
            {a ? (
              <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">
                On rent
              </span>
            ) : (
              <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                Available
              </span>
            )}
            {vehicle.latest_km != null && (
              <span className="text-xs font-normal text-gray-500">
                · {vehicle.latest_km.toLocaleString("en-IN")} km
              </span>
            )}
          </h2>
          {!editing ? (
            <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <Spec label="Make" value={vehicle.make} />
              <Spec label="Chassis no." value={vehicle.chassis_number} />
              <Spec label="Battery" value={vehicle.battery_provider} />
            </dl>
          ) : (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SelectField
                label="Make"
                value={make}
                onChange={setMake}
                options={VEHICLE_MAKES}
              />
              <EditField
                label="Chassis no."
                value={chassis}
                onChange={setChassis}
              />
              <SelectField
                label="Battery"
                value={battery}
                onChange={setBattery}
                options={BATTERY_PROVIDERS}
              />
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <div className="mt-3 text-sm">
            {a ? (
              <p className="text-gray-700">
                Rented to{" "}
                <Link
                  href={`/customers/${a.customer_id}`}
                  className="text-emerald-700 hover:text-emerald-900 font-medium"
                >
                  {a.customer_name}
                </Link>
                {a.since && (
                  <span className="text-gray-500"> · since {a.since}</span>
                )}
              </p>
            ) : (
              <p className="text-gray-500">Not assigned to any customer.</p>
            )}
          </div>
          <Link
            href={`/vehicles/${vehicle.id}`}
            className="inline-block mt-2 text-sm text-emerald-700 hover:text-emerald-900 font-medium"
          >
            Journey &amp; odometer →
          </Link>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {!editing ? (
            <>
              <button
                onClick={startEdit}
                className="text-sm text-emerald-700 hover:text-emerald-900 font-medium"
              >
                Edit
              </button>
              <button
                onClick={onDelete}
                className="text-sm text-red-600 hover:text-red-800 font-medium"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="text-sm bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="font-medium text-gray-900 break-words">{value || "—"}</dd>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  // Keep any legacy stored value selectable even if it's no longer in the
  // canonical list, so editing another field never silently rewrites it.
  const opts = options.includes(value) ? options : [value, ...options];
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
