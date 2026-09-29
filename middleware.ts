import { NextResponse, type NextRequest } from "next/server";

// Convenience only: send logged-out visitors to /login instead of showing an empty page.
// This is NOT the security check — every API route verifies the signed session and role itself.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login") return NextResponse.next();
  if (!req.cookies.has("sr_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|sw.js).*)"],
};
