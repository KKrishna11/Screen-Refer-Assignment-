"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client/api";
import { type Draft, loadDraft, newClientId, saveDraft, submitDraft } from "@/lib/client/drafts";
import { useSession } from "@/components/SessionProvider";
import { evaluateForm, findQuestion, form, labelFor, optionsFor, type Question } from "@/lib/form-engine";
import { ageOn, parseDateOnly } from "@/lib/age";
import { fmtDob, sexLabel } from "@/components/ui";

type PatientSnap = Draft["patient"];

export default function ScreenPage() {
  const { id: patientId } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, refreshQueue, online } = useSession();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<{ kind: "info" | "error" | "ok"; text: string; login?: boolean } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const firstMissingRef = useRef<HTMLDivElement | null>(null);

  // Load: the saved draft on this phone (if any) + fresh patient details from the server.
  useEffect(() => {
    if (!me) return;
    const existing = loadDraft(me.id, patientId);
    api<{ patient: PatientSnap & { id: string } }>(`/api/patients/${patientId}`)
      .then(({ patient }) => {
        const snap: PatientSnap = { fullName: patient.fullName, dob: patient.dob, sex: patient.sex };
        setDraft(existing ? { ...existing, patient: snap } : { clientId: newClientId(), patientId, patient: snap, answers: {}, updatedAt: Date.now(), queued: false });
        if (existing) setStatus({ kind: "info", text: "Your earlier answers were restored." });
      })
      .catch((e) => {
        if (existing && e instanceof ApiError && e.offline) {
          setDraft(existing);
          setStatus({ kind: "info", text: "Offline — working from the answers saved on this phone." });
        } else if (e instanceof ApiError && e.status === 404) {
          setLoadError("Patient not found (it may have been deleted).");
        } else {
          setLoadError(e instanceof ApiError ? e.message : "Could not load patient");
        }
      });
  }, [me, patientId]);

  const subject = useMemo(() => {
    const dob = draft ? parseDateOnly(draft.patient.dob) : null;
    if (!draft || !dob) return null;
    const a = ageOn(dob, new Date());
    return { ageYears: a.years, ageMonths: a.months, sex: draft.patient.sex };
  }, [draft]);

  const ev = useMemo(() => (draft && subject ? evaluateForm(draft.answers, subject) : null), [draft, subject]);

  function update(qid: string, value: unknown) {
    if (!draft || !me) return;
    const answers = { ...draft.answers };
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete answers[qid];
    else answers[qid] = value;
    const next = { ...draft, answers, queued: false };
    setDraft(next);
    setServerErrors({});
    if (!saveDraft(me.id, next)) setStatus({ kind: "error", text: "This phone could not save the answers (storage full?). Do not refresh the page." });
  }

  async function submit() {
    if (!draft || !me || !ev) return;
    if (ev.missing.length || Object.keys(ev.errors).length) {
      setShowErrors(true);
      setStatus({ kind: "error", text: `Please answer the ${ev.missing.length + Object.keys(ev.errors).length} highlighted question(s).` });
      setTimeout(() => firstMissingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }
    const queuedDraft = { ...draft, queued: true };
    saveDraft(me.id, queuedDraft); // saved before sending: if the network dies now, nothing is lost
    setDraft(queuedDraft);
    setSending(true);
    try {
      const screeningId = await submitDraft(me.id, queuedDraft);
      refreshQueue();
      router.replace(`/screenings/${screeningId}`);
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        setStatus({ kind: "info", text: "No connection. The screening is saved on this phone and will be sent automatically when the connection is back. You can move on to the next patient." });
        refreshQueue();
      } else if (e instanceof ApiError && e.status === 401) {
        setStatus({ kind: "error", text: "Your login has expired. Log in again — the screening is saved and will be sent after you log in.", login: true });
      } else if (e instanceof ApiError && e.status === 422) {
        const un = { ...draft, queued: false };
        saveDraft(me.id, un);
        setDraft(un);
        const errs: Record<string, string> = { ...((e.body.answerErrors as Record<string, string>) ?? {}) };
        for (const m of (e.body.missing as string[]) ?? []) errs[m] = "Please answer this question";
        setServerErrors(errs);
        setShowErrors(true);
        setStatus({ kind: "error", text: e.message });
      } else {
        const un = { ...draft, queued: false };
        saveDraft(me.id, un);
        setDraft(un);
        setStatus({ kind: "error", text: (e instanceof ApiError ? e.message : "Could not send") + " Your answers are still saved." });
      }
    } finally {
      setSending(false);
    }
  }

  // When the connection comes back while this page is open, send the queued screening
  // and open its result. (Sending twice is harmless: the server recognises the clientId.)
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && draft?.queued && !sending) submitRef.current();
    wasOnline.current = online;
  }, [online, draft?.queued, sending]);

  if (loadError) return <div className="notice error">{loadError}</div>;
  if (!draft || !ev || !subject) return <p className="muted">Loading…</p>;

  const hiddenIds = Object.keys(ev.hidden);
  let firstMissingAssigned = false;
  const totalVisible = ev.visibleQuestions.length;
  const answered = Object.keys(ev.active).length;

  return (
    <>
      <Link href={`/patients/${patientId}`} className="small">‹ Back to patient</Link>
      <h1>Screening: {draft.patient.fullName}</h1>
      <p className="muted small">
        {sexLabel(draft.patient.sex)} · {subject.ageYears} years (born {fmtDob(draft.patient.dob)}) · questions shown depend on age, sex and your answers
      </p>

      {status && (
        <div className={`notice ${status.kind === "error" ? "error" : status.kind === "ok" ? "ok" : ""}`}>
          {status.text} {status.login && <Link href={`/login?next=/patients/${patientId}/screen`}>Log in</Link>}
        </div>
      )}

      {hiddenIds.length > 0 && (
        <div className="notice">
          <strong>{hiddenIds.length} earlier answer(s) no longer apply</strong> because of a change you made, so they are hidden and will{" "}
          <strong>not</strong> count towards the risk. They are kept in the record for the doctor, and come back if you change the answer back:
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            {hiddenIds.map((qid) => {
              const q = findQuestion(qid)!;
              return (
                <li key={qid} className="small">
                  {q.label.en} — <span className="hidden-answer">{labelFor(q, ev.hidden[qid])}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {form.sections
        .filter((s) => ev.visibleSections.includes(s.id))
        .map((s) => {
          const qs = s.questions.filter((q) => ev.visibleQuestions.includes(q.id));
          if (!qs.length) return null;
          return (
            <section key={s.id} className="card">
              <h2 style={{ marginTop: 0 }}>
                {s.title.en} <span className="hi" lang="hi">{s.title.hi}</span>
              </h2>
              {qs.map((q) => {
                const err = serverErrors[q.id] ?? (showErrors ? ev.errors[q.id] ?? (ev.missing.includes(q.id) ? "Please answer this question" : undefined) : undefined);
                const attachRef = !!err && !firstMissingAssigned;
                if (attachRef) firstMissingAssigned = true;
                return (
                  <div className="q" key={q.id} ref={attachRef ? firstMissingRef : undefined}>
                    <div style={{ fontWeight: 600 }}>
                      {q.label.en} <span className="hi" lang="hi">{q.label.hi}</span>
                    </div>
                    <QuestionInput q={q} value={draft.answers[q.id]} onChange={(v) => update(q.id, v)} />
                    {err && <div className="err">{err}</div>}
                  </div>
                );
              })}
            </section>
          );
        })}

      <p className="small muted">
        {answered} of {totalVisible} answered · saved on this phone automatically
      </p>
      <button className="btn block" onClick={submit} disabled={sending}>
        {sending ? "Sending…" : draft.queued ? "Try sending again" : "Submit screening"}
      </button>
    </>
  );
}

function toAsciiDigits(s: string) {
  return s.replace(/[०-९]/g, (ch) => String(ch.charCodeAt(0) - 0x0966));
}

function QuestionInput({ q, value, onChange }: { q: Question; value: unknown; onChange: (v: unknown) => void }) {
  if (q.type === "number") {
    return (
      <div className="row" style={{ marginTop: 6 }}>
        <input
          style={{ maxWidth: 160 }}
          inputMode="numeric"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => {
            const digits = toAsciiDigits(e.target.value).replace(/\D/g, "").slice(0, 4);
            onChange(digits === "" ? undefined : Number(digits));
          }}
          aria-label={q.label.en}
        />
        {q.unit && <span className="muted">{q.unit.en}</span>}
        {(q.min !== undefined || q.max !== undefined) && <span className="small muted">({q.min}–{q.max})</span>}
      </div>
    );
  }

  const opts = optionsFor(q);
  if (q.type === "multi") {
    const current = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (v: string) => {
      if (current.includes(v)) return onChange(current.filter((x) => x !== v));
      if (v === q.exclusive) return onChange([v]); // "None" clears the others
      return onChange([...current.filter((x) => x !== q.exclusive), v]);
    };
    return (
      <div className="choices">
        {opts.map((o) => (
          <button type="button" key={o.value} className="choice" aria-pressed={current.includes(o.value)} onClick={() => toggle(o.value)}>
            {current.includes(o.value) ? "☑ " : "☐ "}
            {o.label.en} <span className="hi" lang="hi">{o.label.hi}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="choices" role="radiogroup" aria-label={q.label.en}>
      {opts.map((o) => (
        <button type="button" key={o.value} className="choice" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label.en} <span className="hi" lang="hi">{o.label.hi}</span>
        </button>
      ))}
    </div>
  );
}
