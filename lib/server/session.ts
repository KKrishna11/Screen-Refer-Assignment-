// Stateless signed session cookie: base64url(payload) + "." + HMAC-SHA256(payload).
// The cookie is HttpOnly, so page JavaScript can't read or steal it.
// It only carries the user id; the role is re-read from the database on every request,
// so changing someone's role takes effect immediately.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "sr_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // one working day

type Payload = { uid: string; exp: number };

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSessionToken(uid: string, now = Date.now()): string {
  const payload: Payload = { uid, exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString()) as Payload;
    if (typeof p.uid !== "string" || typeof p.exp !== "number") return null;
    if (p.exp * 1000 < now) return null;
    return p.uid;
  } catch {
    return null;
  }
}
