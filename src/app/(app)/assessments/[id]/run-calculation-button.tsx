"use client";

import { useFormStatus } from "react-dom";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runCalculationAction } from "../actions";

function SubmitButton({ stale }: { stale: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={stale ? "primary" : "secondary"} disabled={pending}>
      <Calculator className="h-4 w-4" />
      {pending ? "Calculating…" : stale ? "Run calculation" : "Recalculate"}
    </Button>
  );
}

export function RunCalculationButton({ assessmentId, stale }: { assessmentId: string; stale: boolean }) {
  return (
    <form action={runCalculationAction}>
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <SubmitButton stale={stale} />
    </form>
  );
}
