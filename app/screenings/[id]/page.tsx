"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useSession } from "@/components/SessionProvider";
import { Disclaimer, RiskBadge, fmtDateTime, fmtDob, sexLabel } from "@/components/ui";
import { findQuestion, labelFor, type Answer } from "@/lib/form-engine";
import { formatPhone } from "@/lib/phone";

type Level = "LOW" | "MEDIUM" | "HIGH";
type Screening = {
  id: string;
  screenedAt: string;
  ageYears: number;
  answers: Record<string, Answer>;
  hiddenAnswers: Record<string, Answer>;
  missingQuestions: string[];
  score: number;
  computedRisk: Level;
  finalRisk: Level;
  reasons: { id: string; reason: string; points: number; redFlag: boolean }[];
  reviewStatus: "PENDING" | "ACCEPTED" | "OVERRIDDEN";
  reviewReason: string | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  recomputedNote: string | null;
  aiStatus: "NONE" | "OK" | "FAILED";
  aiSummaryEn: string | null;
  aiSummaryHi: string | null;
  aiError: string | null;
  formVersion: string;
  rulesVersion: string;
  worker: { name: string };
  patient: { id: string; fullName: string; dob: string; sex: string; phone: string; village: string | null };
};
type HistoryItem = {
  id: string;
  action: string;
  createdAt: string;
  reason: string | null;
  oldValue: unknown;
  newValue: unknown;
  actor: { name: string; role: string };
};

const ACTION_TEXT: Record<string, string> = {
  SCREENING_CREATED: "Screening submitted",
  SCREENING_RECOMPUTED: "Re-checked after patient details were corrected",
  REVIEW_ACCEPT: "Doctor accepted the risk level",
  REVIEW_OVERRIDE: "Doctor changed the risk level",
  PATIENT_CREATED: "Patient registered",
  PATIENT_UPDATED: "Patient details changed",
  PATIENT_DELETED: "Patient deleted",
  PATIENT_RESTORED: "Patient restored",
};

