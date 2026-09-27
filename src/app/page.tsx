import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/rbac/guard";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2">
        <span className="text-4xl">🩺</span>
        <h1 className="text-3xl font-bold tracking-tight">ClinicCare</h1>
        <p className="max-w-md text-center text-zinc-600 dark:text-zinc-400">
          Clinic management system. Staff sign in with their clinic account;
          patients can register and manage their own appointments.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800"
        >
          Sign in
        </Link>
        <Link
          href="/forgot-password"
          className="rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Forgot password
        </Link>
      </div>
    </main>
  );
}
