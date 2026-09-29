// Route-handler tests with the database mocked out: proves the server itself enforces
// roles and row-level scoping, independent of what the UI shows.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123";

const users = {
  w1: { id: "w1", username: "worker1", name: "Worker One", role: "WORKER" },
  w2: { id: "w2", username: "worker2", name: "Worker Two", role: "WORKER" },
  doc: { id: "doc", username: "doctor", name: "Doctor", role: "DOCTOR" },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => Promise<any>;
const fn = (impl?: AnyFn) => vi.fn<AnyFn>(impl);

const db = {
  user: { findUnique: fn(async ({ where }: { where: { id: string } }) => users[where.id as keyof typeof users] ?? null) },
  patient: { findFirst: fn(), findMany: fn(async () => []), count: fn(async () => 0), update: fn() },
  screening: { findFirst: fn(), findUnique: fn(), findMany: fn(async () => []), count: fn(async () => 0), update: fn(), create: fn() },
  auditLog: { create: fn(), findMany: fn(async () => []), count: fn(async () => 0) },
  $transaction: fn(async (cb: (tx: unknown) => unknown): Promise<unknown> => cb(txClient())),
};
function txClient(): unknown {
  return db;
}
vi.mock("@/lib/server/db", () => ({ prisma: db }));

const { createSessionToken } = await import("@/lib/server/session");
const review = await import("@/app/api/screenings/[id]/review/route");
const summary = await import("@/app/api/screenings/[id]/summary/route");
const audit = await import("@/app/api/audit/route");
const patients = await import("@/app/api/patients/route");
const patientById = await import("@/app/api/patients/[id]/route");
const screenings = await import("@/app/api/screenings/route");

function req(url: string, as: keyof typeof users | null, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as) headers.cookie = `sr_session=${createSessionToken(users[as].id)}`;
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => vi.clearAllMocks());

