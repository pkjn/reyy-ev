"use client";

import { useEffect, useState } from "react";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  STATUS_BADGE,
  LeadStatus,
  Followup,
  parseFollowups,
  stripFollowup,
  todayISO,
} from "@/lib/leads";

interface Lead {
  id: string;
  name: string;
  phones: string[];
  notes: string | null;
  status: LeadStatus;
  created_at: string;
}

const formatDate = (d: string): string => {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  // add-lead form
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [phones, setPhones] = useState<string[]>([""]);
  const [status, setStatus] = useState<LeadStatus>("new");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchLeads = async () => {
    const res = await fetch("/api/leads");
    setLeads(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const resetForm = () => {
    setName("");
    setPhones([""]);
    setStatus("new");
    setNotes("");
  };

  const updatePhone = (idx: number, val: string) =>
    setPhones((prev) => prev.map((p, i) => (i === idx ? val : p)));
  const addPhone = () => setPhones((prev) => [...prev, ""]);
  const removePhone = (idx: number) =>
    setPhones((prev) =>
      prev.length === 1 ? [""] : prev.filter((_, i) => i !== idx)
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phones: phones.map((p) => p.trim()).filter(Boolean),
          status,
          notes,
        }),
      });
      const created = (await res.json()) as Lead;
      setLeads((prev) => [created, ...prev]);
      resetForm();
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  // Persist editable lead fields, updating local state first.
  const patchLead = async (leadId: string, patch: Partial<Lead>) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, ...patch } : l))
    );
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };

  const deleteLead = async (leadId: string) => {
    if (!confirm("Delete this lead?")) return;
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
  };

  // Mark a follow-up done by stripping its @-date from the lead's notes.
  const completeFollowup = (lead: Lead, f: Followup) => {
    patchLead(lead.id, { notes: stripFollowup(lead.notes || "", f) });
  };

  // Pull every follow-up out of every lead's notes, soonest first.
  const today = todayISO();
  const dueTasks = leads
    .flatMap((l) => parseFollowups(l.notes).map((f) => ({ lead: l, f })))
    .sort((a, b) => (a.f.date < b.f.date ? -1 : 1));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Leads</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          {showForm ? "Cancel" : "+ Add Lead"}
        </button>
      </div>

      {/* Follow-ups due */}
      {dueTasks.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
          <h2 className="font-semibold mb-3">Follow-ups due</h2>
          <ul className="space-y-2">
            {dueTasks.map(({ lead, f }) => {
              const overdue = f.date <= today;
              return (
                <li
                  key={`${lead.id}-${f.lineIndex}`}
                  className="flex items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => completeFollowup(lead, f)}
                    title="Mark done"
                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span
                    className={`inline-flex items-center gap-1 font-medium tabular-nums ${
                      overdue ? "text-rose-600" : "text-gray-500"
                    }`}
                  >
                    {overdue && <span aria-hidden>⚠</span>}
                    {formatDate(f.date)}
                  </span>
                  <span className="text-gray-900">{f.text}</span>
                  <span className="text-gray-400">— {lead.name}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Add lead form */}
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
              placeholder="Prospect name"
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
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder={'e.g. "call back @tomorrow" or "send quote @22-08-2026"'}
            />
            <p className="text-xs text-gray-500 mt-1">
              Tip: write <code>@tomorrow</code>, <code>@today</code> or a date
              like <code>@22-08-2026</code> in a note and it becomes a follow-up
              reminder.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save lead"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : leads.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No leads yet</p>
          <p className="text-sm mt-1">Add your first prospect to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              today={today}
              onPatch={patchLead}
              onDelete={deleteLead}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LeadCard({
  lead,
  today,
  onPatch,
  onDelete,
}: {
  lead: Lead;
  today: string;
  onPatch: (leadId: string, patch: Partial<Lead>) => void;
  onDelete: (leadId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(lead.name);
  const [editPhones, setEditPhones] = useState<string[]>(
    lead.phones.length ? lead.phones : [""]
  );
  const [editNotes, setEditNotes] = useState(lead.notes || "");

  const followups = parseFollowups(lead.notes);

  const saveEdit = () => {
    onPatch(lead.id, {
      name: editName.trim() || lead.name,
      phones: editPhones.map((p) => p.trim()).filter(Boolean),
      notes: editNotes.trim() || null,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="Name"
        />
        <div className="space-y-2">
          {editPhones.map((p, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                type="tel"
                value={p}
                onChange={(e) =>
                  setEditPhones((prev) =>
                    prev.map((x, i) => (i === idx ? e.target.value : x))
                  )
                }
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder={`Phone ${idx + 1}`}
              />
              <button
                type="button"
                onClick={() =>
                  setEditPhones((prev) =>
                    prev.length === 1 ? [""] : prev.filter((_, i) => i !== idx)
                  )
                }
                className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                aria-label="Remove phone"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setEditPhones((prev) => [...prev, ""])}
            className="text-sm text-emerald-600 hover:text-emerald-800 font-medium"
          >
            + Add another number
          </button>
        </div>
        <textarea
          value={editNotes}
          onChange={(e) => setEditNotes(e.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder={'Notes — use @tomorrow / @22-08-2026 for reminders'}
        />
        <div className="flex gap-2">
          <button
            onClick={saveEdit}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
          >
            Save
          </button>
          <button
            onClick={() => {
              setEditName(lead.name);
              setEditPhones(lead.phones.length ? lead.phones : [""]);
              setEditNotes(lead.notes || "");
              setEditing(false);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-lg">{lead.name}</h2>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[lead.status]}`}
            >
              {LEAD_STATUS_LABELS[lead.status]}
            </span>
          </div>
          {lead.phones.length > 0 && (
            <div className="text-sm text-gray-500 mt-1">
              {lead.phones.join(", ")}
            </div>
          )}
          {lead.notes && (
            <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">
              {lead.notes}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={lead.status}
            onChange={(e) =>
              onPatch(lead.id, { status: e.target.value as LeadStatus })
            }
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            aria-label="Status"
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(lead.id)}
            className="text-sm text-red-600 hover:text-red-800"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Parsed follow-up reminders for this lead */}
      {followups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          {followups.map((f) => {
            const overdue = f.date <= today;
            return (
              <span
                key={f.lineIndex}
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                  overdue
                    ? "bg-rose-50 text-rose-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {overdue && <span aria-hidden>⚠</span>}
                {formatDate(f.date)} · {f.text}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