export default function ScreeningPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const [s, setS] = useState<Screening | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<{ screening: Screening; history: HistoryItem[] }>(`/api/screenings/${id}`)
      .then((r) => {
        setS(r.screening);
        setHistory(r.history);
      })
      .catch((e) => setError(e instanceof ApiError ? (e.status === 404 ? "Screening not found" : e.message) : "Could not load"));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <div className="notice error">{error}</div>;
  if (!s) return <p className="muted">Loading…</p>;
  const isDoctor = me?.role === "DOCTOR";
  const hiddenIds = Object.keys(s.hiddenAnswers ?? {});

  return (
    <>
      <Link href={`/patients/${s.patient.id}`} className="small">‹ {s.patient.fullName}</Link>
      <h1>Screening result</h1>
      <Disclaimer />

      <div className="card">
        <div className="row spread">
          <div>
            <strong>{s.patient.fullName}</strong>
            <div className="small muted">
              {sexLabel(s.patient.sex)}, {s.ageYears} yrs at screening (born {fmtDob(s.patient.dob)}) · {formatPhone(s.patient.phone)}
              {s.patient.village ? ` · ${s.patient.village}` : ""}
            </div>
            <div className="small muted">Screened {fmtDateTime(s.screenedAt)} by {s.worker.name}</div>
          </div>
          <RiskBadge level={s.finalRisk} big />
        </div>

        {s.reviewStatus === "OVERRIDDEN" && (
          <p className="small">
            The app calculated <RiskBadge level={s.computedRisk} />. {s.reviewedBy?.name} changed it to <RiskBadge level={s.finalRisk} />
            {s.reviewReason ? <> — “{s.reviewReason}”</> : null}
          </p>
        )}
        {s.reviewStatus === "ACCEPTED" && (
          <p className="small muted">Accepted by {s.reviewedBy?.name}{s.reviewReason ? ` — “${s.reviewReason}”` : ""}</p>
        )}
        {s.reviewStatus === "PENDING" && <p className="small muted">Waiting for doctor review.</p>}

        <h3>Why this level</h3>
        {s.reasons.length === 0 ? (
          <p className="muted small">No risk signs found in the answers.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {s.reasons.map((r) => (
              <li key={r.id}>
                {r.redFlag ? <strong style={{ color: "var(--high)" }}>Red flag: </strong> : null}
                {r.reason}
                {!r.redFlag && <span className="small muted"> (+{r.points})</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Score {s.score}. Any red flag = High; otherwise 6+ points = High, 3–5 = Medium, 0–2 = Low. Rules {s.rulesVersion}.
        </p>
      </div>

      {s.recomputedNote && (
        <div className="notice">
          <strong>Patient details were corrected after this screening.</strong> {s.recomputedNote}
        </div>
      )}

      {isDoctor && <AiSummary s={s} />}
      {isDoctor && <ReviewPanel s={s} onDone={load} />}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Answers</h2>
        <table>
          <tbody>
            {Object.entries(s.answers).map(([qid, v]) => {
              const q = findQuestion(qid);
              return (
                <tr key={qid}>
                  <td>
                    {q?.label.en ?? qid}
                    {q && <span className="hi" lang="hi">{q.label.hi}</span>}
                  </td>
                  <td><strong>{q ? labelFor(q, v) : String(v)}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {s.missingQuestions.length > 0 && (
          <>
            <h3>Not asked (now apply after the correction)</h3>
            <ul>{s.missingQuestions.map((qid) => <li key={qid}>{findQuestion(qid)?.label.en ?? qid}</li>)}</ul>
          </>
        )}
        {hiddenIds.length > 0 && (
          <>
            <h3>Answered, then set aside</h3>
            <p className="small muted">
              These were answered but their question stopped applying (an earlier answer or the patient&apos;s details changed). They are kept for
              the record and were <strong>not</strong> used for the risk level.
            </p>
            <table>
              <tbody>
                {hiddenIds.map((qid) => {
                  const q = findQuestion(qid);
                  return (
                    <tr key={qid} className="muted">
                      <td>{q?.label.en ?? qid}</td>
                      <td className="hidden-answer">{q ? labelFor(q, s.hiddenAnswers[qid]) : String(s.hiddenAnswers[qid])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {isDoctor && history.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>History</h2>
          {history.map((h) => (
            <details key={h.id} style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              <summary>
                <strong>{ACTION_TEXT[h.action] ?? h.action}</strong> · {h.actor.name} · {fmtDateTime(h.createdAt)}
              </summary>
              {h.reason && <p className="small">Reason: {h.reason}</p>}
              {h.oldValue != null && (<><div className="small muted">Before</div><pre className="json">{JSON.stringify(h.oldValue, null, 1)}</pre></>)}
              {h.newValue != null && (<><div className="small muted">After</div><pre className="json">{JSON.stringify(h.newValue, null, 1)}</pre></>)}
            </details>
          ))}
        </div>
      )}
      <Disclaimer />
    </>
  );
}

function AiSummary({ s }: { s: Screening }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "OK" | "FAILED"; en?: string; hi?: string; msg?: string }>(() =>
    s.aiStatus === "OK" && s.aiSummaryEn ? { status: "OK", en: s.aiSummaryEn, hi: s.aiSummaryHi ?? "" } : { status: "idle" },
  );

  const run = useCallback(
    async (force = false) => {
      setState((p) => ({ ...p, status: "loading" }));
      try {
        const r = await api<{ status: "OK" | "FAILED"; english?: string; hindi?: string; message?: string }>(
          `/api/screenings/${s.id}/summary${force ? "?force=1" : ""}`,
          { method: "POST", timeoutMs: 30000 },
        );
        setState(r.status === "OK" ? { status: "OK", en: r.english, hi: r.hindi } : { status: "FAILED", msg: r.message });
      } catch (e) {
        setState({ status: "FAILED", msg: (e instanceof ApiError ? e.message : "Could not reach the server") + ". The screening and its risk result are not affected." });
      }
    },
    [s.id],
  );

  // generate automatically the first time a doctor opens the screening
  useEffect(() => {
    if (s.aiStatus !== "OK") run(false);
  }, [s.aiStatus, run]);

  return (
    <div className="card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>AI summary</h2>
        {state.status !== "loading" && (
          <button className="btn secondary" onClick={() => run(true)}>{state.status === "OK" ? "Regenerate" : "Try again"}</button>
        )}
      </div>
      {state.status === "loading" && <p className="muted">Writing summary…</p>}
      {state.status === "OK" && (
        <>
          <p>{state.en}</p>
          <p lang="hi">{state.hi}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Written by AI from the answers above; it can make mistakes. The risk level shown above is from the app&apos;s fixed rules, not the AI.
          </p>
        </>
      )}
      {state.status === "FAILED" && (
        <div className="notice" style={{ marginBottom: 0 }}>
          <strong>AI summary unavailable.</strong> {state.msg} Everything else on this page works normally.
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ s, onDone }: { s: Screening; onDone: () => void }) {
  const [mode, setMode] = useState<"accept" | "override">("accept");
  const [level, setLevel] = useState<Level | "">("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const options = (["LOW", "MEDIUM", "HIGH"] as Level[]).filter((l) => l !== s.computedRisk);
  const reasonOk = reason.trim().length >= 10;

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/screenings/${s.id}/review`, {
        method: "POST",
        body: mode === "accept" ? { action: "accept", note: reason || undefined } : { action: "override", riskLevel: level, reason },
      });
      setMsg({ ok: true, text: "Saved. The change is recorded in the history below." });
      setReason("");
      onDone();
    } catch (e) {
      const fields = e instanceof ApiError ? (e.body.fields as Record<string, string> | undefined) : undefined;
      setMsg({ ok: false, text: fields?.reason ?? (e instanceof ApiError ? e.message : "Could not save") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{s.reviewStatus === "PENDING" ? "Your review" : "Change your review"}</h2>
      <div className="choices">
        <button type="button" className="choice" aria-pressed={mode === "accept"} onClick={() => setMode("accept")}>
          Accept {s.computedRisk.toLowerCase()} risk
        </button>
        <button type="button" className="choice" aria-pressed={mode === "override"} onClick={() => setMode("override")}>
          Change the risk level
        </button>
      </div>
      {mode === "override" && (
        <label className="field">
          New risk level
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            <option value="">Choose…</option>
            {options.map((l) => <option key={l} value={l}>{l[0] + l.slice(1).toLowerCase()}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        {mode === "override" ? "Reason (required)" : "Note (optional)"}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "override" ? "e.g. BP re-measured at PHC was 128/82" : ""} />
        {mode === "override" && !reasonOk && <span className="small muted">At least 10 characters</span>}
      </label>
      {msg && <div className={`notice ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
      <button className="btn block" onClick={submit} disabled={busy || (mode === "override" && (!level || !reasonOk))}>
        {busy ? "Saving…" : mode === "accept" ? "Accept" : "Save change"}
      </button>
    </div>
  );
}
