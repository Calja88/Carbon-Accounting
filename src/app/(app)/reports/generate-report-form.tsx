"use client";

import { useActionState } from "react";
import { generateReportAction, GenerateReportState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: GenerateReportState = { error: null };

export function GenerateReportForm({ defaultStart, defaultEnd }: { defaultStart: string; defaultEnd: string }) {
  const [state, formAction, pending] = useActionState(generateReportAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-4">
      <div>
        <Label htmlFor="periodStartMonth">From</Label>
        <Input id="periodStartMonth" name="periodStartMonth" type="month" defaultValue={defaultStart} required className="mt-1" />
      </div>
      <div>
        <Label htmlFor="periodEndMonth">To</Label>
        <Input id="periodEndMonth" name="periodEndMonth" type="month" defaultValue={defaultEnd} required className="mt-1" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Generating…" : "Generate report"}
      </Button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
