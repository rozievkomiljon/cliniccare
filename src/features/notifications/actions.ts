"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { markAllNotificationsRead } from "@/features/notifications/queries";
import { withAction } from "@/lib/actions";
import { requirePermission } from "@/lib/rbac/guard";

export const markNotificationsReadAction = withAction(
  z.object({}).optional(),
  async () => {
    const session = await requirePermission("appointments:own");
    const count = await markAllNotificationsRead(session.user.id);
    revalidatePath("/notifications");
    revalidatePath("/portal");
    return { marked: count };
  },
);
