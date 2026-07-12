import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SRC = "htdocs/luci-static/resources/view/aurora/theme.js";

test("theme.js requires the shared asset-upload module", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /^"require utils\.asset-upload as assetUpload";/m);
});

test("font upload modal is gone, replaced by dropzone flow", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes("openUploadModal"), "modal flow must be removed");
  assert.ok(
    !src.includes("Upload Custom Font"),
    "modal title/button string must be removed",
  );
  assert.match(src, /assetUpload\.createDropzone\(/);
  assert.match(src, /assetUpload\.confirmDelete\(/);
});

test("theme.js owns zero raw upload plumbing after icon adoption", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes("new XMLHttpRequest"), "XHR must live in the module");
  assert.ok(!src.includes("cgi-bin/cgi-upload"), "upload URL must live in the module");
  assert.match(src, /GIF · ICO/);
  assert.match(src, /exts: \["jpg", "jpeg", "png", "webp", "avif", "svg", "gif", "ico"\]/);
});
