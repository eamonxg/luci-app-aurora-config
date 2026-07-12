import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SRC = "htdocs/luci-static/resources/utils/asset-upload.js";

test("asset-upload module exposes the shared surface", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /^"require baseclass";/m);
  assert.match(src, /^"require rpc";/m);
  assert.match(src, /^"require ui";/m);
  assert.match(src, /return baseclass\.extend\(/);
  for (const name of [
    "MAX_UPLOAD",
    "formatSize",
    "checkFile",
    "uploadToRouter",
    "createDropzone",
    "createProgressRow",
    "confirmDelete",
  ])
    assert.ok(src.includes(name), `missing export: ${name}`);
});

test("module owns the only cgi-upload pipeline", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /\/cgi-bin\/cgi-upload/);
  assert.match(src, /filemode.*0600/);
});
