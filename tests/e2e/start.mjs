import { createE2EServer } from "./serve.mjs";

const server = createE2EServer({ log: (msg) => console.log(`[e2e] ${msg}`) });

await server.start();
console.log("[e2e] server up; keeping process alive for playwright webServer");

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Playwright kills this process when checks pass; keep alive until then.
setInterval(() => {}, 1 << 30);
