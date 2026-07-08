// Driver home page — rendered inside the WebView.
//
// Server component that reads the reyy_driver cookie, verifies the JWT,
// and renders the driver's rental status (rent, deposit, payment balances).
// If the JWT is missing/expired, shows a "session expired" page that
// triggers the native app's logout flow via a JS bridge call.

import { cookies } from "next/headers";
import { verifyDriverJwt } from "@/lib/jwt";
import { buildDriverHomePayload } from "@/lib/driverHome";
import fs from "fs/promises";
import path from "path";

function formatDate(dateStr: string, lang: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatINR(n: number, lang: string): string {
  return `₹${Math.round(n).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN")}`;
}

const translations = {
  en: {
    sessionExpired: "Session Expired",
    loginAgain: "Please log in again.",
    noActiveRental: "No Active Rental",
    contactOps: "Contact operations for assistance.",
    callError: "If you believe this is an error, please call your operations team.",
    welcome: "Welcome",
    rent: "Rent",
    rate: "Rate",
    paidThrough: "Paid Through",
    daysRemaining: "Days Remaining",
    securityDeposit: "Security Deposit",
    target: "Target",
    collected: "Collected",
    pending: "Pending",
    payment: "Payment",
    totalPaid: "Total Paid",
    outstanding: "Outstanding",
    callSupport: "📞 Call Support",
    logout: "Logout",
    paid: "Paid",
    dueToday: "Due Today",
    overdue: "Overdue",
    driver: "Driver",
  },
  hi: {
    sessionExpired: "सत्र समाप्त (Session Expired)",
    loginAgain: "कृपया फिर से लॉगिन करें।",
    noActiveRental: "कोई सक्रिय रेंटल नहीं",
    contactOps: "सहायता के लिए संचालन टीम से संपर्क करें।",
    callError: "यदि आपको लगता है कि यह कोई त्रुटि है, तो कृपया अपनी संचालन टीम को कॉल करें।",
    welcome: "नमस्ते",
    rent: "किराया (Rent)",
    rate: "दर (Rate)",
    paidThrough: "यहाँ तक भुगतान किया (Paid Through)",
    daysRemaining: "शेष दिन",
    securityDeposit: "सुरक्षा जमा (Deposit)",
    target: "कुल जमा",
    collected: "प्राप्त हुआ",
    pending: "बकाया",
    payment: "भुगतान",
    totalPaid: "कुल भुगतान किया",
    outstanding: "बकाया राशि",
    callSupport: "📞 सपोर्ट को कॉल करें",
    logout: "लॉगआउट",
    paid: "भुगतान हो गया",
    dueToday: "आज देय (Due Today)",
    overdue: "अतिदेय (Overdue)",
    driver: "ड्राइवर",
  }
};

export default async function DriverHomePage(props: { searchParams?: Promise<{ lang?: string }> }) {
  const searchParams = await props.searchParams;
  const lang = searchParams?.lang === "hi" ? "hi" : "en";
  const t = translations[lang];

  const cookieStore = await cookies();
  const token = cookieStore.get("reyy_driver")?.value;

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-bold text-slate-900">{t.sessionExpired}</h1>
          <p className="text-slate-600">{t.loginAgain}</p>
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
      <div className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-bold text-slate-900">{t.sessionExpired}</h1>
          <p className="text-slate-600">{t.loginAgain}</p>
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
      <div className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">{t.noActiveRental}</h1>
          <p className="text-slate-600">
            {t.contactOps}
          </p>
          {data === null && (
            <p className="text-sm text-slate-500 mt-4">
              {t.callError}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Load Widgets
  let widgets = [];
  try {
    const widgetsPath = path.join(process.cwd(), "src", "app", "driver", "widgets.json");
    const widgetsData = await fs.readFile(widgetsPath, "utf-8");
    widgets = JSON.parse(widgetsData);
  } catch (err) {
    console.error("Failed to load driver widgets:", err);
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
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : r.coverage_status === "due_today"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : "bg-red-100 text-red-800 border-red-200";

  const statusText =
    r.coverage_status === "paid"
      ? t.paid
      : r.coverage_status === "due_today"
        ? t.dueToday
        : t.overdue;

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Premium Header */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 px-6 pt-10 pb-16 rounded-b-[40px] shadow-lg relative overflow-hidden">
        {/* Decorative circle */}
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div className="relative z-10 flex justify-between items-start">
          <div>
            <p className="text-emerald-100 font-medium tracking-wide text-sm mb-1">{t.welcome}</p>
            <h1 className="text-3xl font-bold text-white tracking-tight">{data.customer_name || t.driver}</h1>
            <div className="inline-flex items-center gap-1.5 mt-3 bg-black/20 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
              <span className="text-lg">🛵</span>
              <span className="text-emerald-50 text-sm font-medium">{r.scooty_label}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 -mt-10 space-y-5">
        {/* Rent Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -z-10 opacity-50"></div>
          
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-800">{t.rent}</h2>
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide border ${statusBadge}`}
            >
              {statusText}
            </span>
          </div>
          
          <div className="flex justify-between items-center bg-slate-50 rounded-xl p-4 mb-4 border border-slate-100">
            <div className="text-center">
              <p className="text-xs text-slate-500 font-medium mb-1 uppercase tracking-wider">{t.daysRemaining}</p>
              <p className={`text-4xl font-black tracking-tighter ${daysColor}`}>
                {r.days_remaining}
              </p>
            </div>
            <div className="w-px h-12 bg-slate-200"></div>
            <div className="text-center">
              <p className="text-xs text-slate-500 font-medium mb-1 uppercase tracking-wider">{t.paidThrough}</p>
              <p className="text-base font-bold text-slate-700">
                {r.paid_through ? formatDate(r.paid_through, lang) : "—"}
              </p>
            </div>
          </div>

          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-500 font-medium">{t.rate}</span>
            <span className="font-bold text-slate-800">
              {formatINR(r.rate, lang)} <span className="text-slate-400 font-medium">/ {r.rate_unit}</span>
            </span>
          </div>
        </div>

        {/* Deposit Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-lg font-bold text-slate-800 mb-4">{t.securityDeposit}</h2>
          
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">{t.target}</p>
              <p className="text-sm font-bold text-slate-800">
                {formatINR(r.security_deposit, lang)}
              </p>
            </div>
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 text-center">
              <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mb-1">{t.collected}</p>
              <p className="text-sm font-bold text-emerald-700">
                {formatINR(r.deposit_collected, lang)}
              </p>
            </div>
            <div className={`p-3 rounded-xl border text-center ${r.deposit_pending > 0 ? "bg-amber-50 border-amber-100" : "bg-slate-50 border-slate-100"}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${r.deposit_pending > 0 ? "text-amber-600" : "text-slate-500"}`}>{t.pending}</p>
              <p
                className={`text-sm font-bold ${r.deposit_pending > 0 ? "text-amber-700" : "text-slate-400"}`}
              >
                {formatINR(r.deposit_pending, lang)}
              </p>
            </div>
          </div>
        </div>

        {/* Payment Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-lg font-bold text-slate-800 mb-4">{t.payment}</h2>
          <div className="flex gap-3">
            <div className="flex-1 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <p className="text-xs text-slate-500 font-medium mb-1">{t.totalPaid}</p>
              <p className="text-lg font-bold text-emerald-600">
                {formatINR(r.total_paid, lang)}
              </p>
            </div>
            <div className={`flex-1 p-4 rounded-xl border ${r.outstanding > 0 ? "bg-red-50 border-red-100" : "bg-slate-50 border-slate-100"}`}>
              <p className="text-xs text-slate-500 font-medium mb-1">{t.outstanding}</p>
              <p
                className={`text-lg font-bold ${r.outstanding > 0 ? "text-red-600" : "text-slate-400"}`}
              >
                {formatINR(r.outstanding, lang)}
              </p>
            </div>
          </div>
        </div>

        {/* Widgets Section */}
        {widgets.length > 0 && (
          <div className="pt-4 space-y-4">
            {widgets.map((widget: any) => (
              <div 
                key={widget.id} 
                className="rounded-2xl p-5 shadow-sm border"
                style={{ 
                  backgroundColor: widget.backgroundColor || '#ffffff',
                  borderColor: widget.borderColor || '#e2e8f0',
                }}
              >
                <div className="flex items-start gap-4">
                  {widget.icon && (
                    <div className="text-4xl bg-white/50 w-14 h-14 rounded-full flex items-center justify-center shrink-0 shadow-sm border border-black/5">
                      {widget.icon}
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="text-lg font-bold mb-1" style={{ color: widget.textColor || '#0f172a' }}>
                      {lang === 'hi' && widget.title_hi ? widget.title_hi : widget.title_en}
                    </h3>
                    <p className="text-sm font-medium leading-relaxed opacity-90" style={{ color: widget.textColor || '#334155' }}>
                      {lang === 'hi' && widget.subtitle_hi ? widget.subtitle_hi : widget.subtitle_en}
                    </p>
                    
                    {((lang === 'hi' && widget.callToAction_hi) || widget.callToAction_en) && (
                      <a 
                        href={widget.actionUrl || "#"}
                        className="inline-block mt-4 px-5 py-2.5 rounded-lg text-sm font-bold shadow-sm transition active:scale-95"
                        style={{ 
                          backgroundColor: widget.textColor || '#0f172a',
                          color: widget.backgroundColor || '#ffffff'
                        }}
                      >
                        {lang === 'hi' && widget.callToAction_hi ? widget.callToAction_hi : widget.callToAction_en}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-8 pb-4">
          {data.support_phone && (
            <a
              href={`tel:${data.support_phone}`}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl font-bold shadow-sm border border-emerald-100"
            >
              {t.callSupport}
            </a>
          )}
          <button
            id="btn-logout"
            className="inline-flex items-center justify-center px-5 py-2.5 bg-white text-slate-600 rounded-xl font-bold shadow-sm border border-slate-200"
          >
            {t.logout}
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
    </div>
  );
}
