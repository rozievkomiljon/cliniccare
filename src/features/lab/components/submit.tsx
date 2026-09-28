"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";

export const labelCls = "block text-xs text-muted-foreground";
export const inputCls = "mt-1 w-full";

type ActionResult = { ok: boolean; error?: string };

/**
 * Shared submit plumbing: surface the server error, refresh the server tree.
 * Every laboratory action returns an ActionResult envelope, so the UI never
 * handles a thrown error.
 */
export function useSubmit(onDone?: () => void) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>, okMessage?: string) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result = await fn();
      if (result.ok) {
        if (okMessage) setNotice(okMessage);
        onDone?.();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });

  return { error, notice, pending, run, setError };
}

export function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? <p className="text-sm text-teal-700 dark:text-teal-400">{notice}</p> : null}
    </>
  );
}
