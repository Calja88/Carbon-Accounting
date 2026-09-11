"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * UI14: without this, an uncaught exception anywhere under the signed-in app
 * shell (including every EMS route) fell through to Next's default error
 * overlay/blank page instead of a readable, accessible in-app message.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-red-600" />
            <CardTitle>Something went wrong</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              This page hit an unexpected error. Nothing you did caused this — try again, or go back to the dashboard.
              {error.digest && <span className="mt-1 block text-xs text-slate-400">Reference: {error.digest}</span>}
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={() => retry()}>
                Try again
              </Button>
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                Back to dashboard
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
