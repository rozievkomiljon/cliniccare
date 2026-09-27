/**
 * Standard Server Action factory: zod-validates input at the boundary and
 * converts typed errors into an ActionResult envelope. Business permission
 * checks live in the service layer via requirePermission; this wrapper never
 * leaks stack traces or internals to the client.
 *
 * Usage: export const doThing = withAction(Schema, async (input) => {...});
 */
import "server-only";

import { z } from "zod";

import { AppError, type ActionResult } from "@/lib/errors";

export function withAction<S extends z.ZodType, T>(
  schema: S,
  fn: (input: z.output<S>) => Promise<T>,
): (rawInput: unknown) => Promise<ActionResult<T>> {
  return async (rawInput: unknown): Promise<ActionResult<T>> => {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first?.path?.[0];
      const message = first?.message ?? "Invalid input.";
      return {
        ok: false as const,
        error: field ? `${String(field)}: ${message}` : message,
        code: "VALIDATION",
      };
    }
    try {
      return { ok: true as const, data: await fn(parsed.data) };
    } catch (err) {
      if (err instanceof AppError) {
        return { ok: false as const, error: err.message, code: err.code };
      }
      console.error("[action] unexpected error", err);
      return {
        ok: false as const,
        error: "Something went wrong. Please try again.",
        code: "INTERNAL",
      };
    }
  };
}
