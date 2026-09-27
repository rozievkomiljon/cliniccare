/**
 * E2E server orchestrator: prepares a Postgres database, applies migrations
 * and the seed, then serves the Next.js app. Exposed as a spawnable standalone
 * script so both Playwright webServer and CI reuse the exact same startup.
 *
 * Two database modes:
 *  - E2E_DATABASE_URL set → use that external database (local dev where the
 *    shell is elevated and postgres refuses admin tokens; a registered
 *    Windows service provides the cluster — see README).
 *  - otherwise → boot an ephemeral embedded-postgres cluster (CI default).
 */
import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const PG_PORT = 54329;
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3111);

export function createE2EServer({ log = (msg) => console.log(`[e2e] ${msg}`) } = {}) {
  const state = { pg: null, app: null, appLogs: "" };

  async function start() {
    const databaseUrl = process.env.E2E_DATABASE_URL ?? (await startEmbedded(log));
    log(`database: ${databaseUrl}`);

    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-0123456789abcdef0123456789abcdef",
      APP_URL: `http://localhost:${APP_PORT}`,
      MAIL_HOST: "localhost",
      MAIL_PORT: "1025",
      // E2E exercises the journeys, not timing windows (limiter logic has its
      // own unit tests); multiple logins from one IP happen in one suite run.
      AUTH_RATE_LIMIT_PER_MIN: "100",
      AUTH_RATE_LIMIT_PER_ACCOUNT_HOUR: "200",
      LOG_LEVEL: "warn",
      NEXT_TELEMETRY_DISABLED: "1",
    };

    log("applying migrations + seed…");
    execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
    execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
    log("database ready");

    // Production server: deterministic hydration (no HMR), same as real deploys.
    log("building production bundle…");
    execSync("npx next build", { env, stdio: "pipe" });
    log(`starting next start on :${APP_PORT}…`);
    state.app = spawn(
      process.execPath,
      [join("node_modules", "next", "dist", "bin", "next"), "start", "--port", String(APP_PORT)],
      { stdio: ["ignore", "pipe", "pipe"], env },
    );
    state.app.stdout.on("data", (c) => (state.appLogs += c));
    state.app.stderr.on("data", (c) => (state.appLogs += c));

    await waitForApp();
    log("app ready");
  }

  async function waitForApp() {
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`);
        if (res.ok) return;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`app never became ready:\n${state.appLogs}`);
  }

  async function startEmbedded(log) {
    const EmbeddedPostgres = require("embedded-postgres").default ?? require("embedded-postgres");
    rmSync(".pgdata-e2e", { recursive: true, force: true });
    process.env.LC_ALL = "C";
    process.env.LANG = "C";
    log("starting embedded postgres…");
    const pg = new EmbeddedPostgres({
      databaseDir: ".pgdata-e2e",
      user: "cliniccare",
      password: "cliniccare",
      port: PG_PORT,
      persistent: false,
      initdbFlags: ["--locale=C", "--encoding=UTF8"],
      onLog: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("cliniccare");
    state.pg = pg;
    return `postgresql://cliniccare:cliniccare@127.0.0.1:${PG_PORT}/cliniccare`;
  }

  async function stop() {
    try {
      if (state.app) state.app.kill("SIGKILL");
    } catch {}
    try {
      if (state.pg) await state.pg.stop();
    } catch {}
    try {
      rmSync(".pgdata-e2e", { recursive: true, force: true });
    } catch {}
  }

  return { start, stop, state, APP_PORT };
}
