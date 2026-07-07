// Regenerate the preset templates under root/usr/share/aurora/ from the 10
// editable inputs per preset. Every derived colour token is computed by the
// SAME engine the browser uses (utils/tokens.global.js), so the shipped UCI
// snapshot already overrides the baked _tokens.css defaults of the theme. The
// emitted UCI values are hex/hex8 so runtime template injection keeps the same
// browser compatibility profile as the compiled CSS fallbacks.
//
// Zero dependencies / no build step: the config app ships raw JS, so this just
// loads the vendored colorjs.io bundle + the token engine into a vm sandbox.
//
// Run from the package root:  node scripts/gen-presets.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const RES = resolve(root, "htdocs/luci-static/resources/utils");
const PRESET_DIR = resolve(root, "root/usr/share/aurora");

// Load the browser engine (color.global.js -> tokens.global.js) into a sandbox.
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(resolve(RES, "color.global.js"), "utf8"), sandbox);
vm.runInContext(readFileSync(resolve(RES, "tokens.global.js"), "utf8"), sandbox);
const { resolve: resolveTokens, INPUTS, DEFAULTS } = sandbox.AuroraTokens;

const toRuntimeColor = (value) =>
  new sandbox.Color(value).to("srgb").toString({ format: "hex" }).toLowerCase();

// Shared status accents (theme defaults); only surface/identity inputs vary
// per preset. The theme refresh moved status inputs to "content" semantics,
// so these are the accent colours, not surfaces.
const statusKeys = ["info", "warning", "success", "danger"];
const STATUS = {
  light: Object.fromEntries(statusKeys.map((k) => [k, DEFAULTS.light[k]])),
  dark: Object.fromEntries(statusKeys.map((k) => [k, DEFAULTS.dark[k]])),
};

// canvas -> bg, content -> text; the old surface_raised (panel colour) becomes
// the new single `surface`. on_brand is per-preset. The default preset IS the
// theme's baked defaults, so it comes straight from the registry.
const PRESETS = {
  default: {
    light: { ...DEFAULTS.light },
    dark: { ...DEFAULTS.dark },
  },
  "sage-green": {
    light: {
      bg: "oklch(0.9761 0.0041 91.4461)",
      surface: "oklch(1 0 0)",
      text: "oklch(0.2417 0.0298 269.8827)",
      brand: "oklch(0.6333 0.0309 154.9039)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0.6333 0.0309 154.9039)",
      ...STATUS.light,
    },
    dark: {
      bg: "oklch(0.1448 0 0)",
      surface: "oklch(0.1822 0 0)",
      text: "oklch(0.9702 0 0)",
      brand: "oklch(0.6333 0.0309 154.9039)",
      on_brand: "oklch(0 0 0)",
      link: "oklch(0.6333 0.0309 154.9039)",
      ...STATUS.dark,
    },
  },
  "amber-sand": {
    light: {
      bg: "oklch(0.9818 0.0054 95.0986)",
      surface: "oklch(0.9818 0.0054 95.0986)",
      text: "oklch(0.3438 0.0269 95.7226)",
      brand: "oklch(0.6171 0.1375 39.0427)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0.6171 0.1375 39.0427)",
      ...STATUS.light,
    },
    dark: {
      bg: "oklch(0.2679 0.0036 106.6427)",
      surface: "oklch(0.3085 0.0035 106.6039)",
      text: "oklch(0.8074 0.0142 93.0137)",
      brand: "oklch(0.6724 0.1308 38.7559)",
      on_brand: "oklch(0 0 0)",
      link: "oklch(0.6724 0.1308 38.7559)",
      ...STATUS.dark,
    },
  },
  monochrome: {
    light: {
      bg: "oklch(0.9900 0 0)",
      surface: "oklch(1 0 0)",
      text: "oklch(0 0 0)",
      brand: "oklch(0 0 0)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0 0 0)",
      ...STATUS.light,
    },
    dark: {
      bg: "oklch(0 0 0)",
      surface: "oklch(0.1400 0 0)",
      text: "oklch(1 0 0)",
      brand: "oklch(1 0 0)",
      on_brand: "oklch(0 0 0)",
      link: "oklch(1 0 0)",
      ...STATUS.dark,
    },
  },
  "sky-blue": {
    light: {
      bg: "oklch(1 0 0)",
      surface: "oklch(0.9784 0.0011 197.1387)",
      text: "oklch(0.1884 0.0128 248.5103)",
      brand: "oklch(0.6723 0.1606 244.9955)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0.6723 0.1606 244.9955)",
      ...STATUS.light,
    },
    dark: {
      bg: "oklch(0 0 0)",
      surface: "oklch(0.2097 0.0080 274.5332)",
      text: "oklch(0.9328 0.0025 228.7857)",
      brand: "oklch(0.6692 0.1607 245.0110)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0.6692 0.1607 245.0110)",
      ...STATUS.dark,
    },
  },
};

// Stable emission order: inputs first, then derived.
const KEY_ORDER = Object.keys(resolveTokens("light", PRESETS.default.light));

const colorLines = (preset) => {
  const lines = [];
  for (const mode of ["light", "dark"]) {
    // Round the 10 editable inputs to hex FIRST, then derive from those rounded
    // inputs. The config UI loads inputs as hex and recomputes the derived
    // tokens from them to decide "automatic vs user-override" (see
    // syncDerivedInitialState in view/aurora/theme.js). Seeding derived values
    // from full-precision oklch makes ~30 tokens (e.g. brand_hover) disagree
    // with that recompute by a single 8-bit step, so a clean preset misreads
    // them as manual overrides and shows a value in the input box. Deriving
    // from the same hex the browser sees keeps stored == recomputed.
    const hexInputs = {};
    for (const key of INPUTS)
      hexInputs[key] = toRuntimeColor(PRESETS[preset][mode][key]);
    const resolved = resolveTokens(mode, hexInputs);
    for (const key of KEY_ORDER) {
      lines.push(`\toption ${mode}_${key} '${toRuntimeColor(resolved[key])}'`);
    }
  }
  return lines;
};

const isColorOptionLine = (line) => /^\toption (light|dark)_/.test(line);

for (const preset of Object.keys(PRESETS)) {
  const templateFile =
    preset === "default" ? "default.template" : `${preset}.template`;
  const path = resolve(PRESET_DIR, templateFile);
  const lines = readFileSync(path, "utf8").split("\n");
  const out = [];
  let injected = false;
  for (const line of lines) {
    if (isColorOptionLine(line)) {
      if (!injected) {
        out.push(...colorLines(preset));
        injected = true;
      }
      continue;
    }
    out.push(line);
  }
  if (!injected) throw new Error(`${preset}: no colour block found to replace`);
  writeFileSync(path, out.join("\n"), "utf8");
  console.log(`gen-presets: wrote ${templateFile}`);
}
