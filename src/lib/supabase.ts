import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Не настроен Supabase");
  }

  return createClient(url, key);
}

export async function uploadReceipt(file: File | Blob | Buffer, path: string, contentType?: string) {
  const supabase = getSupabaseAdminClient();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "receipts";

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    contentType: contentType ?? ("type" in file ? file.type : "application/octet-stream"),
    upsert: false
  });

  if (error) {
    throw new Error(error.message);
  }

  return path;
}

export async function getSignedReceiptUrl(path: string) {
  const supabase = getSupabaseAdminClient();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "receipts";

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10);

  if (error) {
    throw new Error(error.message);
  }

  return data.signedUrl;
}
