import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SRC = "root/usr/libexec/rpcd/luci.aurora";

test("rpcd defines shared MAX_UPLOAD and receive_upload()", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /readonly MAX_UPLOAD=8388608/);
  assert.ok(!src.includes("FONT_MAX_UPLOAD"), "FONT_MAX_UPLOAD must be renamed");
  assert.match(src, /^receive_upload\(\)/m);
});

test("upload_font and upload_icon route through receive_upload", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /receive_upload "\$FONT_TMP_UPLOAD" font \|\| exit 0/);
  assert.match(
    src,
    /receive_upload "\$TMP_UPLOAD_PATH" image "\$filename" \|\| exit 0/,
  );
});

test("image allowlist covers favicon .ico and every advertised format", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /jpg\|jpeg\|png\|webp\|avif\|svg\|gif\|ico/);
});

test("list endpoints expose byte sizes", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /json_add_int "size" "\$csize"/);
  assert.match(src, /json_add_object "icon_sizes"/);
});

test("both upload mv sites are guarded and clean tmp on failure", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /if ! mv "\$FONT_TMP_UPLOAD"/);
  assert.match(src, /if mv "\$TMP_UPLOAD_PATH"/);
  const storeErrors = src.match(/Failed to store file/g) || [];
  assert.equal(storeErrors.length, 2, "font and icon mv failure paths");
});
