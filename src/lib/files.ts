/**
 * Private file storage. Two drivers behind one interface:
 *  - "s3": S3 API (MinIO in dev compose, AWS S3 in prod) — default.
 *  - "fs": local filesystem under DATA_DIR (used for local dev without
 *    Docker and by the E2E suite) — same private-key semantics; bytes are
 *    never served statically, only through the authorized Route Handler.
 * Buckets/directories are never public; the browser never receives a
 * storage URL, only `/api/patients/<id>/documents/<attachmentId>`.
 */
import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { env } from "@/lib/env";

const DRIVER = env.STORAGE_DRIVER;
const FS_ROOT = resolve(env.DATA_DIR ?? ".data/objects");

/** Extensions we accept for patient documents (checked together with MIME). */
export const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt"] as const;

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
};

export type FileValidationResult =
  | { ok: true; ext: string; safeName: string }
  | { ok: false; error: string };

/** Validates filename extension + declared size before anything is stored. */
export function validateUpload(
  fileName: string,
  contentType: string,
  sizeBytes: number,
): FileValidationResult {
  // Path-traversal hardening: keep only the base name.
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  const safeName = base.replace(/[^\w.\- ()]/g, "_").slice(0, 180);
  const dot = safeName.lastIndexOf(".");
  const ext = dot === -1 ? "" : safeName.slice(dot).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    return { ok: false, error: `File type not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(", ")}` };
  }
  const expectedMime = MIME_BY_EXT[ext];
  if (expectedMime && contentType && contentType !== expectedMime) {
    return { ok: false, error: `Content type ${contentType} does not match the file extension.` };
  }
  const max = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (sizeBytes <= 0 || sizeBytes > max) {
    return { ok: false, error: `File must be between 1 byte and ${env.MAX_UPLOAD_MB} MB.` };
  }
  return { ok: true, ext, safeName };
}

/** Server-generated key: clinic/patient/date/entropy.ext — never client paths. */
export function buildStorageKey(clinicId: string, patientId: string, ext: string): string {
  const d = new Date();
  const date = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${clinicId}/${patientId}/${date}/${randomBytes(16).toString("hex")}${ext}`;
}

/** Guards against crafted keys reaching outside the storage root (fs driver). */
function safeFsPath(key: string): string {
  const full = resolve(FS_ROOT, key);
  if (!full.startsWith(FS_ROOT)) throw new Error("Invalid storage key");
  return full;
}

async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

export async function putPatientDocument(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (DRIVER === "fs") {
    const path = safeFsPath(key);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, body);
    return;
  }
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }),
  );
}

export async function getPatientDocument(
  key: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    if (DRIVER === "fs") {
      const body = await readFile(safeFsPath(key));
      const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
      return { body, contentType: MIME_BY_EXT[ext] ?? "application/octet-stream" };
    }
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    const result = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!result.Body) return null;
    const bytes = await result.Body.transformToByteArray();
    return {
      body: Buffer.from(bytes),
      contentType: result.ContentType ?? "application/octet-stream",
    };
  } catch (err) {
    const name = (err as { name?: string; code?: string }).name ?? (err as { code?: string }).code;
    if (name === "NoSuchKey" || name === "404" || name === "ENOENT") return null;
    throw err;
  }
}

export async function deletePatientDocument(key: string): Promise<void> {
  if (DRIVER === "fs") {
    await unlink(safeFsPath(key)).catch(() => undefined);
    return;
  }
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}
