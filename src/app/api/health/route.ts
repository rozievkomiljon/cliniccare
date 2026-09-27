import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Health probe: reports app version plus database reachability without
 * failing when the DB is briefly down (upstream orchestrators decide).
 * Never leaks connection strings or error internals.
 */
export async function GET() {
  const version = process.env.npm_package_version ?? "0.0.0";
  let database: "up" | "down" = "down";

  try {
    await db.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  const h = await headers();
  return NextResponse.json(
    { status: "ok", version, database },
    { headers: { "x-request-id": h.get("x-request-id") ?? "none" } },
  );
}
