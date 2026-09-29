import { prisma } from "@/lib/server/db";
import { json, notFound, route } from "@/lib/server/http";
import { requireDoctor } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";

// POST /api/patients/:id/restore — doctor only: undo a soft delete
export const POST = route<{ id: string }>(async (req, { id }) => {
  const doctor = await requireDoctor(req);
  const p = await prisma.patient.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!p) throw notFound();
  await prisma.$transaction(async (tx) => {
    await tx.patient.update({ where: { id }, data: { deletedAt: null } });
    await writeAudit(tx, {
      actorId: doctor.id,
      action: "PATIENT_RESTORED",
      entityType: "Patient",
      entityId: id,
      oldValue: { deletedAt: p.deletedAt },
      newValue: { deletedAt: null },
    });
  });
  return json({ ok: true });
});
