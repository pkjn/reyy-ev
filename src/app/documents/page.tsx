"use client";

import { useEffect, useMemo, useState } from "react";
import { formatINR } from "@/lib/billing";
import {
  DOCUMENT_CATEGORIES,
  DocumentRecord,
  formatPeriod,
  gstStatus,
  summariseGst,
} from "@/lib/documents";

interface FormState {
  title: string;
  category: string;
  vendor: string;
  doc_date: string;
  ref_number: string;
  amount: string;
  gst_amount: string;
  gst_claimed: boolean;
  gst_claim_period: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function emptyForm(): FormState {
  return {
    title: "",
    category: "Bill / Invoice",
    vendor: "",
    doc_date: today(),
    ref_number: "",
    amount: "",
    gst_amount: "",
    gst_claimed: false,
    gst_claim_period: "",
    notes: "",
  };
}

function formFor(doc: DocumentRecord): FormState {
  return {
    title: doc.title,
    category: doc.category,
    vendor: doc.vendor,
    doc_date: doc.doc_date,
    ref_number: doc.ref_number,
    amount: doc.amount === null ? "" : String(doc.amount),
    gst_amount: doc.gst_amount === null ? "" : String(doc.gst_amount),
    gst_claimed: doc.gst_claimed,
    gst_claim_period: doc.gst_claim_period || "",
    notes: doc.notes,
  };
}

function formatDate(d: string): string {
  if (!d) return "";
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");

  // The document whose claim period is being entered inline on its card.
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimPeriod, setClaimPeriod] = useState("");

  const load = async () => {
    const res = await fetch("/api/documents");
    setDocuments(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const upload = async (
    uploads: { id: string; upload_url: string }[],
    files: File[]
  ) => {
    await Promise.all(
      uploads.map((u, i) =>
        fetch(u.upload_url, {
          method: "PUT",
          headers: { "Content-Type": files[i].type },
          body: files[i],
        })
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (form.gst_claimed && !form.gst_claim_period) {
      setError("Pick the return period this GST was claimed in.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        gst_claim_period: form.gst_claimed ? form.gst_claim_period : null,
      };

      if (editingId) {
        const res = await fetch(`/api/documents/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || "Failed to save");
          return;
        }
        if (pendingFiles.length) {
          const filesRes = await fetch(`/api/documents/${editingId}/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: pendingFiles.map((f) => ({ name: f.name, type: f.type })),
            }),
          });
          if (!filesRes.ok) {
            const body = await filesRes.json().catch(() => ({}));
            setError(body.error || "Saved, but the files failed to upload");
            return;
          }
          const { uploads } = await filesRes.json();
          await upload(uploads, pendingFiles);
        }
      } else {
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            files: pendingFiles.map((f) => ({ name: f.name, type: f.type })),
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || "Failed to save");
          return;
        }
        const { uploads } = (await res.json()) as {
          uploads: { id: string; upload_url: string }[];
        };
        await upload(uploads, pendingFiles);
      }

