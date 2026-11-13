import { sha1 } from "js-sha1";

/**
 * Hashes of the ROM a patch produces when applied to the clean base ROM.
 * Same notation as `src/data/baseRoms.ts`: lowercase hex.
 * `sha1` and `size` are null when the uploader had no base ROM to patch with;
 * `crc32` can still be known from a BPS header.
 */
export type TargetHash = {
  sha1: string | null;
  crc32: string;
  size: number | null;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/** Feed bytes in any number of chunks, so large NDS ROMs never need to sit in memory twice. */
export function createTargetHasher() {
  const sha = sha1.create();
  let crc = 0xffffffff;
  let size = 0;
  return {
    update(bytes: Uint8Array) {
      sha.update(bytes);
      for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
      size += bytes.length;
    },
    digest(): TargetHash {
      return { sha1: sha.hex(), crc32: crc32Hex(crc ^ 0xffffffff), size };
    },
  };
}

export async function hashBlob(blob: Blob): Promise<TargetHash> {
  const hasher = createTargetHasher();
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.digest();
}

/**
 * The last 12 bytes of a BPS file are three little-endian CRC32s:
 * source ROM, target ROM, patch (over everything before it).
 */
export function parseBpsFooter(tail: Uint8Array): { sourceCrc32: string; targetCrc32: string; patchCrc32: string } | null {
  if (tail.length < 12) return null;
  const view = new DataView(tail.buffer, tail.byteOffset + tail.length - 12, 12);
  return {
    sourceCrc32: crc32Hex(view.getUint32(0, true)),
    targetCrc32: crc32Hex(view.getUint32(4, true)),
    patchCrc32: crc32Hex(view.getUint32(8, true)),
  };
}

const MAX_ROM_SIZE = 4 * 1024 * 1024 * 1024; // larger than any supported platform's ROM

/** Checks a client-sent TargetHash. Returns the normalized value, null for "none sent", or an error. */
export function parseTargetHash(input: unknown): { ok: true; value: TargetHash | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "object") return { ok: false, error: "Invalid ROM hash" };
  const { sha1: s, crc32: c, size } = input as Record<string, unknown>;

  if (typeof c !== "string" || !/^[0-9a-fA-F]{8}$/.test(c)) return { ok: false, error: "Invalid ROM CRC32" };
  if (s !== null && (typeof s !== "string" || !/^[0-9a-fA-F]{40}$/.test(s))) return { ok: false, error: "Invalid ROM SHA-1" };
  if (size !== null && (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_ROM_SIZE)) {
    return { ok: false, error: "Invalid ROM size" };
  }
  if ((s === null) !== (size === null)) return { ok: false, error: "Invalid ROM hash" };

  return { ok: true, value: { sha1: s === null ? null : s.toLowerCase(), crc32: c.toLowerCase(), size } };
}

/**
 * Settles what gets stored for a BPS upload. The footer is read server-side from the uploaded
 * file, so its CRC32 wins over the client's: a mismatch means the client hashed something else.
 */
export function reconcileBpsTarget(
  client: TargetHash | null,
  footerTargetCrc32: string | null,
): { ok: true; value: TargetHash | null } | { ok: false; error: string } {
  if (!footerTargetCrc32 || footerTargetCrc32 === "00000000") return { ok: true, value: client };
  if (!client) return { ok: true, value: { sha1: null, crc32: footerTargetCrc32, size: null } };
  if (client.crc32 !== footerTargetCrc32) {
    return { ok: false, error: "The patched ROM's checksum doesn't match the patch file. Please select the file again." };
  }
  return { ok: true, value: client };
}

/** Columns on `patches`. */
export function targetHashColumns(target: TargetHash | null) {
  return {
    target_sha1: target?.sha1 ?? null,
    target_crc32: target?.crc32 ?? null,
    target_size: target?.size ?? null,
  };
}
