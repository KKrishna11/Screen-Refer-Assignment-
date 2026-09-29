import { prisma } from "./db";
import { nameSimilarity } from "../names";
import type { SessionUser } from "./auth";

// Same phone number = possible same person. In India a family often shares one phone,
// so we warn instead of blocking, and rank by how close the names are
// ("Sunita Devi" vs "Suneeta Devi" ≈ same; "Ramesh" vs "Sunita" = likely a relative).
export async function findPossibleDuplicates(user: SessionUser, phone: string, fullName: string, excludeId?: string) {
  const same = await prisma.patient.findMany({
    where: { phone, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, fullName: true, dob: true, sex: true, createdById: true },
    take: 20,
  });
  const scored = same
    .map((p) => ({ ...p, similarity: Math.round(nameSimilarity(fullName, p.fullName) * 100) / 100 }))
    .sort((a, b) => b.similarity - a.similarity);

  // Doctors can see everyone. A worker only sees details of their own patients; for other
  // workers' patients we only say "exists", so this check can't be used to look people up.
  const visible = scored.filter((p) => user.role === "DOCTOR" || p.createdById === user.id);
  return {
    matches: visible.map(({ createdById: _c, ...rest }) => rest),
    otherWorkersCount: scored.length - visible.length,
  };
}
