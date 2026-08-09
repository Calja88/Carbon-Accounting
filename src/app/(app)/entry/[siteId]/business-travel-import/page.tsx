import { redirect } from "next/navigation";

/** Moved to /data/entry/[siteId]/business-travel-import — see /entry/page.tsx. */
export default async function LegacyBusinessTravelImportRedirect({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  redirect(`/data/entry/${siteId}/business-travel-import`);
}
