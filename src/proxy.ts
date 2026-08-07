import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname.startsWith("/login");

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
});

export const config = {
  // `logos/` must be excluded alongside the framework's own static paths:
  // the login page (the one page an unauthenticated visitor sees) renders
  // the Paragon ID mark from /public/logos, and without this the image
  // request is itself redirected to /login and renders broken.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|logos/).*)"],
};
