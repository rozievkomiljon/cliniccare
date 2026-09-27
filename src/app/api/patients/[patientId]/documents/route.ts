import { NextResponse } from "next/server";

import { uploadAttachment } from "@/features/patients/service";
import { env } from "@/lib/env";
import { toActionError } from "@/lib/errors";
import { requirePermission } from "@/lib/rbac/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
]);

/**
 * Document upload. Route Handler (not a Server Action) because bytes stream
 * here directly; RBAC + validation still run server-side before anything is
 * stored. The object key is generated inside the service.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
) {
  try {
    const { patientId } = await params;
    const session = await requirePermission("patients:manage", { clinicId: undefined });

    const form = await request.formData();
    const file = form.get("file");
    const description = form.get("description");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "A file is required." }, { status: 400 });
    }
    if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: `File exceeds ${env.MAX_UPLOAD_MB} MB.` },
        { status: 413 },
      );
    }
    if (file.type && !ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { ok: false, error: "File type not allowed. Accepted: PDF, PNG, JPEG, WEBP, TXT." },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Belt-and-braces magic-byte sniffing (content-type header is client-supplied).
    if (!magicBytesOk(buffer)) {
      return NextResponse.json(
        { ok: false, error: "File content does not match an allowed type." },
        { status: 415 },
      );
    }

    const result = await uploadAttachment({
      clinicId: session.activeClinicId ?? "",
      patientId,
      actorUserId: session.user.id,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      body: buffer,
      description: typeof description === "string" ? description : undefined,
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    const actionError = toActionError(err);
    const status = actionError.code === "NOT_FOUND" ? 404 : actionError.code === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(actionError, { status });
  }
}

/** Minimal magic-byte allowlist: PDF, PNG, JPEG, WEBP. TXT has no signature. */
function magicBytesOk(buf: Buffer): boolean {
  if (buf.length < 12) return buf.length > 0; // small text files
  const pdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const webp = buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  const utf8Text = buf.every((b) => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b !== 0x7f));
  return pdf || png || jpeg || webp || utf8Text;
}
