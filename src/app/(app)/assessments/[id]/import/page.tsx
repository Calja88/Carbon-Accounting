import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { INVENTORY_TEMPLATE_GUIDE } from "@/lib/lca/import/inventory-import";
import { checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";
import { InventoryImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assessment, actor] = await Promise.all([
    prisma.lcaAssessment.findUnique({
      where: { id },
      include: { processes: { orderBy: [{ sortOrder: "asc" }] } },
    }),
    getLcaActor(),
  ]);
  if (!assessment) notFound();

  const permission = checkCanEditAssessment(actor, assessment.status);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Import inventory"
        description="Load a bill of materials or an activity-data list from a spreadsheet. Every row is checked and shown back to you before anything is written."
        actions={
          <a href="/api/lca/inventory-template.csv">
            <Button size="sm" variant="secondary">
              <Download className="h-4 w-4" />
              Download the template
            </Button>
          </a>
        }
      />

      {!permission.ok ? (
        <Notice tone="info">{permission.reason}</Notice>
      ) : assessment.processes.length === 0 ? (
        <Notice tone="warning" title="Add processes first">
          Every imported line has to land in a process. Create the lifecycle model before importing.
        </Notice>
      ) : (
        <SectionCard
          title="Upload"
          description="Two steps: check the file, then confirm the import. Rows that cannot be used are reported individually rather than dropped."
        >
          <InventoryImportForm assessmentId={id} />
        </SectionCard>
      )}

      <SectionCard
        title="Template columns"
        description="Only name, quantity and unit are required, plus either a process name that already exists or a lifecycle stage to place the row in."
      >
        <DataTable headers={["Column", "Required", "What it does"]}>
          {INVENTORY_TEMPLATE_GUIDE.map((column) => (
            <tr key={column.column}>
              <Td className="font-mono text-xs">{column.column}</Td>
              <Td>{column.required ? <Badge tone="warning">Required</Badge> : <span className="text-xs text-slate-400">Optional</span>}</Td>
              <Td className="text-sm">{column.guidance}</Td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard title="Processes available in this assessment" description="Use one of these names in the process column, or give a stage instead.">
        <ul className="flex flex-wrap gap-2">
          {assessment.processes.map((process) => (
            <li key={process.id}>
              <Badge tone="neutral">
                {process.name} · {process.stage.replace(/_/g, " ").toLowerCase()}
              </Badge>
            </li>
          ))}
        </ul>
      </SectionCard>

      <Notice tone="info" title="How factor matching works">
        A row&apos;s factor is assigned only when exactly one factor in the library matches the category, subtype, region
        and a unit compatible with the row&apos;s own. If several match, none is chosen — the importer will not pick a
        factor on your behalf, and the row imports awaiting one. A manually entered factor always needs a source.
      </Notice>
    </div>
  );
}
