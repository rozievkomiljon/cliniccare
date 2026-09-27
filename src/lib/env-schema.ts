/**
 * Environment schema — kept free of "server-only" so tests can exercise the
 * real validation rules. src/lib/env.ts imports and parses this exactly once
 * per process; no other module may read process.env.
 */
import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
      message: "DATABASE_URL must be a PostgreSQL connection string",
    }),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Signs/hashes Auth.js session tokens. Generate with: openssl rand -base64 32 */
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  // SMTP (dev default: MailHog from docker/compose.yml)
  MAIL_HOST: z.string().default("localhost"),
  MAIL_PORT: z.coerce.number().int().default(1025),
  MAIL_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
