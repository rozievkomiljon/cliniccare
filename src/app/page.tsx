export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2">
        <span className="text-4xl">🩺</span>
        <h1 className="text-3xl font-bold tracking-tight">ClinicCare</h1>
        <p className="max-w-md text-center text-zinc-600 dark:text-zinc-400">
          Clinic management system — Phase 0 bootstrap. Authentication and the
          role-aware app shell arrive in Phase&nbsp;1.
        </p>
      </div>
      <a
        href="/login"
        className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800"
      >
        Staff sign in
      </a>
    </main>
  );
}
