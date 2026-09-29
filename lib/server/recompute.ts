// When a patient's date of birth (or sex) is corrected, every past screening is
// re-evaluated against the corrected facts. Nothing is thrown away:
//  - answers that no longer apply move to `hiddenAnswers`
//  - answers that were hidden and now apply again move back
//  - questions that now apply but were never asked are listed in `missingQuestions`
//  - if the computed risk changes, the doctor's earlier review is re-opened
// Every change is written to the audit log with the old values.

import type { Prisma, Screening } from "@prisma/client";
import { ageOn } from "../age";
import { computeScreening, type PatientFacts } from "../screening";
import { findQuestion } from "../form-engine";
import { writeAudit } from "./audit";

type Tx = Prisma.TransactionClient;

const asObj = (v: Prisma.JsonValue): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function recomputeScreeningsForPatient(
  tx: Tx,
  patientId: string,
  before: PatientFacts,
  after: PatientFacts,
  actorId: string,
) {
  const screenings = await tx.screening.findMany({ where: { patientId } });
  let changed = 0;

  for (const s of screenings) {
    // everything the worker ever answered for this screening
    const allAnswers = { ...asObj(s.hiddenAnswers), ...asObj(s.answers) };
    const next = computeScreening(after, allAnswers, s.screenedAt);

    const same =
      next.level === s.computedRisk &&
      next.score === s.score &&
      next.ageYears === s.ageYears &&
      JSON.stringify(next.active) === JSON.stringify(s.answers) &&
      JSON.stringify(next.missing) === JSON.stringify(s.missingQuestions);
    if (same) continue;

    const note = buildNote(s, before, after, next.level, next.missing);
    const riskChanged = next.level !== s.computedRisk;
    const reopen = riskChanged && s.reviewStatus !== "PENDING";

    const data: Prisma.ScreeningUpdateInput = {
      ageYears: next.ageYears,
      answers: next.active as Prisma.InputJsonValue,
      hiddenAnswers: next.hidden as Prisma.InputJsonValue,
      missingQuestions: next.missing as Prisma.InputJsonValue,
      score: next.score,
      computedRisk: next.level,
      reasons: next.reasons as unknown as Prisma.InputJsonValue,
      rulesVersion: next.rulesVersion,
      recomputedNote: note,
      // an un-reviewed screening follows the new computed risk; a reviewed one whose
      // computed risk moved goes back to the doctor's queue
      ...(s.reviewStatus === "PENDING" || reopen ? { finalRisk: next.level } : {}),
      ...(reopen ? { reviewStatus: "PENDING", reviewedBy: { disconnect: true }, reviewedAt: null, reviewReason: null } : {}),
      // AI summary described the old facts
      aiStatus: "NONE",
      aiSummaryEn: null,
      aiSummaryHi: null,
      aiError: null,
    };
    await tx.screening.update({ where: { id: s.id }, data });
    await writeAudit(tx, {
      actorId,
      action: "SCREENING_RECOMPUTED",
      entityType: "Screening",
      entityId: s.id,
      oldValue: {
        ageYears: s.ageYears,
        score: s.score,
        computedRisk: s.computedRisk,
        finalRisk: s.finalRisk,
        reviewStatus: s.reviewStatus,
        answers: s.answers,
        hiddenAnswers: s.hiddenAnswers,
      },
      newValue: {
        ageYears: next.ageYears,
        score: next.score,
        computedRisk: next.level,
        reviewReopened: reopen,
        missingQuestions: next.missing,
      },
      reason: note,
    });
    changed++;
  }
  return changed;
}

function buildNote(
  s: Screening,
  before: PatientFacts,
  after: PatientFacts,
  newRisk: string,
  missing: string[],
): string {
  const parts: string[] = [];
  if (before.dob.getTime() !== after.dob.getTime()) {
    parts.push(
      `Date of birth corrected: age at screening ${ageOn(before.dob, s.screenedAt).years} → ${ageOn(after.dob, s.screenedAt).years}.`,
    );
  }
  if (before.sex !== after.sex) parts.push(`Sex corrected: ${before.sex} → ${after.sex}.`);
  if (newRisk !== s.computedRisk) parts.push(`Computed risk changed ${s.computedRisk} → ${newRisk}.`);
  if (missing.length) {
    const labels = missing.map((id) => findQuestion(id)?.label.en ?? id);
    parts.push(`${missing.length} question(s) now apply but were not asked: ${labels.join("; ")}. Re-screen to complete.`);
  }
  return parts.join(" ");
}
