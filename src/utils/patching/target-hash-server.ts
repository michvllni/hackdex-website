import { getObjectRange, PATCHES_BUCKET } from "@/utils/storage/server";
import type { PatchFormat } from "@/utils/patching";
import { parseBpsFooter, parseTargetHash, reconcileBpsTarget, type TargetHash } from "@/utils/patching/target-hash";

const BPS_MAGIC = [0x42, 0x50, 0x53, 0x31]; // "BPS1"

/**
 * What to store as the patched ROM's hashes for a patch that just finished uploading.
 * The client's value is checked for format; for BPS, the server reads the target CRC32 from the
 * uploaded file's footer itself, which fills it in when the client had no base ROM and rejects
 * a client hash that doesn't belong to this patch.
 */
export async function resolveUploadedTargetHash(
  objectKey: string,
  format: PatchFormat,
  clientInput: unknown,
): Promise<{ ok: true; value: TargetHash | null } | { ok: false; error: string }> {
  const parsed = parseTargetHash(clientInput);
  if (!parsed.ok || format !== "bps") return parsed;

  const [head, tail] = await Promise.all([
    getObjectRange(PATCHES_BUCKET, objectKey, { first: 4 }),
    getObjectRange(PATCHES_BUCKET, objectKey, { last: 12 }),
  ]);
  const isBps = !!head && head.length === 4 && BPS_MAGIC.every((b, i) => head[i] === b);
  const footer = isBps && tail ? parseBpsFooter(tail) : null;
  return reconcileBpsTarget(parsed.value, footer?.targetCrc32 ?? null);
}
