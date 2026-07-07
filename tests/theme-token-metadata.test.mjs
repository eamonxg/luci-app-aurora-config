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

function extractMetadataKeys(source, mapName) {
  const match = source.match(
    new RegExp(`const ${mapName} = \\{([\\s\\S]*?)\\n\\};`),
  );
  assert.ok(match, `${mapName} is declared`);
  return Array.from(match[1].matchAll(/^  (\w+): \{/gm)).map(([, key]) => key);
}

// The token tables are joined at runtime from the AuroraTokens registry and
// the metadata maps (buildColorTokenTables throws on mismatch); this catches
// the drift at test time instead of page-load time.
test("theme metadata covers exactly the tokens in the shared token engine", async () => {
  const [auroraTokens, themeSource] = await Promise.all([
    loadAuroraTokens(),
    readFile(resolve("htdocs/luci-static/resources/view/aurora/theme.js"), "utf8"),
  ]);

  assert.deepEqual(
    extractMetadataKeys(themeSource, "COLOR_TOKEN_METADATA").sort(),
    Array.from(auroraTokens.INPUTS).sort(),
  );
  assert.deepEqual(
    extractMetadataKeys(themeSource, "DERIVED_COLOR_TOKEN_METADATA").sort(),
    Array.from(auroraTokens.DERIVED_KEYS).sort(),
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
    /document\.documentElement\.style\.setProperty\(\s*property,\s*toRuntimeColor\(/,
    "live preview serializes custom properties before setting them",
  );
  assert.match(
    source,
    /uci\.set\(\s*"aurora",\s*"theme",\s*`\$\{mode\}_\$\{key\}`,\s*toRuntimeColor\(/,
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
  assert.ok(files.includes("default.template"), "default preset template exists");
  assert.ok(!files.includes("classic.template"), "classic preset template is renamed");
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
