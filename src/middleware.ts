import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: cookie presence + public path routing ONLY. All real
 * authorization happens server-side in the session layer and RBAC guard
 * (Phase 1) — middleware decisions are never trusted for access control.
 */
const PUBLIC_PATHS: readonly string[] = ["/", "/login", "/health"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/health")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie =
    request.cookies.has("authjs.session-token") || request.cookies.has("__Secure-authjs.session-token");

  if (!isPublic(pathname) && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
