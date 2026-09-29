import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { json, pageParams, route } from "@/lib/server/http";
import { requireDoctor } from "@/lib/server/auth";

// GET /api/audit?entityId=&action=&page= — DOCTOR ONLY. Who changed what, when, and the old value.
export const GET = route(async (req) => {
  await requireDoctor(req);
  const { page, pageSize, skip } = pageParams(req, 100);
  const sp = req.nextUrl.searchParams;
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.get("entityId") ? { entityId: sp.get("entityId")! } : {}),
    ...(sp.get("action") ? { action: sp.get("action")! } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: { actor: { select: { name: true, role: true, username: true } } },
    }),
  ]);
  return json({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});
