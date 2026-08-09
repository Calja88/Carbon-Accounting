import { redirect } from "next/navigation";

/** Moved to /data/entry/[siteId]/electricity-contract — see /entry/page.tsx. */
export default async function LegacyElectricityContractRedirect({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  redirect(`/data/entry/${siteId}/electricity-contract`);
}
