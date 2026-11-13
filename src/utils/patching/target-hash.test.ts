import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { crc32 } from "node:zlib";
import {
  createTargetHasher,
  hashBlob,
  parseBpsFooter,
  parseTargetHash,
  reconcileBpsTarget,
  targetHashColumns,
} from "./target-hash.ts";

const require = createRequire(import.meta.url);
const BinFile = require("rom-patcher-js/rom-patcher-js/modules/BinFile.js");
const BPS = require("rom-patcher-js/rom-patcher-js/modules/RomPatcher.format.bps.js");

// Synthetic "ROMs": never commit real ones.
function fakeRom(size: number, seed: number) {
  const bytes = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    bytes[i] = x >>> 24;
  }
  return bytes;
}
const base = fakeRom(64 * 1024, 1);
const modified = base.slice();
modified.set(fakeRom(500, 2), 1000);
modified[60000] ^= 0xff;

const sha1Of = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");
const crc32Of = (b: Uint8Array) => crc32(b).toString(16).padStart(8, "0");

test("hasher matches node's SHA-1 and CRC32, also when fed in chunks", () => {
  const whole = createTargetHasher();
  whole.update(modified);
  const chunked = createTargetHasher();
  for (let i = 0; i < modified.length; i += 7777) chunked.update(modified.subarray(i, i + 7777));

  const expected = { sha1: sha1Of(modified), crc32: crc32Of(modified), size: modified.length };
  assert.deepEqual(whole.digest(), expected);
  assert.deepEqual(chunked.digest(), expected);
});

test("hashBlob streams a Blob", async () => {
  assert.deepEqual(await hashBlob(new Blob([modified])), {
    sha1: sha1Of(modified),
    crc32: crc32Of(modified),
    size: modified.length,
  });
});

test("BPS footer gives the patched ROM's CRC32, and applying the patch gives the same hashes", () => {
  const patch = BPS.buildFromRoms(new BinFile(base), new BinFile(modified)).export("t");
  const bytes: Uint8Array = patch._u8array;

  const footer = parseBpsFooter(bytes.subarray(bytes.length - 12));
  assert.ok(footer);
  assert.equal(footer.sourceCrc32, crc32Of(base));
  assert.equal(footer.targetCrc32, crc32Of(modified));

  const applied: Uint8Array = BPS.fromFile(new BinFile(bytes)).apply(new BinFile(base))._u8array;
  const hasher = createTargetHasher();
  hasher.update(applied);
  assert.deepEqual(hasher.digest(), { sha1: sha1Of(modified), crc32: footer.targetCrc32, size: modified.length });
});

test("parseBpsFooter needs 12 bytes", () => {
  assert.equal(parseBpsFooter(new Uint8Array(11)), null);
});

test("parseTargetHash accepts full and CRC-only hashes, normalizing case", () => {
  assert.deepEqual(parseTargetHash(undefined), { ok: true, value: null });
  assert.deepEqual(parseTargetHash(null), { ok: true, value: null });
  assert.deepEqual(parseTargetHash({ sha1: "A".repeat(40), crc32: "DEADBEEF", size: 1024 }), {
    ok: true,
    value: { sha1: "a".repeat(40), crc32: "deadbeef", size: 1024 },
  });
  assert.deepEqual(parseTargetHash({ sha1: null, crc32: "deadbeef", size: null }), {
    ok: true,
    value: { sha1: null, crc32: "deadbeef", size: null },
  });
});

test("parseTargetHash rejects malformed input", () => {
  for (const bad of [
    "deadbeef",
    { sha1: "a".repeat(40), crc32: "xyz", size: 1 },
    { sha1: "a".repeat(39), crc32: "deadbeef", size: 1 },
    { sha1: "a".repeat(40), crc32: "deadbeef", size: 0 },
    { sha1: "a".repeat(40), crc32: "deadbeef", size: 1.5 },
    { sha1: "a".repeat(40), crc32: "deadbeef", size: null },
    { sha1: null, crc32: "deadbeef", size: 10 },
  ]) {
    assert.equal(parseTargetHash(bad).ok, false, JSON.stringify(bad));
  }
});

test("reconcileBpsTarget: the footer's CRC32 is authoritative", () => {
  const client = { sha1: "a".repeat(40), crc32: "deadbeef", size: 10 };
  assert.deepEqual(reconcileBpsTarget(client, "deadbeef"), { ok: true, value: client });
  assert.equal(reconcileBpsTarget(client, "00c0ffee").ok, false);
  assert.deepEqual(reconcileBpsTarget(null, "00c0ffee"), { ok: true, value: { sha1: null, crc32: "00c0ffee", size: null } });
  // No usable footer: keep whatever the client sent.
  assert.deepEqual(reconcileBpsTarget(client, null), { ok: true, value: client });
  assert.deepEqual(reconcileBpsTarget(client, "00000000"), { ok: true, value: client });
});

test("targetHashColumns maps to the patches columns", () => {
  assert.deepEqual(targetHashColumns(null), { target_sha1: null, target_crc32: null, target_size: null });
  assert.deepEqual(targetHashColumns({ sha1: null, crc32: "deadbeef", size: null }), {
    target_sha1: null,
    target_crc32: "deadbeef",
    target_size: null,
  });
});
