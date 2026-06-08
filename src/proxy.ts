import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isValidAuthCookie } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  // Gate is disabled when no password is configured (e.g. local dev without
  // SITE_PASSWORD set), so you can't accidentally lock yourself out.
  if (!process.env.SITE_PASSWORD) return NextResponse.next();

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (await isValidAuthCookie(token)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except the login page, the login endpoint, and static
  // assets. This also gates /api/* so the data routes aren't reachable without
  // the auth cookie.
  matcher: [
    "/((?!api/login|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
