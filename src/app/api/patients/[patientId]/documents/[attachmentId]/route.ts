import { NextResponse } from "next/server";

import { getAttachmentForDownload } from "@/features/patients/service";
import { getPatientDocument } from "@/lib/files";
import { toActionError } from "@/lib/errors";
import { requirePermission } from "@/lib/rbac/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authorized download. Streams bytes from the private store only after the
 * RBAC check confirms the caller belongs to the attachment's clinic; the
 * browser never sees a storage URL. Content-Disposition forces inline PDF
 * viewing / image display but attachment semantics for anything else.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ patientId: string; attachmentId: string }> },
) {
  try {
    const { patientId, attachmentId } = await params;
    const session = await requirePermission("patients:view");
    const clinicId = session.activeClinicId ?? "";

    const meta = await getAttachmentForDownload(attachmentId, clinicId);
    if (!meta || !(await patientBelongsToClinic(patientId, clinicId))) {
      return NextResponse.json({ ok: false, error: "Document not found." }, { status: 404 });
    }

    const file = await getPatientDocument(meta.storageKey);
    if (!file) {
      return NextResponse.json({ ok: false, error: "Document content unavailable." }, { status: 404 });
    }

    const disposition = meta.contentType === "application/pdf" || meta.contentType.startsWith("image/")
      ? "inline"
      : "attachment";

    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": meta.contentType,
        "Content-Length": String(file.body.length),
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(meta.fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const actionError = toActionError(err);
    const status = actionError.code === "UNAUTHORIZED" ? 401 : actionError.code === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(actionError, { status });
  }
}

import { db } from "@/lib/db";
async function patientBelongsToClinic(patientId: string, clinicId: string): Promise<boolean> {
  const row = await db.patient.findFirst({
    where: { id: patientId, clinicId, isDeleted: false },
    select: { id: true },
  });
  return row !== null;
}
