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
const { resolve: resolveTokens, INPUTS } = sandbox.AuroraTokens;

const toRuntimeColor = (value) =>
  new sandbox.Color(value).to("srgb").toString({ format: "hex" }).toLowerCase();

// Shared status accents + on_brand (theme defaults); only surface/identity
// inputs vary per preset. The theme refresh moved status inputs to "content"
// semantics, so these are the accent colours, not surfaces.
const STATUS = {
  light: {
    info: "oklch(0.43 0.2 255)",
    warning: "oklch(0.35 0.08 60)",
    success: "oklch(0.32 0.09 165)",
    danger: "oklch(0.35 0.12 25)",
  },
  dark: {
    info: "oklch(0.8 0.11 255)",
    warning: "oklch(0.82 0.13 80)",
    success: "oklch(0.72 0.13 158)",
    danger: "oklch(0.7 0.16 22)",
  },
};

// canvas -> bg, content -> text; the old surface_raised (panel colour) becomes
// the new single `surface`. on_brand is per-preset.
const PRESETS = {
  classic: {
    light: {
      bg: "oklch(0.967 0.003 264)",
      surface: "oklch(1 0 0)",
      text: "oklch(0.21 0.02 264)",
      brand: "oklch(0.68 0.11 233)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0.74 0.238 322.16)",
      ...STATUS.light,
    },
    dark: {
      bg: "oklch(0.13 0.018 264)",
      surface: "oklch(0.21 0.02 264)",
      text: "oklch(0.985 0.002 264)",
      brand: "oklch(0.6 0.13 188.745)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0.77 0.14 168)",
      ...STATUS.dark,
    },
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
const KEY_ORDER = Object.keys(resolveTokens("light", PRESETS.classic.light));

const colorLines = (preset) => {
  const lines = [];
  for (const mode of ["light", "dark"]) {
    const resolved = resolveTokens(mode, PRESETS[preset][mode]);
    for (const key of KEY_ORDER) {
      lines.push(`\toption ${mode}_${key} '${toRuntimeColor(resolved[key])}'`);
    }
  }
  return lines;
};

const isColorOptionLine = (line) => /^\toption (light|dark)_/.test(line);

for (const preset of Object.keys(PRESETS)) {
  const path = resolve(PRESET_DIR, `${preset}.template`);
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
  console.log(`gen-presets: wrote ${preset}.template`);
}
