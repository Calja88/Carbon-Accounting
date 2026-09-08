import { notFound } from "next/navigation";
import { getVersion } from "@/lib/lca/assessment-service";
import { getLcaContext } from "@/lib/lca/permissions";
import { BOUNDARY_LABELS, STAGE_LABELS } from "@/lib/lca/labels";
import { formatKgPrecise } from "@/components/charts/palette";
import { Badge } from "@/components/ui/badge";
import { BackLink, DataTable, FieldList, Notice, PageHeading, SectionCard, Stat, Td } from "@/components/lca/ui";

export const dynamic = "force-dynamic";

/** The shape of what buildVersionPayload freezes. Read defensively — an older
 *  payload may predate a field, and it still has to render. */
interface FrozenPayload {
  schemaVersion?: number;
  frozenAt?: string;
  assessment?: Record<string, unknown> & {
    reference?: string;
    title?: string;
    goal?: string | null;
    boundary?: string;
    functionalUnitDescription?: string | null;
    includedStages?: string[];
    periodStart?: string | null;
    periodEnd?: string | null;
  };
  methodology?: { name?: string; version?: string; gwpBasis?: string; recyclingMethod?: string; biogenicTreatment?: string };
  calculation?: {
    runAt?: string;
    engineVersion?: string;
    totals?: {
      headlinePerFunctionalUnitKgCo2e?: number;
      headlineModelKgCo2e?: number;
      functionalUnitsInModel?: number;
      model?: Record<string, number>;
    };
    results?: {
      id: string;
      stage: string;
      processName: string;
      itemName: string;
      normalizedValue: string;
      normalizedUnit: string;
      factorValue: string;
      factorUnit: string;
      factorSource: string;
      allocatedKgCo2e: string;
      perFunctionalUnitKgCo2e: string;
      formula: string;
    }[];
    factorSnapshot?: { source: string; version: string; unit: string; value: string; isPlaceholder: boolean }[];
  } | null;
  validation?: { errorCount?: number; warningCount?: number; advisoryCount?: number };
  readiness?: { overall?: string; overallExplanation?: string };
  registers?: {
    assumptions?: { assumption: string; rationale: string; materiality: string }[];
    exclusions?: { excludedItem: string; rationale: string; estimatedRelevance: string }[];
  };
  verifications?: { organisation: string; verifierName: string; verificationDate: string; assuranceType: string }[];
}

