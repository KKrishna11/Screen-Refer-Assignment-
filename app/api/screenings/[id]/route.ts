import { prisma } from "@/lib/server/db";
import { json, notFound, route } from "@/lib/server/http";
import { requireUser, screeningScope } from "@/lib/server/auth";
import { serializePatient } from "@/lib/server/serialize";

// GET /api/screenings/:id
export const GET = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  const s = await prisma.screening.findFirst({
    where: { id, ...screeningScope(user), patient: { deletedAt: null } },
    include: {
      patient: true,
      worker: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  });
  if (!s) throw notFound();

  const history =
    user.role === "DOCTOR"
      ? await prisma.auditLog.findMany({
          where: {
            OR: [
              { entityType: "Screening", entityId: s.id },
              { entityType: "Patient", entityId: s.patientId },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { actor: { select: { name: true, role: true } } },
        })
      : [];

  const { clientId: _clientId, patient, ...rest } = s;
  // the AI summary is written for the doctor; workers don't receive it
  const visible =
    user.role === "DOCTOR" ? rest : { ...rest, aiSummaryEn: null, aiSummaryHi: null, aiError: null, aiStatus: "NONE" as const };
  return json({
    screening: { ...visible, patient: serializePatient(patient) },
    history,
    disclaimer: "Screening aid only, not a diagnosis.",
  });
});
