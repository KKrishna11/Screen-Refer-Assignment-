"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useSession } from "@/components/SessionProvider";
import { Pager, RiskBadge, fmtDob, sexLabel } from "@/components/ui";
import { formatPhone } from "@/lib/phone";

type Row = {
  id: string;
  fullName: string;
  phone: string;
  dob: string;
  sex: string;
  village: string | null;
  createdByName: string;
  lastScreening: { finalRisk: "LOW" | "MEDIUM" | "HIGH"; screenedAt: string } | null;
};
type Page = { items: Row[]; page: number; totalPages: number; total: number };

export default function PatientsPage() {
  const { me } = useSession();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [deleted, setDeleted] = useState(false);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams({ q, page: String(page), pageSize: "20", ...(deleted ? { deleted: "1" } : {}) });
      api<Page>(`/api/patients?${sp}`)
        .then((d) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load patients"));
    }, 250);
    return () => clearTimeout(t);
  }, [q, page, deleted]);

  async function restore(id: string) {
    await api(`/api/patients/${id}/restore`, { method: "POST" });
    setData((d) => d && { ...d, items: d.items.filter((r) => r.id !== id) });
  }

  return (
    <>
      <div className="row spread">
        <h1>{deleted ? "Deleted patients" : me?.role === "DOCTOR" ? "All patients" : "My patients"}</h1>
        {!deleted && <Link href="/patients/new" className="btn">+ New patient</Link>}
      </div>
      <input
        placeholder="Search name (any language) or phone"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        aria-label="Search patients"
      />
      {me?.role === "DOCTOR" && (
        <label className="row small" style={{ marginTop: 8 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={deleted} onChange={(e) => { setDeleted(e.target.checked); setPage(1); }} />
          Show deleted records
        </label>
      )}
      {error && <div className="notice error">{error}</div>}
      {data && (
        <div className="card" style={{ padding: 0 }}>
          {data.items.length === 0 && <p className="muted" style={{ padding: 14 }}>No patients found.</p>}
          {data.items.map((p) => (
            <div key={p.id} style={{ borderBottom: "1px solid var(--line)" }}>
              {deleted ? (
                <div className="row spread" style={{ padding: 12 }}>
                  <span>{p.fullName} · {formatPhone(p.phone)}</span>
                  <button className="btn secondary" onClick={() => restore(p.id)}>Restore</button>
                </div>
              ) : (
                <Link href={`/patients/${p.id}`} className="list-item" style={{ padding: 12 }}>
                  <div className="row spread">
                    <strong>{p.fullName}</strong>
                    {p.lastScreening ? <RiskBadge level={p.lastScreening.finalRisk} /> : <span className="small muted">Not screened</span>}
                  </div>
                  <div className="small muted">
                    {sexLabel(p.sex)} · born {fmtDob(p.dob)} · {formatPhone(p.phone)}
                    {p.village ? ` · ${p.village}` : ""}
                    {me?.role === "DOCTOR" ? ` · by ${p.createdByName}` : ""}
                  </div>
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
      {data && <p className="small muted" style={{ textAlign: "center" }}>{data.total} record{data.total === 1 ? "" : "s"}</p>}
      {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </>
  );
}
