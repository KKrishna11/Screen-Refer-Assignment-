import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { HttpError, json, pageParams, readJson, route } from "@/lib/server/http";
import { patientScope, requireUser } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { PatientCreate } from "@/lib/server/validators";
import { findPossibleDuplicates } from "@/lib/server/duplicates";
import { nameKey } from "@/lib/names";
import { phoneSearchDigits } from "@/lib/phone";
import { serializePatient } from "@/lib/server/serialize";

// GET /api/patients?q=&page=&pageSize=  — search by name (any script) or phone (any format)
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const { page, pageSize, skip } = pageParams(req);
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  const showDeleted = user.role === "DOCTOR" && req.nextUrl.searchParams.get("deleted") === "1";
  const where: Prisma.PatientWhereInput = { ...patientScope(user), deletedAt: showDeleted ? { not: null } : null };
  if (q) {
    const digits = phoneSearchDigits(q);
    where.OR = digits ? [{ phone: { contains: digits } }] : [{ nameKey: { contains: nameKey(q) } }];
  }

  const [total, rows] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
      include: {
        createdBy: { select: { name: true } },
        screenings: { orderBy: { screenedAt: "desc" }, take: 1, select: { finalRisk: true, screenedAt: true } },
      },
    }),
  ]);

  return json({
    items: rows.map((p) => ({
      ...serializePatient(p),
      createdByName: p.createdBy.name,
      lastScreening: p.screenings[0] ?? null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

// POST /api/patients
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = PatientCreate.parse(await readJson(req));

  const dupes = await findPossibleDuplicates(user, input.phone, input.fullName);
  const hasDupes = dupes.matches.length > 0 || dupes.otherWorkersCount > 0;
  if (hasDupes && !input.confirmNotDuplicate) {
    throw new HttpError(409, "Someone with this phone number is already registered", {
      code: "POSSIBLE_DUPLICATE",
      matches: dupes.matches,
      otherWorkersCount: dupes.otherWorkersCount,
    });
  }

  const patient = await prisma.$transaction(async (tx) => {
    const p = await tx.patient.create({
      data: {
        fullName: input.fullName,
        nameKey: nameKey(input.fullName),
        phone: input.phone,
        dob: input.dob,
        sex: input.sex,
        village: input.village ?? null,
        createdById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: "PATIENT_CREATED",
      entityType: "Patient",
      entityId: p.id,
      newValue: serializePatient(p),
      reason: hasDupes ? "Registered after possible-duplicate warning (worker confirmed a different person)" : null,
    });
    return p;
  });

  return json({ patient: serializePatient(patient) }, 201);
});
