import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { envSchema, parseEnv } from "@/lib/env-schema";

const BASE_ENV = {
  DATABASE_URL: "postgresql://cliniccare:cliniccare@localhost:5432/cliniccare",
  REDIS_URL: "redis://localhost:6379",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  APP_URL: "http://localhost:3000",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef01234567",
};

describe("env schema", () => {
  it("accepts a valid environment", () => {
    const parsed = parseEnv(BASE_ENV);
    expect(parsed.DATABASE_URL).toBe(BASE_ENV.DATABASE_URL);
    expect(parsed.LOG_LEVEL).toBe("info");
  });

  it("applies defaults for optional variables", () => {
    const parsed = parseEnv({
      DATABASE_URL: "postgresql://u:p@h:5432/d",
      AUTH_SECRET: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(parsed.REDIS_URL).toBe("redis://localhost:6379");
    expect(parsed.APP_URL).toBe("http://localhost:3000");
    expect(parsed.NODE_ENV).toBe("development");
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, DATABASE_URL: "mysql://u:p@h:3306/d" }),
    ).toThrow(/PostgreSQL connection string/);
  });

  it("rejects a missing DATABASE_URL", () => {
    const withoutDb = { ...BASE_ENV, DATABASE_URL: undefined };
    expect(() => parseEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => parseEnv({ ...BASE_ENV, LOG_LEVEL: "verbose" })).toThrow();
  });

  it("rejects a malformed APP_URL", () => {
    expect(() => parseEnv({ ...BASE_ENV, APP_URL: "not a url" })).toThrow();
  });
});

describe(".env.example contract", () => {
  const parseDotenv = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1");
      out[key ?? ""] = value ?? "";
    }
    return out;
  };

  it("parses cleanly through the real schema once AUTH_SECRET is supplied", () => {
    const text = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const vars = parseDotenv(text);
    // AUTH_SECRET is deliberately user-supplied (empty in the example).
    const result = envSchema.safeParse({ ...vars, AUTH_SECRET: "0123456789abcdef0123456789abcdef01234567" });
    expect(result.success).toBe(true);
  });

  it("provides every documented variable", () => {
    const text = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const vars = parseDotenv(text);
    for (const key of [
      "DATABASE_URL",
      "REDIS_URL",
      "NODE_ENV",
      "LOG_LEVEL",
      "APP_URL",
      "AUTH_SECRET",
      "MAIL_HOST",
      "MAIL_PORT",
      "MAIL_SECURE",
    ]) {
      expect(vars).toHaveProperty(key);
    }
  });

  it("treats AUTH_SECRET as required (documented as empty in the example)", () => {
    const text = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const vars = parseDotenv(text);
    const result = envSchema.safeParse(vars);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("AUTH_SECRET"))).toBe(true);
    }
  });
});
