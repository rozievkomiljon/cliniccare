import Link from "next/link";

import { getSession } from "@/lib/rbac/guard";

export const metadata = { title: "Access denied" };

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; permission?: string }>;
}) {
  const { code, permission } = await searchParams;
  const session = await getSession();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl dark:bg-red-950">
          🚫
        </div>
        <h1 className="mt-4 text-xl font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {session
            ? `Your role (${session.activeRole.replaceAll("_", " ").toLowerCase()}) is not permitted to perform this action.`
            : "Your account is not permitted to perform this action."}
        </p>
        {permission ? (
          <p className="mt-3 inline-block rounded-md bg-zinc-100 px-2.5 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            missing permission: {permission}
            {code ? ` · ${code}` : ""}
          </p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Go to dashboard
          </Link>
          <Link
            href="/"
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
