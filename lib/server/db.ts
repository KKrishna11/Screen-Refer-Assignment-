import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads in dev and across warm serverless invocations.
const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;
