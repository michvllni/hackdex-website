import BinFile from "rom-patcher-js/rom-patcher-js/modules/BinFile.js";
import type { BPSInstance } from "rom-patcher-js/rom-patcher-js/modules/RomPatcher.format.bps.js";
import { runXdelta, type XdeltaResult } from "@/utils/patching/xdelta";
import { createTargetHasher, crc32Hex, hashBlob, type TargetHash } from "@/utils/patching/target-hash";

// Browser-side hashing of the patched ROM for the upload forms. Hashing is a bonus: any failure
// here yields null and the upload carries on without hashes.

/** "Generate from a modified ROM": the uploader hands us the patched ROM itself. */
export async function hashModifiedRom(rom: Blob): Promise<TargetHash | null> {
  try {
    return await hashBlob(rom);
  } catch {
    return null;
  }
}

/**
 * Same check as `trialDecodeXdelta`, but the decoded output is hashed instead of discarded.
 * The output streams through the hasher in chunks and is never kept.
 */
export async function decodeXdeltaWithHash(
  baseFile: Blob,
  patchBlob: Blob,
): Promise<{ result: XdeltaResult; target: TargetHash | null }> {
  const hasher = createTargetHasher();
  const result = await runXdelta({
    mode: "decode",
    sourceFile: baseFile,
    inputFile: patchBlob,
    disableChecksum: false,
    onChunk: (bytes) => hasher.update(bytes),
  });
  return { result, target: result.ok ? hasher.digest() : null };
}

/**
 * BPS: the header already names the target CRC32. With the base ROM, apply the patch to get the
 * SHA-1 and size as well.
 */
export async function hashBpsTarget(bps: BPSInstance, baseFile: Blob | null): Promise<TargetHash | null> {
  const headerCrc = bps.targetChecksum ? crc32Hex(bps.targetChecksum) : null;
  if (!baseFile) return headerCrc ? { sha1: null, crc32: headerCrc, size: null } : null;
  try {
    const patched = bps.apply(new BinFile(await baseFile.arrayBuffer()), true) as unknown as { _u8array: Uint8Array };
    const hasher = createTargetHasher();
    hasher.update(patched._u8array);
    return hasher.digest();
  } catch {
    return headerCrc ? { sha1: null, crc32: headerCrc, size: null } : null;
  }
}
