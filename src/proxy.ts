import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Paths served to signed-out visitors. The login page renders the Paragon
 * ID mark from /public/logos, so those requests must not themselves be
 * redirected to /login — that returns an HTML redirect where an image is
 * expected, and the logo renders broken.
 *
 * Checked here in the function body as well as excluded by `config.matcher`
 * below: the matcher is compiled into a build artifact that a platform
 * build cache can serve a stale copy of, whereas this runs on every
 * request that reaches the middleware at all.
 */
function isPublicAsset(pathname: string): boolean {
  return pathname.startsWith("/logos/");
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (isPublicAsset(pathname)) return;

  const isLoggedIn = !!req.auth;
  const isLoginPage = pathname.startsWith("/login");

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
