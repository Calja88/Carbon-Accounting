import { redirect } from "next/navigation";

/** /admin/factors/upload moved to /factors/upload — see /admin/factors/page.tsx. */
export default function LegacyAdminFactorUploadRedirect() {
  redirect("/factors/upload");
}
