import { redirect } from "next/navigation";

/** /entry/[siteId]/[code] moved to /data/entry/[siteId]/[code] — see /entry/page.tsx. */
export default async function LegacyEntryFormRedirect({
  params,
}: {
  params: Promise<{ siteId: string; code: string }>;
}) {
  const { siteId, code } = await params;
  redirect(`/data/entry/${siteId}/${code}`);
}
