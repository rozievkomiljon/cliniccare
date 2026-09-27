"use client";

/**
 * Root error boundary. Unexpected server errors render this instead of the
 * default crash screen. AppError names survive the server-to-client boundary,
 * so typed rejection messages are safe to display; anything else collapses
 * to a generic message.
 */
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const name = (error as { name?: string }).name ?? "";
  const isAppError = name === "AppError" || name === "ForbiddenError" || name === "NotFoundError";
  const displayMessage = isAppError
    ? ((error as { message?: string }).message ?? "Something went wrong.")
    : "Something went wrong. Please try again.";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl dark:bg-amber-950">
          ⚠️
        </div>
        <h1 className="mt-4 text-xl font-semibold">
          {name === "NotFoundError" ? "Not found" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{displayMessage}</p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-zinc-500">digest: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <a
            href="/dashboard"
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
