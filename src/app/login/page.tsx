import Link from "next/link";

import { LoginForm } from "@/features/auth/components/login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <span className="text-3xl">🩺</span>
        <LoginForm />
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="hover:underline">
            ← Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
