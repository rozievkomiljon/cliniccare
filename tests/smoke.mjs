#!/usr/bin/env node
/**
 * Local smoke check: boots `next dev` and probes the health endpoint.
 * Usage: npm run test:smoke  (requires only `npm install` — no DB needed)
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

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server never became ready");
}

try {
  const res = await waitForServer();
  const body = await res.json();
  console.log("GET /api/health ->", res.status, JSON.stringify(body));
  if (body.status !== "ok") throw new Error(`unexpected body: ${JSON.stringify(body)}`);

  const home = await fetch(`${BASE}/`);
  console.log("GET / ->", home.status);
  if (!home.ok) throw new Error(`home returned ${home.status}`);

  const login = await fetch(`${BASE}/login`);
  console.log("GET /login ->", login.status);
  if (!login.ok) throw new Error(`login returned ${login.status}`);

  const headers = home.headers;
  for (const key of ["x-frame-options", "x-content-type-options", "referrer-policy"]) {
    if (!headers.get(key)) throw new Error(`missing security header: ${key}`);
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
