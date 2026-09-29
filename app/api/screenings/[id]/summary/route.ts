import { prisma } from "@/lib/server/db";
import { json, notFound, route } from "@/lib/server/http";
import { requireDoctor } from "@/lib/server/auth";
import { generateSummary } from "@/lib/server/ai";
import type { Answers } from "@/lib/form-engine";
import type { RiskReason } from "@/lib/risk";

export const maxDuration = 30; // seconds (Vercel); the AI call itself times out sooner

// POST /api/screenings/:id/summary?force=1 — DOCTOR ONLY.
// Always answers 200 with a status. An AI failure is reported, never turned into a 500,
// and never affects the screening, the risk level or the review.
export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireDoctor(req);
  const force = req.nextUrl.searchParams.get("force") === "1";

  const s = await prisma.screening.findFirst({ where: { id, patient: { deletedAt: null } }, include: { patient: true } });
  if (!s) throw notFound();

  if (!force && s.aiStatus === "OK" && s.aiSummaryEn && s.aiSummaryHi) {
    return json({ status: "OK", english: s.aiSummaryEn, hindi: s.aiSummaryHi, cached: true });
  }

  const result = await generateSummary({
    ageYears: s.ageYears,
    sex: s.patient.sex,
    risk: s.computedRisk,
    score: s.score,
    reasons: s.reasons as unknown as RiskReason[],
    answers: s.answers as unknown as Answers,
    missing: s.missingQuestions as unknown as string[],
  });

  if (result.ok) {
    await prisma.screening.update({
      where: { id },
      data: {
        aiStatus: "OK",
        aiSummaryEn: result.value.english,
        aiSummaryHi: result.value.hindi,
        aiError: null,
        aiUpdatedAt: new Date(),
      },
    });
    return json({ status: "OK", english: result.value.english, hindi: result.value.hindi, model: result.model });
  }

  // keep any older good summary; just record that this attempt failed
  await prisma.screening.update({
    where: { id },
    data: { aiError: result.error.slice(0, 255), aiUpdatedAt: new Date(), ...(s.aiStatus === "OK" ? {} : { aiStatus: "FAILED" }) },
  });
  return json({
    status: "FAILED",
    message: `${result.error}. The screening and its risk result are not affected.`,
  });
});
