import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listMethodologyProfiles } from "@/lib/lca/registers-service";
import { canManageMethodology, getLcaActor } from "@/lib/lca/permissions";
import {
  ALLOCATION_LABELS,
  BIOGENIC_LABELS,
  BOUNDARY_LABELS,
  ELECTRICITY_LABELS,
  OFFSET_LABELS,
  RECYCLING_METHOD_LABELS,
} from "@/lib/lca/labels";
import { Badge } from "@/components/ui/badge";
import { EmptyState, FieldList, Notice, PageHeading, SectionCard } from "@/components/lca/ui";
import { MethodologyForm } from "./methodology-form";

export const dynamic = "force-dynamic";

export default async function MethodologiesPage() {
  const [profiles, entities, actor] = await Promise.all([
    listMethodologyProfiles(),
    prisma.entity.findMany({ orderBy: { name: "asc" } }),
    getLcaActor(),
  ]);

  const canEdit = canManageMethodology(actor);

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Product carbon footprints"
        title="Methodology register"
        description="The methodological choices product assessments are calculated under, held as structured configuration rather than prose. Every field here is read by the calculation engine."
        actions={canEdit ? <MethodologyForm entities={entities.map((e) => ({ id: e.id, name: e.name }))} /> : null}
      />

      <Notice tone="info" title="Why this is configuration, not documentation">
        Allocation basis, recycling treatment, electricity approach, biogenic accounting, offset handling and the cut-off
        threshold each change a number. Holding them as fields means the engine applies them consistently, the report
        states them accurately, and a reviewer can see exactly which rules produced a figure — rather than relying on
        someone remembering to apply a written policy.
      </Notice>

      {profiles.length === 0 ? (
        <EmptyState
          title="No methodology profiles"
          description="Create one before starting an assessment. Without a profile the engine falls back to the most conservative reading available: no allocation credit, cut-off recycling, biogenic carbon out of the headline and offsets never netted off."
        />
      ) : (
        profiles.map((profile) => (
          <SectionCard
            key={profile.id}
            title={`${profile.name} ${profile.version}`}
            description={profile.summary}
            actions={
              <div className="flex items-center gap-2">
                {profile.isDefault && <Badge tone="success">Default</Badge>}
                <Badge tone="neutral">
                  {profile._count.assessments} assessment{profile._count.assessments === 1 ? "" : "s"}
                </Badge>
                {canEdit && (
                  <MethodologyForm
                    trigger="edit"
                    entities={entities.map((e) => ({ id: e.id, name: e.name }))}
                    profile={{
                      id: profile.id,
                      entityId: profile.entityId,
                      name: profile.name,
                      version: profile.version,
                      summary: profile.summary,
                      defaultBoundary: profile.defaultBoundary,
                      gwpBasis: profile.gwpBasis,
                      defaultAllocationMethod: profile.defaultAllocationMethod,
                      allocationRules: profile.allocationRules,
                      recyclingMethod: profile.recyclingMethod,
                      recyclingRules: profile.recyclingRules,
                      electricityApproach: profile.electricityApproach,
                      electricityRules: profile.electricityRules,
                      biogenicTreatment: profile.biogenicTreatment,
                      biogenicRules: profile.biogenicRules,
                      removalsRules: profile.removalsRules,
                      offsetTreatment: profile.offsetTreatment,
                      offsetRules: profile.offsetRules,
                      cutOffRules: profile.cutOffRules,
                      cutOffThresholdPercent: profile.cutOffThresholdPercent?.toString() ?? null,
                      factorHierarchy: profile.factorHierarchy,
                      dataQualityRequirements: profile.dataQualityRequirements,
                      minimumDataQualityScore: profile.minimumDataQualityScore?.toString() ?? null,
                      requireEvidenceForPrimary: profile.requireEvidenceForPrimary,
                      standardsReferenced: profile.standardsReferenced,
                      notes: profile.notes,
                      isDefault: profile.isDefault,
                    }}
                  />
                )}
              </div>
            }
          >
            <FieldList
              items={[
                { label: "Scope", value: profile.entity ? profile.entity.name : "The whole group" },
                { label: "Default boundary", value: BOUNDARY_LABELS[profile.defaultBoundary] },
                { label: "GWP basis", value: profile.gwpBasis },
                {
                  label: "Allocation",
                  value: `${ALLOCATION_LABELS[profile.defaultAllocationMethod]}${profile.allocationRules ? ` — ${profile.allocationRules}` : ""}`,
                },
                {
                  label: "Recycling",
                  value: `${RECYCLING_METHOD_LABELS[profile.recyclingMethod]}${profile.recyclingRules ? ` — ${profile.recyclingRules}` : ""}`,
                },
                {
                  label: "Electricity",
                  value: `${ELECTRICITY_LABELS[profile.electricityApproach]}${profile.electricityRules ? ` — ${profile.electricityRules}` : ""}`,
                },
                {
                  label: "Biogenic carbon",
                  value: `${BIOGENIC_LABELS[profile.biogenicTreatment]}${profile.biogenicRules ? ` — ${profile.biogenicRules}` : ""}`,
                },
                { label: "Removals", value: profile.removalsRules },
                {
                  label: "Offsets",
                  value: `${OFFSET_LABELS[profile.offsetTreatment]}${profile.offsetRules ? ` — ${profile.offsetRules}` : ""}`,
                },
                {
                  label: "Cut-off",
                  value: `${profile.cutOffThresholdPercent ? `${profile.cutOffThresholdPercent.toString()}% threshold. ` : ""}${profile.cutOffRules ?? ""}`,
                },
                {
                  label: "Factor hierarchy",
                  value:
                    profile.factorHierarchy.length > 0 ? (
                      <ol className="ml-4 list-decimal space-y-0.5">
                        {profile.factorHierarchy.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ol>
                    ) : null,
                },
                { label: "Data quality requirements", value: profile.dataQualityRequirements },
                {
                  label: "Minimum data-quality score",
                  value: profile.minimumDataQualityScore ? `${profile.minimumDataQualityScore.toString()} (1 best, 5 worst)` : null,
                },
                {
                  label: "Evidence for primary data",
                  value: profile.requireEvidenceForPrimary ? "Required" : "Not required",
                },
                {
                  label: "Standards referenced",
                  value:
                    profile.standardsReferenced.length > 0 ? (
                      <ul className="ml-4 list-disc space-y-0.5">
                        {profile.standardsReferenced.map((standard) => (
                          <li key={standard}>{standard}</li>
                        ))}
                      </ul>
                    ) : null,
                },
                { label: "Notes", value: profile.notes },
              ]}
            />
          </SectionCard>
        ))
      )}

      <Notice tone="info">
        Looking for the emission factor library itself? Factors are administered under{" "}
        <Link href="/factors" className="font-medium underline">
          Emission factors
        </Link>
        , where corporate and life-cycle factors are imported through the same versioned, append-only pipeline.
      </Notice>
    </div>
  );
}
