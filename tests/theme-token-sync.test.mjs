import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";

const RES = "htdocs/luci-static/resources/utils";

// Load the vendored browser engine (color.global.js -> tokens.global.js) the
// config UI runs at runtime. Returns { AuroraTokens, Color }.
async function loadConfigEngine() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(await readFile(resolve(RES, "color.global.js"), "utf8"), sandbox);
  vm.runInContext(await readFile(resolve(RES, "tokens.global.js"), "utf8"), sandbox);
  return { AuroraTokens: sandbox.AuroraTokens, Color: sandbox.Color };
}

const hexOf = (Color, value) =>
  new Color(value).to("srgb").toString({ format: "hex" }).toLowerCase();

// Parse `option <mode>_<key> '<value>'` lines into { light: {...}, dark: {...} }.
function parseTemplate(source) {
  const out = { light: {}, dark: {} };
  for (const line of source.split("\n")) {
    const m = line.match(/^\s*option\s+(light|dark)_([a-z_]+)\s+'([^']+)'/);
    if (m) out[m[1]][m[2]] = m[3];
  }
  return out;
}

// Guards the bug fixed in gen-presets.mjs: the config UI loads the 10 inputs as
// hex and recomputes derived tokens from them to decide "automatic vs override"
// (syncDerivedInitialState in view/aurora/theme.js). If a template seeds a
// derived value that disagrees with that recompute by even one 8-bit step, a
// clean preset misreads it as a manual override and shows a value in the box.
// Every stored derived value MUST equal the engine's recompute from the same
// hex inputs.
test("preset templates seed derived tokens consistent with the engine recompute", async () => {
  const { AuroraTokens, Color } = await loadConfigEngine();
  const presetDir = resolve("root/usr/share/aurora");
  const files = (await readdir(presetDir)).filter((name) =>
    name.endsWith(".template"),
  );
  assert.ok(files.length > 0, "preset templates exist");

  for (const file of files) {
    const stored = parseTemplate(await readFile(resolve(presetDir, file), "utf8"));
    for (const mode of ["light", "dark"]) {
      const inputs = {};
      for (const key of AuroraTokens.INPUTS) {
        assert.ok(
          stored[mode][key],
          `${file}: missing input ${mode}_${key}`,
        );
        inputs[key] = stored[mode][key];
      }
      const resolved = AuroraTokens.resolve(mode, inputs);
      for (const key of AuroraTokens.DERIVED_KEYS) {
        assert.equal(
          hexOf(Color, stored[mode][key]),
          hexOf(Color, resolved[key]),
          `${file}: ${mode}_${key} seed must match recompute from hex inputs`,
        );
      }
    }
  }
});

// The rpcd script validates presets/imports against the key list shipped in
// color-tokens.conf. That file is generated from the same registry the browser
// engine embeds, but nothing at runtime rechecks it -- this does. Runs in
// standalone CI (no sibling repo needed).
test("color-tokens.conf lists exactly the engine's tokens, inputs first", async () => {
  const { AuroraTokens } = await loadConfigEngine();
  const conf = await readFile(
    resolve("root/usr/share/aurora/color-tokens.conf"),
    "utf8",
  );
  const keys = conf
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));

  assert.deepEqual(
    keys,
    Array.from(AuroraTokens.INPUTS).concat(
      Array.from(AuroraTokens.DERIVED_KEYS),
    ),
  );
});

// tokens.global.js and color-tokens.conf are vendored from the
// @eamonxg/aurora-tokens package at the version pinned in package.json.
// Rerun sync-tokens in --check mode and fail on drift, so neither a stale
// vendor nor a hand-edit can land unnoticed. Falls back to building from the
// sibling aurora-tokens checkout when the registry is unreachable (sync-tokens
// does this internally); skips only on transient network/server failures --
// a 4xx (e.g. 404 for an unpublished pin) means the pin itself is broken and
// must FAIL, not skip.
test("vendored token artifacts are in sync with the pinned package", async (t) => {
  try {
    await promisify(execFile)(process.execPath, [
      resolve("scripts/sync-tokens.mjs"),
      "--check",
    ]);
  } catch (error) {
    const message = String(error?.stderr ?? error);
    if (/HTTP 5\d\d|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(message)) {
      t.skip("registry unreachable and no sibling aurora-tokens checkout");
      return;
    }
    throw error;
  }
});
