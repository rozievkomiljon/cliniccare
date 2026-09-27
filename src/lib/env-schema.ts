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
  // Private document storage. DRIVER selects the backend: "fs" (local dev
  // + E2E) or "s3" (MinIO in dev compose, AWS S3 in production). Downloads
  // always flow through the app's authorized handler — never public URLs.
  STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  DATA_DIR: z.string().default(".data/objects"),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("cliniccare-documents"),
  S3_ACCESS_KEY_ID: z.string().default("minioadmin"),
  S3_SECRET_ACCESS_KEY: z.string().default("minioadmin"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
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
