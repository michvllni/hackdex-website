-- Hashes of the ROM a patch produces when applied to the clean base ROM, so
-- players and third-party tools can verify a patched result. Same lowercase hex
-- notation as src/data/baseRoms.ts.
--
-- The server never has base ROMs, so the uploader's browser computes them:
--   target_sha1 / target_size  only when the uploader had the base ROM linked
--   target_crc32               also from the BPS footer, which the server reads
--                              itself and cross-checks
-- All three stay null for patches uploaded before this migration until they're
-- backfilled.

alter table public.patches
  add column target_sha1 text,
  add column target_crc32 text,
  add column target_size bigint,
  add constraint patches_target_sha1_format check (target_sha1 ~ '^[0-9a-f]{40}$'),
  add constraint patches_target_crc32_format check (target_crc32 ~ '^[0-9a-f]{8}$'),
  add constraint patches_target_size_positive check (target_size > 0),
  add constraint patches_target_sha1_with_size check ((target_sha1 is null) = (target_size is null));
