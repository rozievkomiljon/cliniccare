"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { deleteAttachmentAction } from "@/features/patients/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AttachmentRow = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  description: string | null;
  uploadedByName: string | null;
  createdAt: string;
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PatientDocuments({
  patientId,
  attachments,
  canManage,
}: {
  patientId: string;
  attachments: AttachmentRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("description", descRef.current?.value ?? "");
      const res = await fetch(`/api/patients/${patientId}/documents`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "Upload failed.");
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      if (descRef.current) descRef.current.value = "";
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
            className="text-sm"
            aria-label="Choose document"
          />
          <Input ref={descRef} placeholder="Description (optional)" className="max-w-xs" />
          <Button type="button" onClick={upload} disabled={uploading || pending}>
            {uploading ? "Uploading…" : "Upload"}
          </Button>
          <span className="text-xs text-muted-foreground">PDF, images, or TXT · max 10 MB</span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">File</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Size</th>
              <th className="px-4 py-2 font-medium">Uploaded</th>
              {canManage ? <th className="px-4 py-2 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {attachments.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-4 py-2">
                  <a
                    href={`/api/patients/${patientId}/documents/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                  >
                    {a.fileName}
                  </a>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{a.description ?? "—"}</td>
                <td className="px-4 py-2">{fmtSize(a.sizeBytes)}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(a.createdAt).toISOString().slice(0, 10)}
                  {a.uploadedByName ? ` · ${a.uploadedByName}` : ""}
                </td>
                {canManage ? (
                  <td className="px-4 py-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await deleteAttachmentAction({ attachmentId: a.id });
                          if (!result.ok) setError(result.error);
                          else router.refresh();
                        })
                      }
                    >
                      Delete
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
            {attachments.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-4 py-6 text-center text-muted-foreground">
                  No documents uploaded.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
