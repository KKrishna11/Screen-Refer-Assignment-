import { prisma } from "@/lib/server/db";
import { HttpError, json, notFound, readJson, route } from "@/lib/server/http";
import { patientScope, requireUser, screeningScope, type SessionUser } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { PatientUpdate } from "@/lib/server/validators";
import { findPossibleDuplicates } from "@/lib/server/duplicates";
import { recomputeScreeningsForPatient } from "@/lib/server/recompute";
import { serializePatient } from "@/lib/server/serialize";
import { nameKey } from "@/lib/names";

type P = { id: string };

async function loadPatient(user: SessionUser, id: string) {
  const p = await prisma.patient.findFirst({ where: { id, ...patientScope(user), deletedAt: null } });
  if (!p) throw notFound();
  return p;
}

// GET /api/patients/:id
export const GET = route<P>(async (req, { id }) => {
  const user = await requireUser(req);
  const p = await loadPatient(user, id);
  const screenings = await prisma.screening.findMany({
    where: { patientId: id, ...screeningScope(user) },
    orderBy: { screenedAt: "desc" },
    select: {
      id: true,
      screenedAt: true,
      computedRisk: true,
      finalRisk: true,
      reviewStatus: true,
      ageYears: true,
      recomputedNote: true,
      worker: { select: { name: true } },
    },
  });
  // Doctors also see other records sharing this phone number, to spot duplicates.
  const duplicates = user.role === "DOCTOR" ? (await findPossibleDuplicates(user, p.phone, p.fullName, p.id)).matches : [];
  return json({ patient: serializePatient(p), screenings, duplicates });
});

// PATCH /api/patients/:id — correct details. DOB/sex changes re-score past screenings.
export const PATCH = route<P>(async (req, { id }) => {
  const user = await requireUser(req);
  const before = await loadPatient(user, id);
  const input = PatientUpdate.parse(await readJson(req));

  if (input.phone && input.phone !== before.phone && !input.confirmNotDuplicate) {
    const dupes = await findPossibleDuplicates(user, input.phone, input.fullName ?? before.fullName, id);
    if (dupes.matches.length || dupes.otherWorkersCount) {
      throw new HttpError(409, "Someone with this phone number is already registered", {
        code: "POSSIBLE_DUPLICATE",
        ...dupes,
      });
    }
  }

  const data = {
    ...(input.fullName !== undefined ? { fullName: input.fullName, nameKey: nameKey(input.fullName) } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.dob !== undefined ? { dob: input.dob } : {}),
    ...(input.sex !== undefined ? { sex: input.sex } : {}),
    ...(input.village !== undefined ? { village: input.village } : {}),
  };

  const oldSer = serializePatient(before);
  const result = await prisma.$transaction(async (tx) => {
    const after = await tx.patient.update({ where: { id }, data });
    const newSer = serializePatient(after);

    // log only the fields that actually changed, with their old values
    const fields = ["fullName", "phone", "dob", "sex", "village"] as const;
    const changedOld: Record<string, unknown> = {};
    const changedNew: Record<string, unknown> = {};
    for (const f of fields) {
      if (oldSer[f] !== newSer[f]) {
        changedOld[f] = oldSer[f];
        changedNew[f] = newSer[f];
      }
    }
    if (Object.keys(changedNew).length) {
      await writeAudit(tx, {
        actorId: user.id,
        action: "PATIENT_UPDATED",
        entityType: "Patient",
        entityId: id,
        oldValue: changedOld,
        newValue: changedNew,
        reason: input.changeReason ?? null,
      });
    }

    let rescored = 0;
    if (changedNew.dob !== undefined || changedNew.sex !== undefined) {
      rescored = await recomputeScreeningsForPatient(tx, id, before, after, user.id);
    }
    return { after: newSer, rescored };
  });

  return json({ patient: result.after, rescoredScreenings: result.rescored });
});

// DELETE /api/patients/:id — soft delete (the row stays, marked deleted, and is logged)
export const DELETE = route<P>(async (req, { id }) => {
  const user = await requireUser(req);
  const p = await loadPatient(user, id);
  await prisma.$transaction(async (tx) => {
    await tx.patient.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, {
      actorId: user.id,
      action: "PATIENT_DELETED",
      entityType: "Patient",
      entityId: id,
      oldValue: { deletedAt: null, fullName: p.fullName },
      newValue: { deletedAt: new Date().toISOString() },
    });
  });
  return json({ ok: true });
});
