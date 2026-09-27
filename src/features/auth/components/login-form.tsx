"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { loginAction } from "@/features/auth/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Staff sign in</CardTitle>
        <CardDescription>Use your ClinicCare account to continue.</CardDescription>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          startTransition(async () => {
            // Success performs a full-page redirect from the server (Auth.js
            // native flow, required for the session cookie to be set) — no
            // client-side navigation needed here.
            const result = await loginAction({
              email: String(form.get("email") ?? ""),
              password: String(form.get("password") ?? ""),
            });
            if (!result.ok) setError(result.error);
          });
        }}
      >
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <Link href="/forgot-password" className="text-xs text-muted-foreground hover:underline">
            Forgot your password?
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
