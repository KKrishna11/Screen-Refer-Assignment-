// Server-side access control. Every protected API route calls one of these first.
// Hiding a button in the UI is convenience; these checks are the actual lock.

import type { NextRequest } from "next/server";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "./db";
import { HttpError, forbidden } from "./http";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export type SessionUser = Pick<User, "id" | "username" | "name" | "role">;

export async function currentUser(req: NextRequest): Promise<SessionUser | null> {
  const uid = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  return prisma.user.findUnique({ where: { id: uid }, select: { id: true, username: true, name: true, role: true } });
}

export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "Please log in");
  return user;
}

export async function requireDoctor(req: NextRequest): Promise<SessionUser> {
  const user = await requireUser(req);
  if (user.role !== "DOCTOR") throw forbidden();
  return user;
}

// Row-level scoping: a health worker only ever queries their own rows.
// Records belonging to someone else come back as "not found" (404), not "forbidden",
// so a worker can't even learn that a given id exists.
export function patientScope(user: SessionUser): Prisma.PatientWhereInput {
  return user.role === "DOCTOR" ? {} : { createdById: user.id };
}

export function screeningScope(user: SessionUser): Prisma.ScreeningWhereInput {
  return user.role === "DOCTOR" ? {} : { workerId: user.id };
}
