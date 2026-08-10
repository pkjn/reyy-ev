"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatINR, RateUnit } from "@/lib/billing";

interface Rental {
  id: string;
  customer_id: string;
  customer_name: string;
  scooty_label: string;
  start_date: string;
  end_date: string | null;
  rate: number;
  rate_unit: RateUnit;
  created_at: string;
}

export default function RentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "closed">("active");

  useEffect(() => {
    fetch("/api/rentals")
      .then((r) => r.json())
      .then((data: Rental[]) => {
        setRentals(data);
        setLoading(false);
      });
  }, []);

  const filtered = rentals.filter((r) => {
    if (filter === "active") return !r.end_date;
    if (filter === "closed") return !!r.end_date;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Rentals</h1>
        <div className="flex border border-gray-300 rounded-lg overflow-hidden text-sm">
          {(["active", "closed", "all"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setFilter(opt)}
              className={`px-3 py-1.5 ${
                filter === opt
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt[0].toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Create new rentals from a customer&apos;s page.
      </p>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No rentals to show</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-3 py-2">Customer</th>
                <th className="text-left font-medium px-3 py-2">Scooty</th>
                <th className="text-left font-medium px-3 py-2 whitespace-nowrap">
                  Start
                </th>
                <th className="text-left font-medium px-3 py-2 whitespace-nowrap">
                  End
                </th>
                <th className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  Rate
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <Link
                      href={`/customers/${r.customer_id}`}
                      className="text-emerald-700 hover:text-emerald-900 font-medium"
                    >
                      {r.customer_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-800">{r.scooty_label}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                    {r.start_date}
                  </td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                    {r.end_date || (
                      <span className="text-emerald-700 font-medium">active</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-gray-900">
                    {formatINR(r.rate)}/{r.rate_unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
