"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Pager, fmtDateTime } from "@/components/ui";

type Item = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  reason: string | null;
  oldValue: unknown;
  newValue: unknown;
  actor: { name: string; role: string };
};

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Item[]; page: number; totalPages: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ items: Item[]; page: number; totalPages: number }>(`/api/audit?page=${page}&pageSize=30`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? (e.status === 403 ? "Only doctors can see the change log." : e.message) : "Could not load"));
  }, [page]);

  if (error) return <div className="notice error">{error}</div>;
  return (
    <>
      <h1>Change log</h1>
      <p className="muted small">Every change: who made it, what changed, when, and the value before the change.</p>
      {data?.items.map((i) => (
        <details key={i.id} className="card">
          <summary>
            <strong>{i.action.replace(/_/g, " ").toLowerCase()}</strong> · {i.actor.name} · {fmtDateTime(i.createdAt)} ·{" "}
            <Link href={i.entityType === "Patient" ? `/patients/${i.entityId}` : `/screenings/${i.entityId}`}>open {i.entityType.toLowerCase()}</Link>
          </summary>
          {i.reason && <p className="small">Reason: {i.reason}</p>}
          {i.oldValue != null && (<><div className="small muted">Before</div><pre className="json">{JSON.stringify(i.oldValue, null, 1)}</pre></>)}
          {i.newValue != null && (<><div className="small muted">After</div><pre className="json">{JSON.stringify(i.newValue, null, 1)}</pre></>)}
        </details>
      ))}
      {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </>
  );
}
