"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      Print / export PDF
    </Button>
  );
}
