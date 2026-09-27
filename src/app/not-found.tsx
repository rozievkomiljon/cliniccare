import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-2xl dark:bg-zinc-800">
          🔎
        </div>
        <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          The page you are looking for does not exist or has moved.
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
