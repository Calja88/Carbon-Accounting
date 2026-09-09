"use client";

/**
 * Form-control replacement for the significance method's criteria/rule-set
 * JSON textareas. Users edit plain rows here; `serializeCriteria`/
 * `serializeRules` turn the row state into exactly the shape
 * `significanceMethodInputSchema` (src/lib/ems/aspects/schemas.ts) already
 * expects, so the server action's JSON.parse + Zod validation contract is
 * unchanged — only how the JSON gets produced moves off the user.
 */

import { useId } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type ScaleKind = "NUMERIC" | "SCORED_OPTIONS";
export type ScoredOptionRow = { rowId: string; value: string; label: string; score: string };
export type CriterionRow = {
  rowId: string;
  key: string;
  label: string;
  scaleKind: ScaleKind;
  min: string;
  max: string;
  options: ScoredOptionRow[];
  weight: string;
  required: boolean;
};
export type RuleOperator = "GT" | "GTE" | "LT" | "LTE" | "EQ";
export type RuleRow = { rowId: string; criterionKey: string; operator: RuleOperator; compareTo: string };

let rowCounter = 0;
function nextRowId(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

export function emptyCriterionRow(): CriterionRow {
  return { rowId: nextRowId(), key: "", label: "", scaleKind: "NUMERIC", min: "1", max: "5", options: [], weight: "", required: true };
}

export function emptyRuleRow(criterionKey: string): RuleRow {
  return { rowId: nextRowId(), criterionKey, operator: "GTE", compareTo: "" };
}

/** Human-readable summary of a stored `scaleConfig`, replacing raw `JSON.stringify` in read views. */
export function describeScale(scaleConfig: unknown): string {
  if (!scaleConfig || typeof scaleConfig !== "object") return "No scale configured";
  const config = scaleConfig as { kind?: string; min?: string; max?: string; options?: Array<{ label?: string; score?: string }> };
  if (config.kind === "NUMERIC") return `Numeric, ${config.min ?? "?"}–${config.max ?? "?"}`;
  if (config.kind === "SCORED_OPTIONS" && Array.isArray(config.options)) {
    return `Options: ${config.options.map((option) => `${option.label ?? "?"} (${option.score ?? "?"})`).join(", ")}`;
  }
  return "No scale configured";
}

export function criterionRowsFromMethod(
  criteria: Array<{ key: string; label: string; scaleConfig: unknown; weight: string | null; required: boolean }>,
): CriterionRow[] {
  // `scaleConfig`/`weight`/rule fields arrive as untyped JSON from the
  // database — a handful of pre-existing fixtures store numbers where the
  // schema expects decimal strings, so every field is coerced through
  // `asText` rather than trusted at its declared type.
  return criteria.map((criterion) => {
    const scale = criterion.scaleConfig as
      | { kind?: string; min?: unknown; max?: unknown; options?: Array<{ value: unknown; label: unknown; score: unknown }> }
      | null;
    if (scale?.kind === "SCORED_OPTIONS") {
      return {
        rowId: nextRowId(),
        key: criterion.key,
        label: criterion.label,
        scaleKind: "SCORED_OPTIONS",
        min: "1",
        max: "5",
        options: (scale.options ?? []).map((option) => ({
          rowId: nextRowId(),
          value: asText(option.value),
          label: asText(option.label),
          score: asText(option.score),
        })),
        weight: criterion.weight ?? "",
        required: criterion.required,
      };
    }
    return {
      rowId: nextRowId(),
      key: criterion.key,
      label: criterion.label,
      scaleKind: "NUMERIC",
      min: scale?.min !== undefined ? asText(scale.min) : "1",
      max: scale?.max !== undefined ? asText(scale.max) : "5",
      options: [],
      weight: criterion.weight ?? "",
      required: criterion.required,
    };
  });
}

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function ruleRowsFromFormulaConfig(formulaConfig: unknown): RuleRow[] {
  if (!formulaConfig || typeof formulaConfig !== "object" || Array.isArray(formulaConfig)) return [];
  const rules = (formulaConfig as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return [];
  return rules.map((rule) => {
    const row = rule as { criterionKey?: unknown; operator?: unknown; compareTo?: unknown };
    return {
      rowId: nextRowId(),
      criterionKey: asText(row.criterionKey),
      operator: (["GT", "GTE", "LT", "LTE", "EQ"] as const).includes(row.operator as RuleOperator) ? (row.operator as RuleOperator) : "GTE",
      compareTo: asText(row.compareTo),
    };
  });
}

/** Produces the exact object shape `significanceCriterionInputSchema` validates. */
export function serializeCriteria(rows: CriterionRow[]) {
  return rows.map((row, index) => ({
    key: row.key.trim(),
    label: row.label.trim(),
    scaleConfig:
      row.scaleKind === "NUMERIC"
        ? { kind: "NUMERIC" as const, min: row.min.trim(), max: row.max.trim() }
        : {
            kind: "SCORED_OPTIONS" as const,
            options: row.options.map((option) => ({ value: option.value.trim(), label: option.label.trim(), score: option.score.trim() })),
          },
    ...(row.weight.trim() ? { weight: row.weight.trim() } : {}),
    required: row.required,
    sortOrder: index,
  }));
}

/** Produces the exact object shape the `RULE_SET` branch of `significanceFormulaConfigSchema` validates. */
export function serializeRules(rows: RuleRow[]) {
  return rows.map((row) => ({ criterionKey: row.criterionKey, operator: row.operator, compareTo: row.compareTo.trim() }));
}

function ScoredOptionsEditor({
  idPrefix,
  options,
  onChange,
}: {
  idPrefix: string;
  options: ScoredOptionRow[];
  onChange: (options: ScoredOptionRow[]) => void;
}) {
  function updateOption(rowId: string, patch: Partial<ScoredOptionRow>) {
    onChange(options.map((option) => (option.rowId === rowId ? { ...option, ...patch } : option)));
  }
  function removeOption(rowId: string) {
    onChange(options.filter((option) => option.rowId !== rowId));
  }
  function addOption() {
    onChange([...options, { rowId: nextRowId(), value: "", label: "", score: "" }]);
  }
  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">Options</p>
        <Button type="button" size="sm" variant="ghost" onClick={addOption}>
          <Plus className="h-3.5 w-3.5" /> Add option
        </Button>
      </div>
      {options.length === 0 && <p className="text-xs text-slate-500">Add at least one option.</p>}
      {options.map((option) => (
        <div key={option.rowId} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_6rem_auto]">
          <div>
            <Label htmlFor={`${idPrefix}-value-${option.rowId}`}>Value</Label>
            <Input
              id={`${idPrefix}-value-${option.rowId}`}
              value={option.value}
              onChange={(event) => updateOption(option.rowId, { value: event.target.value })}
              placeholder="low"
              required
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-label-${option.rowId}`}>Label</Label>
            <Input
              id={`${idPrefix}-label-${option.rowId}`}
              value={option.label}
              onChange={(event) => updateOption(option.rowId, { label: event.target.value })}
              placeholder="Low"
              required
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-score-${option.rowId}`}>Score</Label>
            <Input
              id={`${idPrefix}-score-${option.rowId}`}
              value={option.score}
              onChange={(event) => updateOption(option.rowId, { score: event.target.value })}
              inputMode="decimal"
              required
            />
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => removeOption(option.rowId)} aria-label="Remove option">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function CriteriaBuilder({ criteria, onChange }: { criteria: CriterionRow[]; onChange: (rows: CriterionRow[]) => void }) {
  const uid = useId();

  function updateRow(rowId: string, patch: Partial<CriterionRow>) {
    onChange(criteria.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }
  function removeRow(rowId: string) {
    onChange(criteria.filter((row) => row.rowId !== rowId));
  }
  function moveRow(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= criteria.length) return;
    const next = [...criteria];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Criteria</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...criteria, emptyCriterionRow()])}>
          <Plus className="h-3.5 w-3.5" /> Add criterion
        </Button>
      </div>
      {criteria.length === 0 && <p className="text-sm text-slate-500">Add at least one criterion.</p>}
      {criteria.map((row, index) => (
        <div key={row.rowId} className="space-y-3 rounded-lg border border-slate-200 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${uid}-key-${row.rowId}`}>Key</Label>
              <Input
                id={`${uid}-key-${row.rowId}`}
                value={row.key}
                onChange={(event) => updateRow(row.rowId, { key: event.target.value })}
                placeholder="severity"
                required
              />
            </div>
            <div>
              <Label htmlFor={`${uid}-label-${row.rowId}`}>Label</Label>
              <Input
                id={`${uid}-label-${row.rowId}`}
                value={row.label}
                onChange={(event) => updateRow(row.rowId, { label: event.target.value })}
                placeholder="Severity"
                required
              />
            </div>
            <div>
              <Label htmlFor={`${uid}-scale-${row.rowId}`}>Scale type</Label>
              <Select
                id={`${uid}-scale-${row.rowId}`}
                value={row.scaleKind}
                onChange={(event) => updateRow(row.rowId, { scaleKind: event.target.value as ScaleKind })}
              >
                <option value="NUMERIC">Numeric range</option>
                <option value="SCORED_OPTIONS">Scored options</option>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${uid}-weight-${row.rowId}`}>Weight (optional)</Label>
              <Input
                id={`${uid}-weight-${row.rowId}`}
                value={row.weight}
                onChange={(event) => updateRow(row.rowId, { weight: event.target.value })}
                placeholder="1"
                inputMode="decimal"
              />
            </div>
          </div>

          {row.scaleKind === "NUMERIC" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${uid}-min-${row.rowId}`}>Minimum</Label>
                <Input
                  id={`${uid}-min-${row.rowId}`}
                  value={row.min}
                  onChange={(event) => updateRow(row.rowId, { min: event.target.value })}
                  inputMode="decimal"
                  required
                />
              </div>
              <div>
                <Label htmlFor={`${uid}-max-${row.rowId}`}>Maximum</Label>
                <Input
                  id={`${uid}-max-${row.rowId}`}
                  value={row.max}
                  onChange={(event) => updateRow(row.rowId, { max: event.target.value })}
                  inputMode="decimal"
                  required
                />
              </div>
            </div>
          ) : (
            <ScoredOptionsEditor idPrefix={`${uid}-${row.rowId}`} options={row.options} onChange={(options) => updateRow(row.rowId, { options })} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={row.required}
                onChange={(event) => updateRow(row.rowId, { required: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Required
            </label>
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => moveRow(index, -1)} disabled={index === 0} aria-label="Move criterion up">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => moveRow(index, 1)}
                disabled={index === criteria.length - 1}
                aria-label="Move criterion down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => removeRow(row.rowId)} aria-label="Remove criterion">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RuleBuilder({
  rules,
  criterionKeys,
  onChange,
}: {
  rules: RuleRow[];
  criterionKeys: string[];
  onChange: (rows: RuleRow[]) => void;
}) {
  const uid = useId();

  function updateRow(rowId: string, patch: Partial<RuleRow>) {
    onChange(rules.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }
  function removeRow(rowId: string) {
    onChange(rules.filter((row) => row.rowId !== rowId));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Rules</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange([...rules, emptyRuleRow(criterionKeys[0] ?? "")])}
          disabled={criterionKeys.length === 0}
        >
          <Plus className="h-3.5 w-3.5" /> Add rule
        </Button>
      </div>
      {rules.length === 0 && (
        <p className="text-sm text-slate-500">
          Add at least one rule. Under the rule-set formula, each matching rule contributes 1 to the score.
        </p>
      )}
      {rules.map((row) => (
        <div key={row.rowId} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_8rem_1fr_auto]">
          <div>
            <Label htmlFor={`${uid}-criterion-${row.rowId}`}>Criterion</Label>
            <Select
              id={`${uid}-criterion-${row.rowId}`}
              value={row.criterionKey}
              onChange={(event) => updateRow(row.rowId, { criterionKey: event.target.value })}
            >
              <option value="" disabled>
                Choose…
              </option>
              {criterionKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${uid}-operator-${row.rowId}`}>Operator</Label>
            <Select
              id={`${uid}-operator-${row.rowId}`}
              value={row.operator}
              onChange={(event) => updateRow(row.rowId, { operator: event.target.value as RuleOperator })}
            >
              <option value="GT">&gt;</option>
              <option value="GTE">&ge;</option>
              <option value="LT">&lt;</option>
              <option value="LTE">&le;</option>
              <option value="EQ">=</option>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${uid}-compareTo-${row.rowId}`}>Compare to</Label>
            <Input
              id={`${uid}-compareTo-${row.rowId}`}
              value={row.compareTo}
              onChange={(event) => updateRow(row.rowId, { compareTo: event.target.value })}
              inputMode="decimal"
              required
            />
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => removeRow(row.rowId)} aria-label="Remove rule">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
