import { auth } from "@/auth";

/** Returns the session only if the signed-in user is an Admin, else null. */
export async function requireAdminSession() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session;
}
