import type { OverviewModel, Section } from "./contracts";

export interface BoardScope { organisationId: string; siteIds: readonly string[]; from: string; to: string; asOfDate: string }
/** Opaque context is the real server-side OrganisationContext. Never obtain it from a client DTO. */
export interface OverviewPorts<Context> {
  authorizeScope(context: Context, scope: BoardScope): Promise<void>;
  header(context: Context, scope: BoardScope): Promise<Pick<OverviewModel, "organisationName" | "periodLabel" | "previousPeriodLabel" | "synthetic" | "managementPack">>;
  carbon(context: Context, scope: BoardScope): Promise<OverviewModel["carbon"]>;
  attention(context: Context, scope: BoardScope): Promise<OverviewModel["attention"]>;
  priorities(context: Context, scope: BoardScope): Promise<OverviewModel["priorities"]>;
  /** Only safe operational metadata: no exception payload/credentials/evidence. */
  sectionFailure(section: "carbon" | "attention" | "priorities"): void;
}
async function section<T>(load: () => Promise<Section<T>>, failed: () => void): Promise<Section<T>> {
  try { return await load(); } catch { failed(); return { state: "unavailable", message: "This section could not be loaded. Refresh or open its source workspace." }; }
}
/** Read-only composition. No fixture fallback, shared cache, ORM query, calculation or write. */
export async function loadOverview<Context>(ports: OverviewPorts<Context>, context: Context, scope: BoardScope): Promise<OverviewModel> {
  await ports.authorizeScope(context, scope); // fail before any data fetch; don't turn denial into empty success
  const header = await ports.header(context, scope);
  const [carbon, attention, priorities] = await Promise.all([
    section(() => ports.carbon(context, scope), () => ports.sectionFailure("carbon")),
    section(() => ports.attention(context, scope), () => ports.sectionFailure("attention")),
    section(() => ports.priorities(context, scope), () => ports.sectionFailure("priorities")),
  ]);
  return { ...header, capturedAt: new Date().toISOString(), carbon, attention, priorities };
}
