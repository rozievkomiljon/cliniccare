/**
 * Page-level permission guard for Server Components. Mirrors requirePermission
 * but converts typed rejections into navigation: unauthenticated users go to
 * /login (preserving the deep link), unauthorized users to the designed
 * /forbidden page carrying the permission code. Actions keep the throwing
 * requirePermission; withAction turns those into ActionResult envelopes.
 */
import "server-only";

import { redirect } from "next/navigation";

import { ForbiddenError } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AppSession } from "@/lib/rbac/guard";
import type { Permission } from "@/lib/rbac/permissions";

export async function requirePagePermission(
  permission: Permission,
  options: { clinicId?: string } = {},
): Promise<AppSession> {
  try {
    return await requirePermission(permission, options);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/forbidden?code=${encodeURIComponent(err.code)}&permission=${encodeURIComponent(permission)}`);
    }
    throw err;
  }
}

/** Page guard for a surface any one of several permissions may open. */
export async function requirePageAnyPermission(
  permissions: readonly Permission[],
  options: { clinicId?: string } = {},
): Promise<AppSession> {
  try {
    return await requireAnyPermission(permissions, options);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(
        `/forbidden?code=${encodeURIComponent(err.code)}&permission=${encodeURIComponent(permissions.join(" | "))}`,
      );
    }
    throw err;
  }
}
