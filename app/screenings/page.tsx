"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useSession } from "@/components/SessionProvider";
import { Disclaimer, Pager, RiskBadge, fmtDateTime, sexLabel } from "@/components/ui";

type Row = {
  id: string;
  screenedAt: string;
  ageYears: number;
  computedRisk: "LOW" | "MEDIUM" | "HIGH";
  finalRisk: "LOW" | "MEDIUM" | "HIGH";
  reviewStatus: "PENDING" | "ACCEPTED" | "OVERRIDDEN";
  recomputedNote: string | null;
  patient: { id: string; fullName: string; sex: string };
  worker: { name: string };
};
type Page = { items: Row[]; page: number; totalPages: number; total: number };

const STATUS_TEXT = { PENDING: "Waiting for review", ACCEPTED: "Accepted", OVERRIDDEN: "Changed by doctor" };

export default function ScreeningsPage() {
  const { me } = useSession();
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const defaulted = useRef(false);

  // doctors land on "waiting for review" by default (once the logged-in role is known)
  useEffect(() => {
    if (me && !defaulted.current) {
      defaulted.current = true;
      if (me.role === "DOCTOR") setStatus("PENDING");
    }
  }, [me]);
  useEffect(() => {
    const sp = new URLSearchParams({ page: String(page), ...(status ? { status } : {}), ...(risk ? { risk } : {}) });
    api<Page>(`/api/screenings?${sp}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load"));
  }, [status, risk, page]);

  return (
    <>
      <h1>{me?.role === "DOCTOR" ? "Review queue" : "My screenings"}</h1>
      <Disclaimer />
      <div className="row">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ flex: 1 }} aria-label="Review status">
          <option value="">All statuses</option>
          <option value="PENDING">Waiting for review</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="OVERRIDDEN">Changed by doctor</option>
        </select>
        <select value={risk} onChange={(e) => { setRisk(e.target.value); setPage(1); }} style={{ flex: 1 }} aria-label="Risk level">
          <option value="">All risk levels</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </div>
      {error && <div className="notice error">{error}</div>}
      {data?.items.length === 0 && <p className="muted">Nothing here.</p>}
      {data?.items.map((s) => (
        <Link key={s.id} href={`/screenings/${s.id}`} className="card list-item">
          <div className="row spread">
            <strong>{s.patient.fullName}</strong>
            <RiskBadge level={s.finalRisk} />
          </div>
          <div className="small muted">
            {sexLabel(s.patient.sex)}, {s.ageYears} yrs · {fmtDateTime(s.screenedAt)} · by {s.worker.name} · {STATUS_TEXT[s.reviewStatus]}
            {s.finalRisk !== s.computedRisk && ` (app said ${s.computedRisk.toLowerCase()})`}
          </div>
          {s.recomputedNote && <div className="small" style={{ color: "var(--med)" }}>⚠ Details were corrected after screening</div>}
        </Link>
      ))}
      {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </>
  );
}
