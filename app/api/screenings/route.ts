import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { HttpError, json, notFound, pageParams, readJson, route } from "@/lib/server/http";
import { patientScope, requireUser, screeningScope } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { ScreeningCreate } from "@/lib/server/validators";
import { computeScreening } from "@/lib/screening";

// GET /api/screenings?status=PENDING&risk=HIGH&page=
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const { page, pageSize, skip } = pageParams(req);
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const risk = sp.get("risk");

  const where: Prisma.ScreeningWhereInput = {
    ...screeningScope(user),
    patient: { deletedAt: null },
    ...(status && ["PENDING", "ACCEPTED", "OVERRIDDEN"].includes(status) ? { reviewStatus: status as never } : {}),
    ...(risk && ["LOW", "MEDIUM", "HIGH"].includes(risk) ? { finalRisk: risk as never } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.screening.count({ where }),
    prisma.screening.findMany({
      where,
      // pending first, then highest risk, then newest (MySQL sorts enums by declared order)
      orderBy: [{ reviewStatus: "asc" }, { finalRisk: "desc" }, { screenedAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        screenedAt: true,
        ageYears: true,
        computedRisk: true,
        finalRisk: true,
        reviewStatus: true,
        recomputedNote: true,
        patient: { select: { id: true, fullName: true, sex: true } },
        worker: { select: { name: true } },
      },
    }),
  ]);
  return json({ items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

// POST /api/screenings — submit a screening. Safe to retry: the same clientId never creates twice.
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = ScreeningCreate.parse(await readJson(req));

  // retry of a submission that already reached us (e.g. the connection dropped before the reply)
  const existing = await prisma.screening.findUnique({ where: { clientId: input.clientId } });
  if (existing) {
    if (existing.workerId !== user.id) throw new HttpError(409, "This submission id is already used");
    return json({ screening: { id: existing.id }, duplicateSubmission: true });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: input.patientId, ...patientScope(user), deletedAt: null },
  });
  if (!patient) throw notFound();

  const now = new Date();
  // Age and sex come from the database, never from the browser.
  const c = computeScreening(patient, input.answers, now);
  if (Object.keys(c.errors).length || c.missing.length) {
    throw new HttpError(422, "Some answers are missing or invalid", { answerErrors: c.errors, missing: c.missing });
  }

  try {
    const s = await prisma.$transaction(async (tx) => {
      const created = await tx.screening.create({
        data: {
          clientId: input.clientId,
          patientId: patient.id,
          workerId: user.id,
          formVersion: c.formVersion,
          rulesVersion: c.rulesVersion,
          screenedAt: now,
          ageYears: c.ageYears,
          answers: c.active as Prisma.InputJsonValue,
          hiddenAnswers: c.hidden as Prisma.InputJsonValue,
          missingQuestions: [],
          score: c.score,
          computedRisk: c.level,
          finalRisk: c.level,
          reasons: c.reasons as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: "SCREENING_CREATED",
        entityType: "Screening",
        entityId: created.id,
        newValue: { patientId: patient.id, computedRisk: c.level, score: c.score, hiddenAnswers: Object.keys(c.hidden) },
      });
      return created;
    });
    return json({ screening: { id: s.id, risk: s.computedRisk } }, 201);
  } catch (e) {
    // two retries raced each other: the unique clientId stopped the second one
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.screening.findUnique({ where: { clientId: input.clientId } });
      if (again && again.workerId === user.id) return json({ screening: { id: again.id }, duplicateSubmission: true });
    }
    throw e;
  }
});
