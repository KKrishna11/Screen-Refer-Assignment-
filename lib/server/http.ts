import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: Record<string, unknown>) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "Not found");
export const forbidden = (msg = "This action is only available to doctors") => new HttpError(403, msg);

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

// Browsers always send Origin on cross-site POST/PATCH/DELETE. If it is present and
// doesn't match our own host, refuse. (SameSite=Lax cookies already block most CSRF;
// this is a second lock.)
function checkOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, "Cross-site request refused");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, "Cross-site request refused");
  }
}

type Ctx<P> = { params: Promise<P> };

// Wraps every API route: consistent JSON errors, and no stack traces leak to the client.
export function route<P = Record<string, never>>(fn: (req: NextRequest, params: P) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      checkOrigin(req);
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await fn(req, params);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.body }, e.status);
      if (e instanceof ZodError) {
        return json(
          { error: "Invalid input", fields: Object.fromEntries(e.issues.map((i) => [i.path.join("."), i.message])) },
          422,
        );
      }
      console.error(e);
      return json({ error: "Something went wrong on the server" }, 500);
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

export function pageParams(req: NextRequest, maxSize = 50) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(sp.get("pageSize") ?? "20", 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}