      closeForm();
      load();
    } finally {
      setSaving(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
    setPendingFiles([]);
    setError(null);
  };

  const startEdit = (doc: DocumentRecord) => {
    setEditingId(doc.id);
    setForm(formFor(doc));
    setPendingFiles([]);
    setError(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert(b.error || "Failed to update");
      return false;
    }
    load();
    return true;
  };

  const handleDelete = async (doc: DocumentRecord) => {
    if (!confirm(`Delete "${doc.title}" and its ${doc.files.length} file(s)?`))
      return;
    const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to delete");
      return;
    }
    load();
  };

  const handleDeleteFile = async (doc: DocumentRecord, fileId: string) => {
    if (!confirm("Remove this file?")) return;
    await fetch(`/api/documents/${doc.id}/files/${fileId}`, { method: "DELETE" });
    load();
  };

  // The document open in the edit form, re-read from `documents` so its file
  // list refreshes as files are added or removed.
  const editingDoc = editingId
    ? documents.find((d) => d.id === editingId) || null
    : null;

  const categories = useMemo(() => {
    const seen = new Set(documents.map((d) => d.category).filter(Boolean));
    return Array.from(seen).sort();
  }, [documents]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return documents.filter((d) => {
      if (category !== "all" && d.category !== category) return false;
      if (!needle) return true;
      return [d.title, d.vendor, d.ref_number, d.notes, d.category]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [documents, q, category]);

  // GST totals always describe the whole vault, not the current filter —
  // otherwise "yet to claim" would silently shrink as you narrow the list.
  const gst = useMemo(() => summariseGst(documents), [documents]);

  // Claimed GST grouped by the return period it went into.
  const byPeriod = useMemo(() => {
    const totals = new Map<string, { amount: number; count: number }>();
    for (const d of documents) {
      if (!d.gst_claimed || !d.gst_amount || !d.gst_claim_period) continue;
      const row = totals.get(d.gst_claim_period) || { amount: 0, count: 0 };
      row.amount += d.gst_amount;
      row.count += 1;
      totals.set(d.gst_claim_period, row);
    }
    return Array.from(totals.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [documents]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Documents</h1>
        <button
          onClick={() => (showForm ? closeForm() : setShowForm(true))}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          {showForm ? "Cancel" : "+ Add Document"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg border border-gray-200 p-6 mb-6 space-y-4"
        >
          <h2 className="font-semibold">
            {editingId ? "Edit document" : "New document"}
          </h2>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title *
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g. Ather invoice — 5 scooters"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <input
                type="text"
                list="doc-categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Bill / Invoice"
              />
              <datalist id="doc-categories">
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Party / vendor
              </label>
              <input
                type="text"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Who issued it"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date on document
              </label>
              <input
                type="date"
                value={form.doc_date}
                onChange={(e) => setForm({ ...form, doc_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reference no.
              </label>
              <input
                type="text"
                value={form.ref_number}
                onChange={(e) =>
                  setForm({ ...form, ref_number: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Invoice / cheque / certificate no."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total amount (₹)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Incl. GST"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                GST in it (₹)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.gst_amount}
                onChange={(e) =>
                  setForm({ ...form, gst_amount: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Leave blank if none"
              />
            </div>
          </div>

          {Number(form.gst_amount) > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-3">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.gst_claimed}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      gst_claimed: e.target.checked,
                      gst_claim_period:
                        form.gst_claim_period ||
                        (form.doc_date || today()).slice(0, 7),
                    })
                  }
                  className="mt-0.5"
                />
                <span>
                  GST on this bill has been claimed
                  <span className="block text-xs text-gray-500">
                    Tick once the input credit is in a filed return.
                  </span>
                </span>
              </label>
              {form.gst_claimed && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Claimed in return period
                  </label>
                  <input
                    type="month"
                    value={form.gst_claim_period}
                    onChange={(e) =>
                      setForm({ ...form, gst_claim_period: e.target.value })
                    }
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Removing a file lives here rather than on the card, so the list
              stays a clean row of "View" links with nothing destructive on it. */}
          {editingDoc && editingDoc.files.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Files on this document
              </label>
              <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {editingDoc.files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-sm text-gray-700 truncate">
                      {f.name}
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <a
                        href={f.url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-emerald-700 hover:text-emerald-900 underline"
                      >
                        View
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(editingDoc, f.id)}
                        className="text-sm font-medium text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editingId ? "Add more files" : "Files"}
            </label>
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={(e) =>
                setPendingFiles(Array.from(e.target.files || []))
              }
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
            />
            {pendingFiles.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {pendingFiles.length} file(s) will be uploaded on save.
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Save Document"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!loading && documents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              GST on record
            </p>
            <p className="text-2xl font-bold mt-1">{formatINR(gst.total)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              Claimed
            </p>
            <p className="text-2xl font-bold mt-1 text-emerald-700">
              {formatINR(gst.claimed)}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              Yet to claim
            </p>
            <p className="text-2xl font-bold mt-1 text-amber-700">
              {formatINR(gst.pending)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {gst.pending_count} bill{gst.pending_count === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      )}

      {!loading && documents.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, party, reference…"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No documents yet</p>
          <p className="text-sm mt-1">
            Upload bills, GST certificates, cheques, photos — anything worth
            keeping. Bills with GST get a claim tracker.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-gray-500 text-center py-12">
          No documents match these filters.
        </p>
      ) : (
        <div className="grid gap-4">
          {visible.map((doc) => {
            const state = gstStatus(doc);
            return (
              <div
                key={doc.id}
                className="bg-white rounded-lg border border-gray-200 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-lg flex flex-wrap items-center gap-2">
                      {doc.title}
                      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">
                        {doc.category}
                      </span>
                      {state === "claimed" && (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">
                          GST claimed · {formatPeriod(doc.gst_claim_period)}
                        </span>
                      )}
                      {state === "pending" && (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                          GST not claimed
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      {[
                        doc.vendor,
                        formatDate(doc.doc_date),
                        doc.ref_number,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {doc.notes && (
                      <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">
                        {doc.notes}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {doc.amount !== null && (
                      <p className="font-semibold">{formatINR(doc.amount)}</p>
                    )}
                    {doc.gst_amount !== null && (
                      <p className="text-xs text-gray-500">
                        GST {formatINR(doc.gst_amount)}
                      </p>
                    )}
                  </div>
                </div>

                {/* No thumbnails: a scan is opened on demand, so the card
                    stays a compact line of "View" links. The filename only
                    shows when there's more than one, to tell them apart. */}
                {doc.files.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
                    {doc.files.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-1.5">
                        <a
                          href={f.url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-emerald-700 hover:text-emerald-900 underline"
                          title={f.name}
                        >
                          View
                        </a>
                        {doc.files.length > 1 && (
                          <span className="text-xs text-gray-400 truncate max-w-[12rem]">
                            {f.name}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-gray-100">
                  {state === "pending" &&
                    (claiming === doc.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-sm text-gray-600">
                          Claimed in
                        </label>
                        <input
                          type="month"
                          value={claimPeriod}
                          onChange={(e) => setClaimPeriod(e.target.value)}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <button
                          onClick={async () => {
                            if (!claimPeriod) return;
                            const ok = await patch(doc.id, {
                              gst_claimed: true,
                              gst_claim_period: claimPeriod,
                            });
                            if (ok) setClaiming(null);
                          }}
                          className="bg-emerald-600 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-emerald-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setClaiming(null)}
                          className="text-sm text-gray-600 hover:text-gray-900"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setClaiming(doc.id);
                          setClaimPeriod(
                            doc.gst_claim_period ||
                              (doc.doc_date || today()).slice(0, 7)
                          );
                        }}
                        className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
                      >
                        Mark GST claimed
                      </button>
                    ))}
                  {state === "claimed" && (
                    <button
                      onClick={() => patch(doc.id, { gst_claimed: false })}
                      className="text-sm font-medium text-amber-700 hover:text-amber-900"
                    >
                      Undo claim
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(doc)}
                    className="text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    className="text-sm font-medium text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {byPeriod.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            GST claimed by return period
          </h2>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {byPeriod.map(([period, row]) => (
              <div
                key={period}
                className="flex items-center justify-between px-5 py-3"
              >
                <span className="text-sm font-medium">
                  {formatPeriod(period)}
                </span>
                <span className="text-sm text-gray-600">
                  {formatINR(row.amount)}
                  <span className="text-gray-400">
                    {" "}
                    · {row.count} bill{row.count === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
