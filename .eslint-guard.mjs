#!/usr/bin/env node
/**
 * Lightweight source guards for Phase 0:
 *  1. only src/lib/env.ts may read process.env (allowlist below)
 *  2. .env files are never committed (no tracked .env, example only)
 * Exits non-zero on violation. Wired into `npm run guard` and CI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const violations = [];

// 1. process.env access allowlist (posix-style paths)
const ALLOWED_ENV_FILES = [
  "src/lib/env.ts",
  "src/lib/env-schema.ts",
  "src/lib/db.ts", // reads NODE_ENV for log config
  "src/lib/redis.ts", // reads REDIS_URL fallback
  "src/lib/logger.ts", // reads LOG_LEVEL for pino config
  "src/app/api/health/route.ts", // reads package version
  "tests/db.test.ts", // validates process.env shape via schema
  "tests/auth.test.ts", // CI env vars for DB-backed suites
  "tests/auth.integration.test.ts", // CI env vars for DB-backed suites
  "src/features/auth/actions.ts", // AUTH_RATE_LIMIT_PER_MIN tuning knob (server action)
  "tests/patients.integration.test.ts", // CI env vars for DB-backed suites
  "tests/appointments.integration.test.ts", // CI env vars for DB-backed suites
  "tests/clinical.integration.test.ts", // CI env vars for DB-backed suites
  "tests/lab.integration.test.ts", // CI env vars for DB-backed suites
];

function toPosix(p) {
  return p.split("\\").join("/");
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      const text = readFileSync(full, "utf8");
      const posix = toPosix(full);
      if (text.includes("process.env") && !ALLOWED_ENV_FILES.includes(posix)) {
        violations.push(`process.env access outside allowlist: ${relative(".", full)}`);
      }
      if (text.includes("server-only") && posix.startsWith("src/components")) {
        violations.push(`server-only import in client component: ${relative(".", full)}`);
      }
    }
  }
}

walk(join(".", "src"));
walk(join(".", "tests"));

// 2. tracked .env hygiene
try {
  const gitignore = readFileSync(".gitignore", "utf8");
  if (!/^\s*\.env\*?\s*$/m.test(gitignore) && !gitignore.includes(".env*")) {
    violations.push(".gitignore does not exclude .env files");
  }
} catch {
  violations.push(".gitignore missing");
}

// 2. .env.example must be tracked (proves the .gitignore negation works)
try {
  const tracked = execFileSync("git", ["ls-files", "--", ".env.example"], {
    encoding: "utf8",
  }).trim();
  if (!tracked) {
    violations.push(".env.example is not tracked by git — check the .gitignore negation");
  }
} catch {
  violations.push("could not run git ls-files to verify .env.example tracking");
}

if (violations.length) {
  console.error("GUARD FAILURES:\n" + violations.map((v) => `  - ${v}`).join("\n"));
  process.exit(1);
}
console.log("guards ok");
