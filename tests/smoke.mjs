#!/usr/bin/env node
/**
 * Local smoke check: boots `next dev` and probes public pages, auth redirect
 * behavior, and the health endpoint. Usage: npm run test:smoke
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const PORT = process.env.SMOKE_PORT ?? 3123;
const BASE = `http://127.0.0.1:${PORT}`;
// Invoke Next's CLI through the current node binary — no shell, no .cmd wrappers.
const child = spawn(
  process.execPath,
  [join("node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(PORT)],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } },
);

let output = "";
child.stdout.on("data", (c) => (output += c));
child.stderr.on("data", (c) => (output += c));

const timeout = setTimeout(() => {
  console.error(`SMOKE FAIL: server did not become ready in 90s.\n--- output ---\n${output}`);
  child.kill("SIGKILL");
  process.exit(1);
}, 90_000);

async function waitFor(path) {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      if (res.status < 502) return res;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server never served ${path}`);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

try {
  const health = await waitFor("/api/health");
  const body = await health.json();
  console.log("GET /api/health ->", health.status, JSON.stringify(body));
  assert(body.status === "ok", "health must report ok");

  for (const path of ["/", "/login", "/forgot-password", "/reset-password", "/verify-email"]) {
    const res = await waitFor(path);
    console.log(`GET ${path} ->`, res.status);
    assert(res.status === 200, `${path} must be public (got ${res.status})`);
  }

  const dash = await waitFor("/dashboard");
  console.log("GET /dashboard (anon) ->", dash.status, "->", dash.headers.get("location"));
  assert(dash.status >= 300 && dash.status < 400, "anonymous /dashboard must redirect");

  const staff = await waitFor("/settings/staff");
  console.log("GET /settings/staff (anon) ->", staff.status, "->", staff.headers.get("location"));
  assert(staff.status >= 300 && staff.status < 400, "anonymous staff page must redirect");

  const headers = (await waitFor("/")).headers;
  for (const key of ["x-frame-options", "x-content-type-options", "referrer-policy"]) {
    assert(headers.get(key), `missing security header: ${key}`);
  }
  console.log("security headers present ✓");
  clearTimeout(timeout);
  console.log("SMOKE PASS");
} catch (err) {
  console.error(`SMOKE FAIL: ${err.message}\n--- output ---\n${output}`);
  child.kill("SIGKILL");
  process.exit(1);
} finally {
  child.kill("SIGKILL");
}
