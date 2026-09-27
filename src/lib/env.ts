/**
 * Validated environment access. This is the ONLY module allowed to read
 * process.env; everything else imports `env`. Server-only import enforced —
 * a client bundle importing this file fails the build.
 */
import "server-only";

import { parseEnv } from "@/lib/env-schema";

export const env = parseEnv(process.env);
export type { Env } from "@/lib/env-schema";
