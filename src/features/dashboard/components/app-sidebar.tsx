"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { logoutAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";

export type NavItem = { href: string; label: string; enabled: boolean };
export type NavGroup = { label: string; items: NavItem[] };

export function AppSidebar({
  items,
  clinicName,
  role,
}: {
  items: NavGroup[];
  clinicName: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-white dark:bg-zinc-900">
      <div className="border-b px-5 py-4">
        <div className="text-sm font-semibold tracking-tight">🩺 ClinicCare</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{clinicName}</div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto p-4">
        {items.map((group) => (
          <div key={group.label}>
            <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "block rounded-md px-2.5 py-1.5 text-sm " +
                    (pathname === item.href
                      ? "bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")
                  }
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t p-4">
        <div className="mb-2 rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          Signed in as <span className="font-medium">{role.replaceAll("_", " ").toLowerCase()}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await logoutAction();
              router.replace("/login");
              router.refresh();
            })
          }
        >
          {pending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </aside>
  );
}
