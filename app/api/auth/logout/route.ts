import { json, route } from "@/lib/server/http";
import { SESSION_COOKIE } from "@/lib/server/session";

export const POST = route(async () => {
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
});
