// Driver home page — rendered inside the WebView.
//
// Server component that reads the reyy_driver cookie, verifies the JWT,
// and renders the driver's rental status (rent, deposit, payment balances).
// If the JWT is missing/expired, shows a "session expired" page that
// triggers the native app's logout flow via a JS bridge call.

import { cookies } from "next/headers";
import { verifyDriverJwt } from "@/lib/jwt";
import { buildDriverHomePayload } from "@/lib/driverHome";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatINR(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default async function DriverHomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("reyy_driver")?.value;

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-bold text-gray-900">Session Expired</h1>
          <p className="text-gray-600">Please log in again.</p>
          <script
            dangerouslySetInnerHTML={{
              __html: `
                try { window.ReactNativeWebView?.postMessage?.('logout'); }
                catch(e) {}
                try { Android?.logout?.(); }
                catch(e) {}
              `,
            }}
          />
        </div>
      </div>
    );
  }

  let claims;
  try {
    claims = await verifyDriverJwt(token);
  } catch {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-bold text-gray-900">Session Expired</h1>
          <p className="text-gray-600">Your login has expired. Please log in again.</p>
          <script
            dangerouslySetInnerHTML={{
              __html: `
                try { window.ReactNativeWebView?.postMessage?.('logout'); }
                catch(e) {}
                try { Android?.logout?.(); }
                catch(e) {}
              `,
            }}
          />
        </div>
      </div>
    );
  }

  const data = await buildDriverHomePayload(claims.sub);

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-bold text-gray-900">No Active Rental</h1>
          <p className="text-gray-600">
            Contact operations for assistance.
          </p>
          {data === null && (
            <p className="text-sm text-gray-500">
              If you believe this is an error, please call your operations team.
            </p>
          )}
        </div>
      </div>
    );
  }

  const r = data.rental;
  const daysColor =
    r.days_remaining > 3
      ? "text-emerald-600"
      : r.days_remaining > 0
        ? "text-amber-600"
        : "text-red-600";

  const statusBadge =
    r.coverage_status === "paid"
      ? "bg-emerald-100 text-emerald-800"
      : r.coverage_status === "due_today"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";

  const statusText =
    r.coverage_status === "paid"
      ? "Paid"
      : r.coverage_status === "due_today"
        ? "Due Today"
        : "Overdue";

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="bg-emerald-600 rounded-xl p-5 text-white">
        <p className="text-sm opacity-80">Welcome</p>
        <h1 className="text-xl font-bold">{data.customer_name}</h1>
        <p className="text-sm mt-1 opacity-90">🛵 {r.scooty_label}</p>
      </div>

      {/* Rent Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Rent</h2>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge}`}
          >
            {statusText}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500">Rate</p>
            <p className="text-sm font-medium">
              {formatINR(r.rate)}/{r.rate_unit}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Paid Through</p>
            <p className="text-sm font-medium">
              {r.paid_through ? formatDate(r.paid_through) : "—"}
            </p>
          </div>
        </div>
        <div className="text-center pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500">Days Remaining</p>
          <p className={`text-3xl font-bold ${daysColor}`}>
            {r.days_remaining}
          </p>
        </div>
      </div>

      {/* Deposit Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Security Deposit</h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-gray-500">Target</p>
            <p className="text-sm font-medium">
              {formatINR(r.security_deposit)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Collected</p>
            <p className="text-sm font-medium text-emerald-600">
              {formatINR(r.deposit_collected)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Pending</p>
            <p
              className={`text-sm font-medium ${r.deposit_pending > 0 ? "text-amber-600" : "text-gray-400"}`}
            >
              {formatINR(r.deposit_pending)}
            </p>
          </div>
        </div>
      </div>

      {/* Payment Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Payment</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500">Total Paid</p>
            <p className="text-sm font-medium text-emerald-600">
              {formatINR(r.total_paid)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Outstanding</p>
            <p
              className={`text-sm font-medium ${r.outstanding > 0 ? "text-red-600" : "text-gray-400"}`}
            >
              {formatINR(r.outstanding)}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        {data.support_phone && (
          <a
            href={`tel:${data.support_phone}`}
            className="inline-flex items-center gap-1.5 text-sm text-emerald-700 font-medium"
          >
            📞 Call Support
          </a>
        )}
        <button
          id="btn-logout"
          className="text-sm text-red-600 font-medium"
          onClick={undefined}
        >
          Logout
        </button>
      </div>

      {/* Logout script — calls the native app bridge and the server-side cookie clear */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.getElementById('btn-logout')?.addEventListener('click', async function() {
              try { await fetch('/driver/logout', { method: 'POST' }); } catch(e) {}
              try { window.ReactNativeWebView?.postMessage?.('logout'); } catch(e) {}
              try { Android?.logout?.(); } catch(e) {}
            });
          `,
        }}
      />
    </div>
  );
}
