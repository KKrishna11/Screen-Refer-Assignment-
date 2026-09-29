"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { loadDraft } from "@/lib/client/drafts";
import { useSession } from "@/components/SessionProvider";
import { PatientForm } from "@/components/PatientForm";
import { RiskBadge, fmtDateTime, fmtDob, sexLabel } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { ageOn, parseDateOnly } from "@/lib/age";

type Patient = { id: string; fullName: string; phone: string; dob: string; sex: string; village: string | null };
type ScreeningRow = {
  id: string;
  screenedAt: string;
  computedRisk: "LOW" | "MEDIUM" | "HIGH";
  finalRisk: "LOW" | "MEDIUM" | "HIGH";
  reviewStatus: string;
  ageYears: number;
  recomputedNote: string | null;
  worker: { name: string };
};
type Dup = { id: string; fullName: string; dob: string; sex: string; similarity: number };

export default function PatientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useSession();
  const [data, setData] = useState<{ patient: Patient; screenings: ScreeningRow[]; duplicates: Dup[] } | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    api<{ patient: Patient; screenings: ScreeningRow[]; duplicates: Dup[] }>(`/api/patients/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? (e.status === 404 ? "Patient not found" : e.message) : "Could not load"));
  }, [id]);
  useEffect(load, [load]);

  async function remove() {
    if (!confirm("Delete this patient record? A doctor can restore it later.")) return;
    try {
      await api(`/api/patients/${id}`, { method: "DELETE" });
      router.replace("/patients");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete");
    }
  }

  if (error) return <div className="notice error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const p = data.patient;
  const draft = me ? loadDraft(me.id, p.id) : null;
  const dob = parseDateOnly(p.dob);
  const age = dob ? ageOn(dob, new Date()).years : null;

  return (
    <>
      <Link href="/patients" className="small">‹ Patients</Link>
      <h1>{p.fullName}</h1>
      {notice && <div className="notice ok">{notice}</div>}

      {editing ? (
        <PatientForm
          patientId={p.id}
          initial={{ fullName: p.fullName, phone: p.phone, dob: p.dob, sex: p.sex, village: p.village ?? "" }}
          onSaved={(_id, info) => {
            setEditing(false);
            setNotice(
              info.rescoredScreenings
                ? `Saved. ${info.rescoredScreenings} past screening(s) were re-checked with the corrected details — see the notes on each.`
                : "Saved.",
            );
            load();
          }}
        />
      ) : (
        <div className="card">
          <div>{sexLabel(p.sex)} · {age !== null ? `${age} years` : ""} (born {fmtDob(p.dob)})</div>
          <div>{formatPhone(p.phone)}</div>
          {p.village && <div className="muted">{p.village}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn secondary" onClick={() => setEditing(true)}>Edit details</button>
            <button className="btn danger" onClick={remove}>Delete</button>
          </div>
        </div>
      )}

      {me?.role === "WORKER" && (
        <Link href={`/patients/${p.id}/screen`} className="btn block">
          {draft ? (draft.queued ? "Screening waiting to send — open" : "Continue unfinished screening") : "Start new screening"}
        </Link>
      )}

      {me?.role === "DOCTOR" && data.duplicates.length > 0 && (
        <div className="notice">
          <strong>Other records with the same phone number</strong>
          {data.duplicates.map((d) => (
            <div key={d.id}>
              <Link href={`/patients/${d.id}`}>{d.fullName}</Link> · {sexLabel(d.sex)} · born {fmtDob(d.dob)} · name match {Math.round(d.similarity * 100)}%
            </div>
          ))}
        </div>
      )}

      <h2>Screenings</h2>
      {data.screenings.length === 0 && <p className="muted">No screenings yet.</p>}
      {data.screenings.map((s) => (
        <Link key={s.id} href={`/screenings/${s.id}`} className="card list-item">
          <div className="row spread">
            <span>{fmtDateTime(s.screenedAt)}</span>
            <RiskBadge level={s.finalRisk} />
          </div>
          <div className="small muted">
            Age {s.ageYears} · by {s.worker.name} · {s.reviewStatus === "PENDING" ? "Waiting for doctor" : s.reviewStatus === "ACCEPTED" ? "Doctor agreed" : "Doctor changed the level"}
          </div>
          {s.recomputedNote && <div className="small" style={{ color: "var(--med)" }}>⚠ {s.recomputedNote}</div>}
        </Link>
      ))}
    </>
  );
}
