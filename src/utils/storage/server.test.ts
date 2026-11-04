import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "minio";

process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";

const { objectUrl, presignedGetObject, presignedPutObject } = await import("./server.ts");

const requestDate = new Date("2026-11-04T12:34:56Z");
const datetime = "20261104T123456Z";
const keys = ["plain.bps", "covers/slug/a b+c!(1)*'.png", "ünïcödé~_-.xdelta"];

function setEndpoint(endPoint: string, port: number, useSSL: boolean) {
  process.env.S3_ENDPOINT = endPoint;
  process.env.S3_PORT = String(port);
  process.env.S3_USE_SSL = String(useSSL);
  return new Client({ endPoint, port, useSSL, accessKey: "test-access-key", secretKey: "test-secret-key", region: "us-east-1" });
}

function assertSameSignedUrl(actual: string, expected: string) {
  const a = new URL(actual);
  const e = new URL(expected);
  assert.equal(a.origin + a.pathname, e.origin + e.pathname);
  assert.deepEqual([...a.searchParams].sort(), [...e.searchParams].sort());
}

for (const [endPoint, port, useSSL] of [["127.0.0.1", 9000, false], ["account.r2.cloudflarestorage.com", 443, true]] as const) {
  test(`presigned URLs match the minio client for ${endPoint}`, async () => {
    const minio = setEndpoint(endPoint, port, useSSL);
    for (const key of keys) {
      assertSameSignedUrl(
        await presignedGetObject("patches", key, 300, datetime),
        await minio.presignedUrl("GET", "patches", key, 300, {}, requestDate),
      );
      assertSameSignedUrl(
        await presignedPutObject("covers", key, 600, datetime),
        await minio.presignedUrl("PUT", "covers", key, 600, {}, requestDate),
      );
    }
  });
}

test("object URLs are path-style and drop default ports", () => {
  setEndpoint("account.r2.cloudflarestorage.com", 443, true);
  assert.equal(objectUrl("patches", "a/b c.bps").toString(), "https://account.r2.cloudflarestorage.com/patches/a/b%20c.bps");
  setEndpoint("127.0.0.1", 9000, false);
  assert.equal(objectUrl("covers", "x.png").toString(), "http://127.0.0.1:9000/covers/x.png");
});
