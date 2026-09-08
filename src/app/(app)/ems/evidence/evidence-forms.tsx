"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function EvidenceSearchForm({ initialQuery }: { initialQuery: string }) {
  return (
    <form action="/ems/evidence" method="get" className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="q">Search by filename</Label>
        <Input id="q" name="q" defaultValue={initialQuery} className="mt-1" placeholder="e.g. policy.pdf" />
      </div>
      <Button type="submit" size="sm" variant="secondary">
        Search
      </Button>
    </form>
  );
}
