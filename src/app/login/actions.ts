"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function loginAction(_prevState: { error: string | null }, formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    throw error;
  }
}
