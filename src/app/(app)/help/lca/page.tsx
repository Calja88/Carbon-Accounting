import Link from "next/link";
import { LIFECYCLE_STAGE_ORDER, STAGE_DESCRIPTIONS, STAGE_LABELS } from "@/lib/lca/labels";
import { unitsByDimension } from "@/lib/lca/units";
import { ROLE_CAPABILITY_SUMMARY } from "@/lib/lca/permissions";
import { Badge } from "@/components/ui/badge";
import { DataTable, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";

export const dynamic = "force-static";

/**
 * Contextual guidance in this platform's own words. Standards text is not
 * reproduced here — these are working explanations of what the terms mean for
 * someone filling in the forms, with pointers to where each one is used.
 */
const GLOSSARY: { term: string; definition: string; where: string }[] = [
  {
    term: "Functional unit",
    definition:
      "The service the product delivers, stated precisely enough to compare against something else — for example, one tag providing identification over a five-year service life. Every result is expressed per functional unit, so an assessment without one produces numbers that cannot be compared with anything, including a later version of the same product.",
    where: "Goal and scope",
  },
  {
    term: "Declared unit",
    definition:
      "Used where the boundary stops before the product does its job, so there is no function to measure yet — typically cradle to gate. It states a quantity of product to a point in its life and makes no claim about the service delivered.",
    where: "Goal and scope",
  },
  {
    term: "Reference flow",
    definition:
      "How much product is needed to deliver one functional unit. Usually one, but not always: if some units fail final test, or the product is consumed in use, the reference flow is larger than one.",
    where: "Goal and scope",
  },
  {
    term: "Modelled output",
    definition:
      "How much product the quantities you have entered actually represent. A model built on one batch of 500 units contains 500 functional units, so a 1,000 kgCO2e model total becomes 2 kgCO2e per unit. This is the divisor the engine uses.",
    where: "Goal and scope",
  },
  {
    term: "System boundary",
    definition:
      "Which lifecycle stages are inside the assessment. Two footprints drawn on different boundaries are not comparable, however similar the products, which is why the boundary is stated on every report and export.",
    where: "Goal and scope",
  },
  {
    term: "Unit process",
    definition:
      "One step in the product's life that emissions can be attributed to. Processes can be nested as deeply as the model needs — a manufacturing stage containing moulding, which contains drying.",
    where: "Lifecycle model",
  },
  {
    term: "Allocation",
    definition:
      "When a process makes more than one saleable thing, only part of its burden belongs to the product being assessed. The split can be by mass, by another physical property, by economic value, or set manually with a stated rationale. Mass, physical and economic splits are derived from the recorded co-products, so anyone can check them.",
    where: "Lifecycle model",
  },
  {
    term: "Cascading allocation",
    definition:
      "A sub-process inside an already-allocated parent is allocated twice over, once at each level. The engine does this automatically and shows the chain, because it is correct and easy to get wrong by hand.",
    where: "Lifecycle model",
  },
  {
    term: "Activity data",
    definition:
      "The physical quantity behind an emission: kilograms of a material, kilowatt-hours of electricity, tonne-kilometres of freight. Multiplying it by an emission factor gives the figure.",
    where: "Inventory",
  },
  {
    term: "Emission factor",
    definition:
      "kgCO2e per unit of activity. What matters as much as the number is what it covers, where it applies, what year it represents and which GWP set it uses — all recorded alongside it, and all snapshotted onto every result so a figure still reads correctly years later.",
    where: "Inventory · Emission factors",
  },
  {
    term: "Factor boundary",
    definition:
      "What a factor actually includes. Applying a cradle-to-grave factor inside a cradle-to-gate model double-counts; treating a combustion-only factor as well-to-wheel leaves a gap. The platform records it and flags factors that do not state one.",
    where: "Inventory",
  },
  {
    term: "Manufacturing loss",
    definition:
      "Material that goes in but does not end up in the product. Entered as a percentage of the input: a 10% loss on 9 kg of output means 10 kg went in, not 11 kg — the loss is a share of the input, not of the output.",
    where: "Inventory",
  },
  {
    term: "Recycled content",
    definition:
      "The share of a material that comes from a recycled route. It is always disclosed, but it only changes the figure when a sourced recycled-route factor is also assigned — recycled content is never turned into an assumed discount.",
    where: "Inventory",
  },
  {
    term: "Tonne-kilometre",
    definition:
      "One tonne carried one kilometre. Freight factors are normally published per tonne-kilometre, so mass and distance are converted into it. Where a factor is per vehicle-kilometre instead, the consignment's share of the vehicle is applied to the distance and the platform says so on the result.",
    where: "Inventory · transport legs",
  },
  {
    term: "Primary, secondary and proxy data",
    definition:
      "Primary data is measured by us. Supplier-specific data is the supplier's own figure for the thing we actually bought. Secondary data comes from a published dataset for something like it. Proxy data stands in for something else entirely, and always needs an explanation.",
    where: "Inventory · Data quality",
  },
  {
    term: "Data quality scoring",
    definition:
      "Five dimensions — temporal, geographical, technological, completeness and reliability — each scored 1 (best) to 5 (worst). The assessment-level figure weights each line by its share of the footprint, so a weak score on a line that barely matters does not drag the assessment down, and a weak score on the dominant line is not averaged away.",
    where: "Data quality",
  },
  {
    term: "Uncertainty",
    definition:
      "How much a figure could move. Recorded line by line and combined in quadrature into an indicative range. That combination assumes the lines are independent, which they are not where they share a data source, so the range is reported with that caveat and with its coverage alongside.",
    where: "Data quality",
  },
  {
    term: "Sensitivity",
    definition:
      "What happens to the total if one line moves by a fixed amount while everything else stays still. Deterministic and reproducible; it makes no claim about how likely that move is.",
    where: "Data quality",
  },
  {
    term: "Biogenic carbon",
    definition:
      "Carbon that came out of the atmosphere into a plant and may return to it. Emissions, removals and carbon held in the product are tracked as separate classes. Whether any of them counts towards the headline figure is a methodology choice, stated on every report.",
    where: "Methodology · Results",
  },
  {
    term: "Stored carbon",
    definition:
      "Carbon held in the product itself. A memo disclosure — it is never subtracted from the reported footprint, because the product still caused the emissions that made it.",
    where: "Results",
  },
  {
    term: "Avoided burden",
    definition:
      "A credit for material recovered at end of life displacing virgin production elsewhere. It exists only under an avoided-burden or circular-footprint methodology, and is always carried as its own class rather than quietly shrinking gross emissions.",
    where: "Methodology · End of life",
  },
  {
    term: "Offsets",
    definition:
      "Purchased credits. They never reduce a product footprint in this platform. A product's emissions are what the product caused; an offset is a separate transaction, disclosed separately.",
    where: "Methodology · Results",
  },
  {
    term: "Cut-off",
    definition:
      "The threshold below which an input may be left out. Anything cut off belongs in the exclusions register with an estimate of what it would have contributed — an exclusion nobody can size is indistinguishable from an omission.",
    where: "Methodology · Exclusions",
  },
  {
    term: "Supplier PCF",
    definition:
      "A supplier's own product carbon footprint for something you buy. Usable in place of a generic factor when its declared unit, boundary, methodology and period are known — which is why the platform requires all of them.",
    where: "Suppliers",
  },
  {
    term: "Verification readiness",
    definition:
      "Whether an independent reviewer could form a view on this assessment today, area by area, with the reasoning shown. It is not a score, and it is not a conformity claim — only a verifier can give that.",
    where: "Review",
  },
];

export default function LcaHelpPage() {
  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Product carbon footprints"
        title="Guidance"
        description="What the terms on these pages mean in practice, and where each one is used. Written in plain language rather than reproduced from any standard."
      />

      <SectionCard title="How an assessment fits together" description="The order most assessments are built in.">
        <ol className="space-y-3">
          {[
            {
              step: "Product and version",
              detail:
                "An assessment attaches to a specific version of a product, so a design change gets its own footprint instead of overwriting the last one.",
              href: "/products",
            },
            {
              step: "Goal and scope",
              detail:
                "Why the assessment exists, what boundary it draws, what period the data covers, and the functional or declared unit every result is expressed per.",
            },
            {
              step: "Lifecycle model",
              detail: "The processes the product passes through, nested as needed, with allocation wherever a process makes more than one thing.",
            },
            {
              step: "Inventory",
              detail:
                "The activity data itself: materials, energy, freight legs, waste, use phase and end-of-life routes, each with a factor, a data type and quality scores. A bill of materials can be imported from a spreadsheet.",
            },
            {
              step: "Calculate",
              detail:
                "Produces a stored run. Every figure carries its own arithmetic and a snapshot of the factor behind it, so results stay readable even after the factor library moves on.",
            },
            {
              step: "Interpret",
              detail: "Contributions, hotspots, data quality, uncertainty and scenarios — where the footprint comes from and how much it could move.",
            },
            {
              step: "Review and issue",
              detail:
                "Validation and readiness, then a frozen version. An issued version never changes: a later correction is a new revision.",
            },
          ].map((item, index) => (
            <li key={item.step} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {item.href ? (
                    <Link href={item.href} className="hover:text-brand-700">
                      {item.step}
                    </Link>
                  ) : (
                    item.step
                  )}
                </div>
                <p className="mt-0.5 text-sm text-slate-600">{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Lifecycle stages" description="What each stage covers.">
        <DataTable headers={["Stage", "What it covers"]}>
          {LIFECYCLE_STAGE_ORDER.map((stage) => (
            <tr key={stage}>
              <Td className="font-medium text-slate-900">{STAGE_LABELS[stage]}</Td>
              <Td>{STAGE_DESCRIPTIONS[stage]}</Td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard title="Glossary" description="The terms the forms use, and what they mean here.">
        <dl className="divide-y divide-slate-100">
          {GLOSSARY.map((entry) => (
            <div key={entry.term} className="py-3">
              <dt className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-slate-900">{entry.term}</span>
                <Badge tone="neutral">{entry.where}</Badge>
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-600">{entry.definition}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      <SectionCard
        title="Units the platform recognises"
        description="Quantities are converted automatically between units of the same dimension. Units of different dimensions are never multiplied together — a factor per kWh cannot be applied to a quantity in kg, and the platform raises rather than guessing."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {unitsByDimension()
            .filter((group) => group.units.length > 0)
            .map((group) => (
              <div key={group.dimension}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.dimension.toLowerCase().replace(/_/g, " ")}
                </h3>
                <p className="mt-1 text-sm text-slate-700">{group.units.map((unit) => unit.symbol).join(", ")}</p>
              </div>
            ))}
        </div>
        <Notice tone="info">
          Currencies share a dimension but are never converted into one another: an exchange rate is a point-in-time
          market figure this platform holds no authoritative source for, and guessing one would silently change a
          spend-based result.
        </Notice>
      </SectionCard>

      <SectionCard title="Who can do what" description="Product assessment permissions follow the platform's existing roles.">
        <DataTable headers={["Role", "Can"]}>
          {ROLE_CAPABILITY_SUMMARY.map((entry) => (
            <tr key={entry.role}>
              <Td className="font-medium text-slate-900">{entry.role.replace(/_/g, " ").toLowerCase()}</Td>
              <Td>
                <ul className="ml-4 list-disc space-y-0.5">
                  {entry.can.map((capability) => (
                    <li key={capability}>{capability}</li>
                  ))}
                </ul>
              </Td>
            </tr>
          ))}
        </DataTable>
        <p className="mt-3 text-sm text-slate-600">
          An assessment also locks once it is issued for verification or verified: from that point it is read-only, and a
          change means creating a revision. That is what stops a figure someone has already seen from moving underneath
          them.
        </p>
      </SectionCard>

      <SectionCard title="What this platform does not claim" description="Worth being explicit about.">
        <ul className="ml-4 list-disc space-y-2 text-sm text-slate-700">
          <li>
            It does not certify anything. Naming a standard describes the approach an assessment followed; only an
            independent verifier can say whether it conforms.
          </li>
          <li>
            Verification readiness is an internal view of whether the work can be reviewed. It is not a score against any
            standard.
          </li>
          <li>
            The uncertainty range is an indicative combination of the line-level uncertainties recorded, not a
            statistical confidence interval. No Monte Carlo simulation is run.
          </li>
          <li>
            A greenhouse gas footprint says nothing about water, land use, toxicity or biodiversity. A low carbon
            footprint does not imply a low environmental impact overall.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
