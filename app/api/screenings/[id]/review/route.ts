import { prisma } from "@/lib/server/db";
import { HttpError, json, notFound, readJson, route } from "@/lib/server/http";
import { requireDoctor } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { ReviewInput } from "@/lib/server/validators";

// POST /api/screenings/:id/review — DOCTOR ONLY.
// { action: "accept" } or { action: "override", riskLevel, reason }
export const POST = route<{ id: string }>(async (req, { id }) => {
  const doctor = await requireDoctor(req); // 403 for health workers, even if they call this directly
  const input = ReviewInput.parse(await readJson(req));

  const s = await prisma.screening.findFirst({ where: { id, patient: { deletedAt: null } } });
  if (!s) throw notFound();

  const isOverride = input.action === "override";
  if (isOverride && input.riskLevel === s.computedRisk) {
    throw new HttpError(422, "That is the same as the computed risk — use Accept instead");
  }

  const next = {
    reviewStatus: isOverride ? ("OVERRIDDEN" as const) : ("ACCEPTED" as const),
    finalRisk: isOverride ? input.riskLevel : s.computedRisk,
    reviewReason: isOverride ? input.reason : (input.note?.trim() || null),
  };

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.screening.update({
      where: { id },
      data: { ...next, reviewedById: doctor.id, reviewedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: doctor.id,
      action: isOverride ? "REVIEW_OVERRIDE" : "REVIEW_ACCEPT",
      entityType: "Screening",
      entityId: id,
      oldValue: {
        reviewStatus: s.reviewStatus,
        finalRisk: s.finalRisk,
        reviewReason: s.reviewReason,
        reviewedById: s.reviewedById,
      },
      newValue: { ...next, computedRisk: s.computedRisk },
      reason: next.reviewReason,
    });
    return u;
  });

  return json({ screening: { id: updated.id, reviewStatus: updated.reviewStatus, finalRisk: updated.finalRisk } });
});
