import { redirect } from "next/navigation";

/** /entry/[siteId] moved to /data/entry/[siteId] — see /entry/page.tsx. */
export default async function LegacyEntrySiteRedirect({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  redirect(`/data/entry/${siteId}`);
}
