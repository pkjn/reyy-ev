"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/billing";

interface RentalEntry {
  customer_id: string;
  customer_name: string;
  customer_phones: string[];
  rental_id: string;
  scooty_label: string;
  paid_through: string | null;
  days_remaining: number;
}

interface DepositEntry {
  customer_id: string;
  customer_name: string;
  customer_phones: string[];
  rental_id: string;
  scooty_label: string;
  deposit_target: number;
  deposit_collected: number;
  deposit_pending: number;
}

interface DashboardData {
  customer_count: number;
  active_rentals: number;
  blocked_count: number;
  due_today_count: number;
  paid_up_count: number;
  deposit_pending_count: number;
  deposit_pending_total: number;
  blocked: RentalEntry[];
  due_today: RentalEntry[];
  paid_up: RentalEntry[];
  deposit_pending: DepositEntry[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d: DashboardData) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      {loading || !data ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <KpiCard
              label="Blocked"
              value={String(data.blocked_count)}
              tone="red"
            />
            <KpiCard
              label="Due today"
              value={String(data.due_today_count)}
              tone="amber"
            />
            <KpiCard
              label="Paid up"
              value={String(data.paid_up_count)}
              tone="emerald"
            />
          </div>

          {data.blocked.length > 0 && (
            <RentalList
              title="Blocked — no rent for today"
              items={data.blocked}
              tone="red"
            />
          )}

          {data.due_today.length > 0 && (
            <RentalList
              title="Due today — collect before EOD"
              items={data.due_today}
              tone="amber"
            />
          )}

          {data.deposit_pending.length > 0 && (
            <DepositList
              title={`Deposit pending — ${formatINR(
                data.deposit_pending_total
              )} still owed`}
              items={data.deposit_pending}
            />
          )}

          {data.paid_up.length > 0 && (
            <RentalList
              title="Paid up — upcoming renewals"
              items={data.paid_up}
              tone="emerald"
            />
          )}

          {data.active_rentals === 0 && (
            <p className="text-center py-12 text-gray-500">
              No active rentals yet.
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            <KpiCard
              label="Active rentals"
              value={String(data.active_rentals)}
            />
            <KpiCard
              label="Customers"
              value={String(data.customer_count)}
            />
            <KpiCard
              label="Deposit pending"
              value={String(data.deposit_pending_count)}
              tone={data.deposit_pending_count > 0 ? "sky" : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "amber" | "emerald" | "sky";
}) {
  const valueClass = {
    red: "text-red-700",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
    sky: "text-sky-700",
  }[tone || "emerald"];
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${tone ? valueClass : "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

function RentalList({
  title,
  items,
  tone,
}: {
  title: string;
  items: RentalEntry[];
  tone: "red" | "amber" | "emerald";
}) {
  const styles = {
    red: "bg-red-50 border-red-200",
    amber: "bg-amber-50 border-amber-200",
    emerald: "bg-emerald-50 border-emerald-200",
  }[tone];
  return (
    <section className={`border rounded-lg ${styles}`}>
      <div className="px-4 py-2 border-b border-black/5">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="bg-white overflow-x-auto rounded-b-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Customer</th>
              <th className="text-left font-medium px-3 py-2">Phone</th>
              <th className="text-left font-medium px-3 py-2">Scooty</th>
              <th className="text-left font-medium px-3 py-2 whitespace-nowrap">
                Paid through
              </th>
              <th className="text-right font-medium px-3 py-2 whitespace-nowrap">
                Coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.rental_id}
                className="border-t border-gray-100 hover:bg-gray-50"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/customers/${it.customer_id}`}
                    className="text-emerald-700 hover:text-emerald-900 font-medium"
                  >
                    {it.customer_name || "—"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {it.customer_phones.length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    it.customer_phones.map((p, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        <a
                          href={`tel:${p}`}
                          className="text-emerald-700 hover:text-emerald-900"
                        >
                          {p}
                        </a>
                      </span>
                    ))
                  )}
                </td>
                <td className="px-3 py-2 text-gray-800">{it.scooty_label}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {it.paid_through || "—"}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <CoveragePill days={it.days_remaining} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DepositList({
  title,
  items,
}: {
  title: string;
  items: DepositEntry[];
}) {
  return (
    <section className="border rounded-lg bg-sky-50 border-sky-200">
      <div className="px-4 py-2 border-b border-black/5">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="bg-white overflow-x-auto rounded-b-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Customer</th>
              <th className="text-left font-medium px-3 py-2">Phone</th>
              <th className="text-left font-medium px-3 py-2">Scooty</th>
              <th className="text-left font-medium px-3 py-2 whitespace-nowrap">
                Collected
              </th>
              <th className="text-right font-medium px-3 py-2 whitespace-nowrap">
                Pending
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.rental_id}
                className="border-t border-gray-100 hover:bg-gray-50"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/customers/${it.customer_id}`}
                    className="text-emerald-700 hover:text-emerald-900 font-medium"
                  >
                    {it.customer_name || "—"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {it.customer_phones.length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    it.customer_phones.map((p, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        <a
                          href={`tel:${p}`}
                          className="text-emerald-700 hover:text-emerald-900"
                        >
                          {p}
                        </a>
                      </span>
                    ))
                  )}
                </td>
                <td className="px-3 py-2 text-gray-800">{it.scooty_label}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {formatINR(it.deposit_collected)} of{" "}
                  {formatINR(it.deposit_target)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <span className="inline-block bg-sky-100 text-sky-800 text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded">
                    {formatINR(it.deposit_pending)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CoveragePill({ days }: { days: number }) {
  if (days < 0) {
    const behind = Math.abs(days);
    return (
      <span className="inline-block bg-red-600 text-white text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded">
        Block · {behind}d unpaid
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="inline-block bg-amber-500 text-white text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded">
        Due today
      </span>
    );
  }
  return (
    <span className="inline-block bg-emerald-100 text-emerald-800 text-xs font-semibold px-2 py-0.5 rounded">
      {days} day{days === 1 ? "" : "s"} left
    </span>
  );
}
