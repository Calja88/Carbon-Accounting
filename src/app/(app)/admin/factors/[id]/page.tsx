import { redirect } from "next/navigation";

/** /admin/factors/[id] moved to /factors/[id] — see /admin/factors/page.tsx. */
export default async function LegacyAdminFactorDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/factors/${id}`);
}
