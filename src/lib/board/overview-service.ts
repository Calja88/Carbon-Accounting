import type { OverviewModel, Section } from "./contracts";

export interface BoardScope { organisationId: string; siteIds: readonly string[]; from: string; to: string; asOfDate: string }
/** Opaque context is the real server-side OrganisationContext. Never obtain it from a client DTO. */
export interface OverviewPorts<Context> {
  authorizeScope(context: Context, scope: BoardScope): Promise<void>;
  header(context: Context, scope: BoardScope): Promise<Pick<OverviewModel, "organisationName" | "periodLabel" | "previousPeriodLabel" | "synthetic" | "managementPack">>;
  carbon(context: Context, scope: BoardScope): Promise<OverviewModel["carbon"]>;
  attention(context: Context, scope: BoardScope): Promise<OverviewModel["attention"]>;
  priorities(context: Context, scope: BoardScope): Promise<OverviewModel["priorities"]>;
  /** Receives the real exception so the adapter can log it (server-side only — the caller decides what is safe to emit). */
  sectionFailure(section: SectionName, error: unknown): void;
}
type SectionName = "carbon" | "attention" | "priorities";
/** Specific enough to act on without leaking the exception to the browser. */
const RECOVERY: Record<SectionName, string> = {
  carbon: "The emissions figures could not be read for this period. Refresh, or open the carbon inventory to check the period and site selection.",
  attention: "The attention queue could not be read. Refresh, or open the EMS workspaces directly — this is a fault, not an empty queue.",
  priorities: "Management focus could not be read. Refresh, or open Nonconformities and Compliance directly — this is a fault, not an empty list.",
};
async function section<T>(name: SectionName, load: () => Promise<Section<T>>, failed: OverviewPorts<unknown>["sectionFailure"]): Promise<Section<T>> {
  try { return await load(); } catch (error) { failed(name, error); return { state: "unavailable", message: RECOVERY[name] }; }
}
/** Read-only composition. No fixture fallback, shared cache, ORM query, calculation or write. */
export async function loadOverview<Context>(ports: OverviewPorts<Context>, context: Context, scope: BoardScope): Promise<OverviewModel> {
  await ports.authorizeScope(context, scope); // fail before any data fetch; don't turn denial into empty success
  const header = await ports.header(context, scope);
  const [carbon, attention, priorities] = await Promise.all([
    section("carbon", () => ports.carbon(context, scope), ports.sectionFailure),
    section("attention", () => ports.attention(context, scope), ports.sectionFailure),
    section("priorities", () => ports.priorities(context, scope), ports.sectionFailure),
  ]);
  return { ...header, capturedAt: new Date().toISOString(), carbon, attention, priorities };
}
