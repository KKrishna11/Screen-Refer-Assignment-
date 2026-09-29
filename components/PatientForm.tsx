"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { fmtDob, sexLabel } from "./ui";

export type PatientFormValues = { fullName: string; phone: string; dob: string; sex: string; village: string };
type Match = { id: string; fullName: string; dob: string; sex: string; similarity: number };

export function PatientForm({
  initial,
  patientId,
  onSaved,
}: {
  initial?: PatientFormValues;
  patientId?: string;
  onSaved: (id: string, info: { rescoredScreenings?: number }) => void;
}) {
  const [v, setV] = useState<PatientFormValues>(initial ?? { fullName: "", phone: "", dob: "", sex: "", village: "" });
  const [changeReason, setChangeReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [dupes, setDupes] = useState<{ matches: Match[]; otherWorkersCount: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const phoneCheck = v.phone ? normalizePhone(v.phone) : null;
  const dobChanged = !!initial && initial.dob !== v.dob;
  const set = (k: keyof PatientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setV({ ...v, [k]: e.target.value });
    setDupes(null);
  };

  async function save(confirmNotDuplicate = false) {
    setBusy(true);
    setError("");
    setErrors({});
    try {
      // on edit, send only changed fields
      const body: Record<string, unknown> = { confirmNotDuplicate };
      (Object.keys(v) as (keyof PatientFormValues)[]).forEach((k) => {
        if (!initial || initial[k] !== v[k]) body[k] = v[k];
      });
      if (patientId && changeReason) body.changeReason = changeReason;
      const r = await api<{ patient: { id: string }; rescoredScreenings?: number }>(
        patientId ? `/api/patients/${patientId}` : "/api/patients",
        { method: patientId ? "PATCH" : "POST", body },
      );
      onSaved(r.patient.id, { rescoredScreenings: r.rescoredScreenings });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.code === "POSSIBLE_DUPLICATE") {
        setDupes({ matches: (e.body.matches as Match[]) ?? [], otherWorkersCount: Number(e.body.otherWorkersCount ?? 0) });
      } else if (e instanceof ApiError && e.status === 422) {
        setErrors((e.body.fields as Record<string, string>) ?? {});
        setError("Please fix the highlighted fields");
      } else {
        setError(e instanceof ApiError ? e.message : "Could not save");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <label className="field">
        Full name <span className="hi" lang="hi">पूरा नाम — any language is fine</span>
        <input value={v.fullName} onChange={set("fullName")} required maxLength={160} />
        {errors.fullName && <div className="field-err">{errors.fullName}</div>}
      </label>
      <label className="field">
        Mobile number <span className="hi" lang="hi">मोबाइल नंबर</span>
        <input value={v.phone} onChange={set("phone")} inputMode="tel" placeholder="+91 98765 43210 / 098765 43210 / 9876543210" required />
        {phoneCheck && (phoneCheck.ok ? <span className="small muted">Will be saved as {formatPhone(phoneCheck.phone)}</span> : <span className="small" style={{ color: "var(--high)" }}>{phoneCheck.error}</span>)}
        {errors.phone && <div className="field-err">{errors.phone}</div>}
      </label>
      <label className="field">
        Date of birth <span className="hi" lang="hi">जन्म तिथि (if unsure, use 1 January of the likely year)</span>
        <input type="date" value={v.dob} onChange={set("dob")} max={new Date().toISOString().slice(0, 10)} required />
        {errors.dob && <div className="field-err">{errors.dob}</div>}
      </label>
      {dobChanged && (
        <div className="notice">
          Changing the date of birth will re-check this patient&apos;s past screenings. Questions that no longer apply are set aside (not
          deleted), new questions that now apply are flagged, and the doctor is asked to review again if the risk changes.
        </div>
      )}
      <label className="field">
        Sex <span className="hi" lang="hi">लिंग</span>
        <select value={v.sex} onChange={set("sex")} required>
          <option value="">Choose…</option>
          <option value="FEMALE">Female / महिला</option>
          <option value="MALE">Male / पुरुष</option>
          <option value="OTHER">Other / अन्य</option>
        </select>
      </label>
      <label className="field">
        Village / area <span className="hi" lang="hi">गांव / इलाका</span>
        <input value={v.village} onChange={set("village")} maxLength={160} />
      </label>
      {patientId && (
        <label className="field">
          Reason for change (optional)
          <input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="e.g. Aadhaar card shows a different birth year" />
        </label>
      )}

      {dupes && (
        <div className="notice">
          <strong>This phone number is already registered.</strong> Is this the same person?
          {dupes.matches.map((m) => (
            <div key={m.id} className="row spread" style={{ margin: "8px 0" }}>
              <span>
                {m.fullName} · {sexLabel(m.sex)} · born {fmtDob(m.dob)}{" "}
                {m.similarity >= 0.75 && <strong>(very similar name)</strong>}
              </span>
              <Link className="btn secondary" href={`/patients/${m.id}`}>Yes, open this record</Link>
            </div>
          ))}
          {dupes.otherWorkersCount > 0 && (
            <p className="small">
              {dupes.otherWorkersCount} record(s) with this number were registered by another health worker. If it is the same person, tell the
              doctor so the records can be linked.
            </p>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => save(true)}>
            No, this is a different person (e.g. family member) — save
          </button>
        </div>
      )}

      {error && <div className="notice error">{error}</div>}
      {!dupes && <button className="btn block" disabled={busy}>{busy ? "Saving…" : patientId ? "Save changes" : "Register patient"}</button>}
    </form>
  );
}
