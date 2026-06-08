import { NextResponse } from "next/server";
import { AUTH_COOKIE, hashPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    // Gate disabled — nothing to log in to.
    return NextResponse.json({ ok: true });
  }

  let submitted: unknown;
  try {
    ({ password: submitted } = await request.json());
  } catch {
    submitted = undefined;
  }

  if (typeof submitted !== "string" || submitted !== password) {
    return NextResponse.json(
      { error: "Incorrect password" },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await hashPassword(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
