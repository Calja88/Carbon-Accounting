"use client";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { AppShell } from "./app-shell";
/** Tiny Next-specific bridge. All membership/scope resolution stays in the existing server layout. */
export function ConnectedShell(props: Omit<ComponentProps<typeof AppShell>, "pathname">) {
  const pathname = usePathname();
  return <AppShell {...props} pathname={pathname} />;
}
