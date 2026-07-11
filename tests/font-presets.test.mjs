import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const confPath = fileURLToPath(
  new URL("../root/usr/share/aurora/font-presets.conf", import.meta.url),
);
const lines = readFileSync(confPath, "utf8").trim().split("\n");

test("header declares v2 generated format", () => {
  assert.match(lines[0], /^v2\|generated-by-gen-font-presets\|do-not-edit$/);
});

const fonts = lines.filter((l) => l.startsWith("font|")).map((l) => l.split("|"));
const files = lines.filter((l) => l.startsWith("file|")).map((l) => l.split("|"));

test("font lines have 7 fields and known slots", () => {
  assert.ok(fonts.length >= 8);
  for (const f of fonts) {
    assert.equal(f.length, 7, `bad font line: ${f.join("|")}`);
    assert.ok(["sans", "mono"].includes(f[1]));
    assert.ok(/^[a-z0-9-]+$/.test(f[2]), `bad name: ${f[2]}`);
    assert.ok(f[6].length > 0, "stack required");
  }
});

test("file lines carry valid sha256 and pinned dual-source urls", () => {
  assert.ok(files.length > 0);
  for (const f of files) {
    const [, slot, name, weight, sha256, url1, url2] = f;
    assert.equal(f.length, 7, `bad file line: ${f.join("|")}`);
    assert.ok(["sans", "mono"].includes(slot));
    assert.ok(/^(400|500|600|700)$/.test(weight));
    assert.match(sha256, /^[0-9a-f]{64}$/);
    assert.match(url1, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource\/[a-z0-9-]+@\d+\.\d+\.\d+\/files\/.+\.woff2$/);
    assert.match(url2, /^https:\/\/registry\.npmmirror\.com\/@fontsource\/[a-z0-9-]+\/\d+\.\d+\.\d+\/files\/files\/.+\.woff2$/);
    assert.ok(fonts.some((x) => x[1] === slot && x[2] === name), `orphan file line for ${slot}/${name}`);
  }
});

test("every webfont preset stays within 4 files, non-webfont has none", () => {
  for (const f of fonts) {
    const [, slot, name, , , family] = f;
    const n = files.filter((x) => x[1] === slot && x[2] === name).length;
    if (name === "default" || name === "system") assert.equal(n, 0);
    else {
      assert.ok(n >= 2 && n <= 4, `${slot}/${name} has ${n} files`);
      assert.ok(files.some((x) => x[1] === slot && x[2] === name && x[3] === "400"), `${slot}/${name} missing weight 400`);
      assert.ok(family.length > 0);
    }
  }
});
