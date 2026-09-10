"use client";
import { usePathname } from "next/navigation";
import { LcaNavigation, type AssessmentNavItem } from "@/components/board/lca-navigation";
export type NavItem = AssessmentNavItem;
export function AssessmentNav({ assessmentId, items }: { assessmentId: string; items: NavItem[] }) {
  return <LcaNavigation assessmentId={assessmentId} items={items} pathname={usePathname()} />;
}
