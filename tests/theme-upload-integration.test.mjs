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
