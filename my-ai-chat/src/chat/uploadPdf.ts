import { UPLOAD_URL } from "./constants";

export type UploadPdfResponse = {
  text: string;
  message?: string;
  chunkCount?: number;
};

export async function uploadPdfFile(file: File): Promise<UploadPdfResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    body: formData,
  });

  const data = (await res.json()) as {
    text?: string;
    message?: string;
    chunkCount?: number;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return {
    text: typeof data.text === "string" ? data.text : "",
    message: typeof data.message === "string" ? data.message : undefined,
    chunkCount: typeof data.chunkCount === "number" ? data.chunkCount : undefined,
  };
}
