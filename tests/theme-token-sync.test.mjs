import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
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

// The config engine is a hand-maintained vendored copy of the theme's token
// engine (luci-theme-aurora/.dev/tokens). The two MUST agree token-for-token or
// the config UI's live preview diverges from what the theme bakes into CSS.
// This is a behavioral parity check: feed identical inputs through both engines
// and assert identical output. Skips when the sibling theme repo is absent
// (config is an independent repo; standalone CI won't have it checked out).
test("config token engine matches the theme engine token-for-token", async (t) => {
  const themeTokens = "../luci-theme-aurora/.dev/tokens";
  try {
    await access(resolve(themeTokens, "resolve.js"));
    await access(resolve(themeTokens, "defaults.js"));
  } catch {
    t.skip("luci-theme-aurora sibling repo not present");
    return;
  }

  const [{ AuroraTokens, Color }, themeResolve, themeDefaults] = await Promise.all([
    loadConfigEngine(),
    import(resolve(themeTokens, "resolve.js")),
    import(resolve(themeTokens, "defaults.js")),
  ]);

  for (const mode of ["light", "dark"]) {
    const inputs = themeDefaults.DEFAULTS[mode];
    const configOut = AuroraTokens.resolve(mode, { ...inputs });
    const themeOut = themeResolve.resolveTokens(mode, { ...inputs });

    // Array.from normalizes DERIVED_KEYS out of the vm sandbox realm so
    // deepStrictEqual compares contents, not the cross-realm Array prototype.
    assert.deepEqual(
      Array.from(AuroraTokens.DERIVED_KEYS),
      Object.keys(themeOut).filter((k) => !AuroraTokens.INPUTS.includes(k)),
      `${mode}: derived key set matches between engines`,
    );
    for (const key of AuroraTokens.DERIVED_KEYS) {
      assert.equal(
        hexOf(Color, configOut[key]),
        hexOf(Color, themeOut[key]),
        `${mode}: ${key} must resolve identically in both engines`,
      );
    }
  }
});
