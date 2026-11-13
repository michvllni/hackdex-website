import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "minio";

process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";

const { getObjectRange, objectUrl, presignedGetObject, presignedPutObject } = await import("./server.ts");

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

test("getObjectRange sends a signed Range request and trims a full-object answer", async (t) => {
  setEndpoint("127.0.0.1", 9000, false);
  const body = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const seen: string[] = [];
  let status = 206;
  t.mock.method(globalThis, "fetch", async (input: Request) => {
    seen.push(input.headers.get("range") ?? "");
    assert.ok(input.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256"));
    const range = input.headers.get("range")!;
    const slice = status === 200 ? body : range === "bytes=0-3" ? body.slice(0, 4) : body.slice(-3);
    return new Response(slice, { status });
  });

  assert.deepEqual(await getObjectRange("patches", "a.bps", { first: 4 }), new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(await getObjectRange("patches", "a.bps", { last: 3 }), new Uint8Array([8, 9, 10]));
  assert.deepEqual(seen, ["bytes=0-3", "bytes=-3"]);

  // A server that ignores Range answers 200 with everything.
  status = 200;
  assert.deepEqual(await getObjectRange("patches", "a.bps", { first: 4 }), new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(await getObjectRange("patches", "a.bps", { last: 3 }), new Uint8Array([8, 9, 10]));

  status = 404;
  assert.equal(await getObjectRange("patches", "a.bps", { last: 3 }), null);
});
