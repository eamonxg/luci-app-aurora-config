import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

async function loadAuroraTokens() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(
    await readFile(resolve("htdocs/luci-static/resources/utils/color.global.js"), "utf8"),
    sandbox,
  );
  vm.runInContext(
    await readFile(resolve("htdocs/luci-static/resources/utils/tokens.global.js"), "utf8"),
    sandbox,
  );
  return sandbox.AuroraTokens;
}

function extractTokenArrayKeys(source, arrayName) {
  const match = source.match(new RegExp(`const ${arrayName} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${arrayName} is declared`);
  return Array.from(match[1].matchAll(/key:\s*"([^"]+)"/g)).map(
    ([, key]) => key,
  );
}

test("theme metadata exposes every derived token from the shared token engine", async () => {
  const [auroraTokens, themeSource] = await Promise.all([
    loadAuroraTokens(),
    readFile(resolve("htdocs/luci-static/resources/view/aurora/theme.js"), "utf8"),
  ]);

  assert.deepEqual(
    extractTokenArrayKeys(themeSource, "DERIVED_COLOR_TOKENS"),
    Array.from(auroraTokens.DERIVED_KEYS),
  );
});

test("theme editor writes runtime colors in browser-compatible hex form", async () => {
  const source = await readFile(
    resolve("htdocs/luci-static/resources/view/aurora/theme.js"),
    "utf8",
  );

  assert.match(
    source,
    /const toRuntimeColor = \(value\) =>[\s\S]*?toString\(\{ format: "hex" \}\)/,
    "runtime color serializer outputs hex or hex8",
  );
  assert.match(
    source,
    /picker\.addEventListener\("change"[\s\S]*?input\.value = picker\.value/,
    "native color picker keeps the user-facing value as hex",
  );
  assert.match(
    source,
    /document\.documentElement\.style\.setProperty\(property, toRuntimeColor\(/,
    "live preview serializes custom properties before setting them",
  );
  assert.match(
    source,
    /uci\.set\("aurora", "theme", `\$\{mode\}_\$\{key\}`, toRuntimeColor\(/,
    "derived token snapshots are serialized before writing UCI",
  );
});

test("color sections describe accepted input formats", async () => {
  const source = await readFile(
    resolve("htdocs/luci-static/resources/view/aurora/theme.js"),
    "utf8",
  );

  assert.match(source, /#hex, rgb\(\), hsl\(\), lab\(\), and oklch\(\)/);
  assert.match(source, /The picker fills hex/);
});

test("preset templates store runtime-compatible hex colors", async () => {
  const presetDir = resolve("root/usr/share/aurora");
  const files = (await readdir(presetDir)).filter((name) =>
    name.endsWith(".template"),
  );

  assert.ok(files.length > 0, "preset templates exist");
  for (const file of files) {
    const source = await readFile(resolve(presetDir, file), "utf8");
    const colorLines = source
      .split("\n")
      .filter((line) => /^\s*option\s+(light|dark)_/.test(line));

    assert.equal(colorLines.length, 60, `${file} has 30 light + 30 dark colors`);
    for (const line of colorLines) {
      assert.match(
        line,
        /^\s*option\s+(light|dark)_[a-z_]+\s+'#[0-9a-f]{3,4}([0-9a-f]{3,4})?'$/,
        `${file}: ${line}`,
      );
    }
  }
});
