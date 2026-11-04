import { AwsClient } from "aws4fetch";

// S3-compatible storage (MinIO locally, R2 in production). Signing is done with
// fetch + WebCrypto so this runs on Node and on Cloudflare Workers alike.

let cachedClient: AwsClient | null = null;

function getClient(): AwsClient {
  if (cachedClient) return cachedClient;
  cachedClient = new AwsClient({
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    service: "s3",
    // R2 and MinIO both accept us-east-1 in the credential scope.
    region: process.env.S3_REGION || "us-east-1",
  });
  return cachedClient;
}

/** Path-style URL, so one endpoint serves every bucket (same as the minio client did for non-AWS hosts). */
export function objectUrl(bucket: string, key: string): URL {
  const protocol = process.env.S3_USE_SSL === "true" ? "https" : "http";
  const port = process.env.S3_PORT ? `:${process.env.S3_PORT}` : "";
  const path = [bucket, ...key.split("/")].map(encodeRfc3986).join("/");
  return new URL(`${protocol}://${process.env.S3_ENDPOINT}${port}/${path}`);
}

function encodeRfc3986(segment: string) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function presign(method: "GET" | "PUT", bucket: string, key: string, expirySeconds: number, datetime?: string) {
  const url = objectUrl(bucket, key);
  url.searchParams.set("X-Amz-Expires", String(expirySeconds));
  const signed = await getClient().sign(url.toString(), { method, aws: { signQuery: true, datetime } });
  return signed.url;
}

/** A URL anyone can GET the object from for `expirySeconds`. `datetime` is for tests. */
export function presignedGetObject(bucket: string, key: string, expirySeconds: number, datetime?: string) {
  return presign("GET", bucket, key, expirySeconds, datetime);
}

/** A URL anyone can PUT the object to for `expirySeconds`. `datetime` is for tests. */
export function presignedPutObject(bucket: string, key: string, expirySeconds: number, datetime?: string) {
  return presign("PUT", bucket, key, expirySeconds, datetime);
}

/** Whether an uploaded file actually landed, checked before a database row points at it. */
export async function objectExists(bucket: string, key: string) {
  try {
    const res = await getClient().fetch(objectUrl(bucket, key).toString(), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeObject(bucket: string, key: string) {
  const res = await getClient().fetch(objectUrl(bucket, key).toString(), { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`Failed to delete ${bucket}/${key}: ${res.status} ${res.statusText}`);
  }
}

export const PATCHES_BUCKET = process.env.PATCHES_BUCKET!;
export const COVERS_BUCKET = process.env.COVERS_BUCKET!;
