import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken } from "@/lib/server/session";

const Body = z.object({ username: z.string().trim().toLowerCase().min(1).max(64), password: z.string().min(1).max(200) });

// used when the username doesn't exist, so a wrong username and a wrong password take the same time
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export const POST = route(async (req) => {
  const { username, password } = Body.parse(await readJson(req));
  const user = await prisma.user.findUnique({ where: { username } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, "Wrong username or password");

  const res = json({ user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
});