describe("doctor-only APIs called directly by a health worker", () => {
  it("review → 403 and nothing is written", async () => {
    const res = await review.POST(req("/api/screenings/s1/review", "w1", { method: "POST", body: { action: "accept" } }), params({ id: "s1" }));
    expect(res.status).toBe(403);
    expect(db.screening.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it("AI summary → 403", async () => {
    const res = await summary.POST(req("/api/screenings/s1/summary", "w1", { method: "POST" }), params({ id: "s1" }));
    expect(res.status).toBe(403);
  });
  it("audit log → 403", async () => {
    const res = await audit.GET(req("/api/audit", "w1"), params({}));
    expect(res.status).toBe(403);
  });
  it("no session → 401", async () => {
    const res = await review.POST(req("/api/screenings/s1/review", null, { method: "POST", body: { action: "accept" } }), params({ id: "s1" }));
    expect(res.status).toBe(401);
  });
});

describe("row-level scoping", () => {
  it("a worker's patient list is filtered to their own records on the server", async () => {
    await patients.GET(req("/api/patients", "w1"), params({}));
    const where = db.patient.findMany.mock.calls[0][0].where;
    expect(where.createdById).toBe("w1");
  });
  it("the doctor's list is not filtered by worker", async () => {
    await patients.GET(req("/api/patients", "doc"), params({}));
    expect(db.patient.findMany.mock.calls[0][0].where.createdById).toBeUndefined();
  });
  it("another worker's patient returns 404 (existence is not revealed)", async () => {
    db.patient.findFirst.mockImplementation(async ({ where }: { where: { createdById?: string } }) =>
      where.createdById === "w2" ? { id: "p1" } : null,
    );
    const res = await patientById.GET(req("/api/patients/p1", "w1"), params({ id: "p1" }));
    expect(res.status).toBe(404);
    expect(db.patient.findFirst.mock.calls[0][0].where.createdById).toBe("w1");
  });
  it("a worker's screening list is filtered to their own", async () => {
    await screenings.GET(req("/api/screenings", "w1"), params({}));
    expect(db.screening.findMany.mock.calls[0][0].where.workerId).toBe("w1");
  });
});

describe("doctor review", () => {
  const s = { id: "s1", computedRisk: "MEDIUM", finalRisk: "MEDIUM", reviewStatus: "PENDING", reviewReason: null, reviewedById: null };

  it("override without a reason is rejected", async () => {
    db.screening.findFirst.mockResolvedValue(s);
    const res = await review.POST(
      req("/api/screenings/s1/review", "doc", { method: "POST", body: { action: "override", riskLevel: "HIGH", reason: " " } }),
      params({ id: "s1" }),
    );
    expect(res.status).toBe(422);
    expect(db.screening.update).not.toHaveBeenCalled();
  });

  it("override with a reason updates and logs who/what/when/old value", async () => {
    db.screening.findFirst.mockResolvedValue(s);
    db.screening.update.mockResolvedValue({ id: "s1", reviewStatus: "OVERRIDDEN", finalRisk: "HIGH" });
    const res = await review.POST(
      req("/api/screenings/s1/review", "doc", {
        method: "POST",
        body: { action: "override", riskLevel: "HIGH", reason: "Known TB contact in household" },
      }),
      params({ id: "s1" }),
    );
    expect(res.status).toBe(200);
    const log = db.auditLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ actorId: "doc", action: "REVIEW_OVERRIDE", entityId: "s1", reason: "Known TB contact in household" });
    expect(log.oldValue).toMatchObject({ finalRisk: "MEDIUM", reviewStatus: "PENDING" });
    expect(log.newValue).toMatchObject({ finalRisk: "HIGH", reviewStatus: "OVERRIDDEN" });
  });
});

describe("AI failure never breaks the screening", () => {
  it("with no API key the summary endpoint answers 200 FAILED, not 500", async () => {
    delete process.env.GEMINI_API_KEY;
    db.screening.findFirst.mockResolvedValue({
      id: "s1", ageYears: 30, computedRisk: "LOW", score: 0, reasons: [], answers: {}, missingQuestions: [],
      aiStatus: "NONE", patient: { sex: "MALE" },
    });
    const res = await summary.POST(req("/api/screenings/s1/summary", "doc", { method: "POST" }), params({ id: "s1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("FAILED");
    expect(body.message).toMatch(/not affected/);
  });

  it("times out cleanly when the provider hangs", async () => {
    process.env.GEMINI_API_KEY = "test";
    process.env.AI_TIMEOUT_MS = "50";
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    try {
      db.screening.findFirst.mockResolvedValue({
        id: "s1", ageYears: 30, computedRisk: "LOW", score: 0, reasons: [], answers: {}, missingQuestions: [],
        aiStatus: "NONE", patient: { sex: "MALE" },
      });
      const res = await summary.POST(req("/api/screenings/s1/summary", "doc", { method: "POST" }), params({ id: "s1" }));
      const body = await res.json();
      expect(body.status).toBe("FAILED");
      expect(body.message).toMatch(/too long/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("screening submission", () => {
  it("re-sending the same clientId returns the existing screening instead of creating a duplicate", async () => {
    db.screening.findUnique.mockResolvedValue({ id: "s-existing", workerId: "w1" });
    const res = await screenings.POST(
      req("/api/screenings", "w1", { method: "POST", body: { clientId: "abcdef123456", patientId: "p1", answers: {} } }),
      params({}),
    );
    const body = await res.json();
    expect(body).toMatchObject({ screening: { id: "s-existing" }, duplicateSubmission: true });
    expect(db.screening.create).not.toHaveBeenCalled();
  });

  it("age and sex come from the database record, not the request", async () => {
    db.screening.findUnique.mockResolvedValue(null);
    // 6-year-old girl in the DB; client tries to submit menstrual answers
    db.patient.findFirst.mockResolvedValue({ id: "p1", dob: new Date(Date.UTC(2020, 0, 1)), sex: "FEMALE", createdById: "w1" });
    db.screening.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "s-new", ...data }));
    const res = await screenings.POST(
      req("/api/screenings", "w1", {
        method: "POST",
        body: {
          clientId: "abcdef123457",
          patientId: "p1",
          answers: { fever: "no", cough: "no", breathless: "no", weight_loss: "no", periods_started: "yes", pregnant: "yes" },
        },
      }),
      params({}),
    );
    expect(res.status).toBe(201);
    const data = db.screening.create.mock.calls[0][0].data;
    expect(data.answers).not.toHaveProperty("periods_started");
    expect(data.hiddenAnswers).toHaveProperty("periods_started");
  });
});
