"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, { error: null });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span aria-hidden="true" className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-teal-800 text-2xl font-semibold text-white">C</span>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Carbon Ledger</h1>
          <p className="mt-2 text-sm text-slate-500">Carbon performance. Connected environmental management.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required autoComplete="current-password" className="mt-1" />
              </div>
              {state.error && <p className="text-sm text-red-600">{state.error}</p>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-400">
          Use your organisation account to continue.
        </p>
      </div>
    </div>
  );
}
