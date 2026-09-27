"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { markNotificationsReadAction } from "@/features/notifications/actions";
import { Button } from "@/components/ui/button";

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markNotificationsReadAction({});
          if (result.ok) router.refresh();
        })
      }
    >
      {pending ? "Marking…" : "Mark all read"}
    </Button>
  );
}
