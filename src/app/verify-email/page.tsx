"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useTransition } from "react";

import { verifyEmailAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const missingToken = token.length === 0;

  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (missingToken) return;
    let cancelled = false;
    startTransition(async () => {
      const result = await verifyEmailAction({ token });
      if (cancelled) return;
      if (result.ok) setVerified(true);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [token, missingToken]);

  if (missingToken) {
    return (
      <>
        <CardTitle>Verification problem</CardTitle>
        <CardDescription>This verification link is missing its token.</CardDescription>
      </>
    );
  }

  if (pending) {
    return (
      <>
        <CardTitle>Verifying…</CardTitle>
        <CardDescription>Checking your verification link.</CardDescription>
      </>
    );
  }

  if (verified) {
    return (
      <>
        <CardTitle>Email verified</CardTitle>
        <CardDescription>Your address is confirmed. Welcome aboard.</CardDescription>
        <CardContent className="mt-4">
          <Button asChild className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardTitle>Verification problem</CardTitle>
      <CardDescription>{error ?? "Invalid link."}</CardDescription>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Suspense fallback={<CardDescription>Verifying…</CardDescription>}>
            <VerifyEmailInner />
          </Suspense>
        </CardHeader>
      </Card>
    </main>
  );
}