export default async function VersionDetailPage({
  params,
}: {
  params: Promise<{ id: string; versionId: string }>;
}) {
  const { id, versionId } = await params;
  const context = await getLcaContext();
  if (!context) notFound();
  const version = await getVersion(context, versionId, id);
  if (!version || version.assessmentId !== id) notFound();

  const payload = version.payload as unknown as FrozenPayload;
  const totals = payload.calculation?.totals;

  return (
    <div className="space-y-6">
      <BackLink href={`/assessments/${id}/versions`}>All versions</BackLink>

      <PageHeading
        eyebrow={`${version.assessment.reference} · ${version.assessment.productVersion.product.name}`}
        title={`Version ${version.version}${version.label ? ` — ${version.label}` : ""}`}
        description={`Frozen ${payload.frozenAt ? new Date(payload.frozenAt).toISOString().slice(0, 16).replace("T", " ") : "at issue"}${version.issuedBy ? ` by ${version.issuedBy.name}` : ""}. Nothing on this page can change.`}
        actions={<Badge tone={version.status === "ISSUED" ? "success" : "neutral"}>{version.status.replace(/_/g, " ").toLowerCase()}</Badge>}
      />

      <Notice tone="info" title="This is a frozen record">
        Everything below is the assessment exactly as it stood when this version was issued, including the emission
        factors as they were then. Editing the live assessment does not change it.
      </Notice>

      {totals && (
        <div className="grid gap-4 sm:grid-cols-3">
          <SectionCard title="Headline">
            <Stat
              label="Per functional unit"
              value={formatKgPrecise(totals.headlinePerFunctionalUnitKgCo2e ?? 0)}
              unit="kgCO2e"
            />
          </SectionCard>
          <SectionCard title="Model total">
            <Stat label="Whole model" value={formatKgPrecise(totals.headlineModelKgCo2e ?? 0)} unit="kgCO2e" />
          </SectionCard>
          <SectionCard title="Functional units">
            <Stat label="In the model" value={formatKgPrecise(totals.functionalUnitsInModel ?? 0)} />
          </SectionCard>
        </div>
      )}

      <SectionCard title="Goal and scope as issued">
        <FieldList
          items={[
            { label: "Reference", value: payload.assessment?.reference },
            { label: "Title", value: payload.assessment?.title },
            { label: "Goal", value: payload.assessment?.goal ?? null },
            {
              label: "Boundary",
              value: payload.assessment?.boundary
                ? BOUNDARY_LABELS[payload.assessment.boundary as keyof typeof BOUNDARY_LABELS]
                : null,
            },
            { label: "Functional unit", value: payload.assessment?.functionalUnitDescription ?? null },
            {
              label: "Stages in scope",
              value:
                payload.assessment?.includedStages
                  ?.map((s) => STAGE_LABELS[s as keyof typeof STAGE_LABELS] ?? s)
                  .join(", ") ?? null,
            },
            {
              label: "Period",
              value:
                payload.assessment?.periodStart && payload.assessment?.periodEnd
                  ? `${payload.assessment.periodStart.slice(0, 10)} to ${payload.assessment.periodEnd.slice(0, 10)}`
                  : null,
            },
            {
              label: "Methodology",
              value: payload.methodology ? `${payload.methodology.name} ${payload.methodology.version}` : null,
            },
            { label: "GWP basis", value: payload.methodology?.gwpBasis ?? null },
            { label: "Recycling treatment", value: payload.methodology?.recyclingMethod?.replace(/_/g, " ").toLowerCase() ?? null },
            { label: "Biogenic treatment", value: payload.methodology?.biogenicTreatment?.replace(/_/g, " ").toLowerCase() ?? null },
            { label: "Calculation engine", value: payload.calculation?.engineVersion ?? version.engineVersion },
            {
              label: "Validation at issue",
              value: payload.validation
                ? `${payload.validation.errorCount ?? 0} error(s), ${payload.validation.warningCount ?? 0} warning(s), ${payload.validation.advisoryCount ?? 0} advisory`
                : null,
            },
            { label: "Readiness at issue", value: payload.readiness?.overallExplanation ?? null },
          ]}
        />
      </SectionCard>

      {payload.calculation?.factorSnapshot && payload.calculation.factorSnapshot.length > 0 && (
        <SectionCard
          title="Factor snapshot"
          description="Every factor this version's figures were calculated from, as they were at the time."
        >
          <DataTable headers={["Source", "Version", { label: "Value", align: "right" }, "Per unit", "Placeholder"]}>
            {payload.calculation.factorSnapshot.map((factor, index) => (
              <tr key={`${factor.source}-${index}`}>
                <Td>{factor.source}</Td>
                <Td className="text-xs">{factor.version}</Td>
                <Td align="right">{factor.value}</Td>
                <Td className="text-xs">{factor.unit}</Td>
                <Td className="text-xs">{factor.isPlaceholder ? "Yes — illustrative only" : "No"}</Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}

      {payload.calculation?.results && payload.calculation.results.length > 0 && (
        <SectionCard title="Calculation register as issued" description="Every result line with its arithmetic.">
          <DataTable
            headers={["Stage", "Process", "Line", { label: "Activity", align: "right" }, "Factor", "Calculation", { label: "kgCO2e", align: "right" }]}
          >
            {payload.calculation.results.map((result) => (
              <tr key={result.id}>
                <Td className="text-xs">{STAGE_LABELS[result.stage as keyof typeof STAGE_LABELS] ?? result.stage}</Td>
                <Td className="text-xs">{result.processName}</Td>
                <Td className="font-medium text-slate-900">{result.itemName}</Td>
                <Td align="right">
                  {result.normalizedValue} {result.normalizedUnit}
                </Td>
                <Td className="text-xs">
                  {result.factorValue} kgCO2e/{result.factorUnit}
                  <span className="block text-slate-500">{result.factorSource}</span>
                </Td>
                <Td className="font-mono text-[11px]">{result.formula}</Td>
                <Td align="right">{formatKgPrecise(Number(result.allocatedKgCo2e))}</Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}

      {payload.registers?.assumptions && payload.registers.assumptions.length > 0 && (
        <SectionCard title="Assumptions as issued">
          <DataTable headers={["Assumption", "Rationale", "Materiality"]}>
            {payload.registers.assumptions.map((assumption, index) => (
              <tr key={index}>
                <Td className="font-medium text-slate-900">{assumption.assumption}</Td>
                <Td className="text-xs">{assumption.rationale}</Td>
                <Td className="text-xs">{assumption.materiality?.toLowerCase()}</Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}

      {payload.registers?.exclusions && payload.registers.exclusions.length > 0 && (
        <SectionCard title="Exclusions as issued">
          <DataTable headers={["Excluded", "Rationale", "Estimated relevance"]}>
            {payload.registers.exclusions.map((exclusion, index) => (
              <tr key={index}>
                <Td className="font-medium text-slate-900">{exclusion.excludedItem}</Td>
                <Td className="text-xs">{exclusion.rationale}</Td>
                <Td className="text-xs">{exclusion.estimatedRelevance}</Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}

      {payload.verifications && payload.verifications.length > 0 && (
        <SectionCard title="Verification as issued">
          <DataTable headers={["Organisation", "Verifier", "Date", "Type"]}>
            {payload.verifications.map((verification, index) => (
              <tr key={index}>
                <Td className="font-medium text-slate-900">{verification.organisation}</Td>
                <Td>{verification.verifierName}</Td>
                <Td className="text-xs">{verification.verificationDate?.slice(0, 10)}</Td>
                <Td className="text-xs">{verification.assuranceType?.replace(/_/g, " ").toLowerCase()}</Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}
    </div>
  );
}
