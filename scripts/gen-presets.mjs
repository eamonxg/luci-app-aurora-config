// Regenerate the preset templates under root/usr/share/aurora/ from
// scripts/aurora-presets.json -- resolved preset values precomputed at
// @eamonxg/luci-theme-tokens build time (inputs rounded to hex first, then
// derived, so stored == what the config UI recomputes; see the package's
// build.mjs). This script only formats and injects UCI option lines, and
// mirrors the preset data to htdocs so the Theme Store can render the
// built-in preset cards offline (htdocs/.../aurora/presets.json).
//
// Only the colours come from the vendored json. A preset's layout and
// typography -- navigation shape, spacing, corner radius, content width, both
// font stacks, the toolbar switch -- live in the templates themselves and are
// read back out here: sync-tokens.mjs overwrites aurora-presets.json from the
// npm package on every sync, so anything this repo authors has to live
// somewhere that sync never touches.
//
// Zero dependencies / no build step. Run:  node scripts/gen-presets.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PRESET_DIR = resolve(root, "root/usr/share/aurora");
const HTDOCS_PRESETS = resolve(
  root,
  "htdocs/luci-static/resources/aurora/presets.json",
);

// The two groups a hub payload sorts these keys into (see build_share_payload
// in root/usr/libexec/rpcd/luci.aurora). The browser copy is emitted in that
// same shape, so the Theme Store reads a built-in preset with exactly the
// accessors it already uses for a shared configuration.
const LAYOUT_KEYS = [
  "nav_type",
  "struct_spacing",
  "struct_radius_base",
  "struct_content_width_centered",
  "toolbar_enabled",
];
const TYPOGRAPHY_KEYS = ["struct_font_sans", "struct_font_mono"];

// A hub payload's typography carries the roster id alongside the stack
// (build_share_payload emits both). The id is what says whether the family has
// to be downloaded before the preset looks the way it is drawn -- "default"
// and "system" resolve to faces already on the router, every other id is a
// Fontsource webfont. Recovered from the roster by stack, the same reverse
// lookup resolve_font_preset_id does on the device.
const FONT_PRESETS = resolve(PRESET_DIR, "font-presets.conf");

const fontIdByStack = () => {
  const table = { sans: new Map(), mono: new Map() };
  for (const line of readFileSync(FONT_PRESETS, "utf8").split("\n")) {
    const parts = line.split("|");
    if (parts[0] !== "font") continue;
    const [, slot, id, , , , stack] = parts;
    if (table[slot] && !table[slot].has(stack)) table[slot].set(stack, id);
  }
  return table;
};

const { presets } = JSON.parse(
  readFileSync(resolve(here, "aurora-presets.json"), "utf8"),
);

const colorLines = (preset) => {
  const lines = [];
  for (const mode of ["light", "dark"])
    for (const [key, hex] of Object.entries(presets[preset][mode]))
      lines.push(`\toption ${mode}_${key} '${hex}'`);
  return lines;
};

const isColorOptionLine = (line) => /^\toption (light|dark)_/.test(line);

// `option <key> '<value>'` -> value. Only the first occurrence counts, the
// same way load_preset_struct_snapshot's awk pass takes it.
const readOption = (source, key) => {
  const match = new RegExp(`^\\s*option\\s+${key}\\s+'([^']*)'`, "m").exec(source);
  return match ? match[1] : null;
};

const fontIds = fontIdByStack();

const structureOf = (preset, source) => {
  const pick = (keys) =>
    keys.reduce((acc, key) => {
      const value = readOption(source, key);
      if (value === null)
        throw new Error(
          `${preset}: template is missing option ${key} -- every built-in ` +
            `preset is a whole look, not just a palette`,
        );
      acc[key] = value;
      return acc;
    }, {});

  const typography = pick(TYPOGRAPHY_KEYS);
  for (const slot of ["sans", "mono"]) {
    const stack = typography[`struct_font_${slot}`];
    const id = fontIds[slot].get(stack);
    // A stack the roster does not know would leave the device unable to
    // reverse-map it either, so the preset's typeface would silently degrade
    // to the next family in the stack. Copy the roster line, do not retype it.
    if (!id)
      throw new Error(
        `${preset}: struct_font_${slot} matches no ${slot} entry in ` +
          `font-presets.conf -- copy the stack from its "font|${slot}|..." row`,
      );
    typography[`font_${slot}`] = id;
  }

  return { layout: pick(LAYOUT_KEYS), typography };
};

// Flat light_*/dark_* keys, the shape a hub payload's `colors` object uses.
const flatColors = (preset) => {
  const out = {};
  for (const mode of ["light", "dark"])
    for (const [key, hex] of Object.entries(presets[preset][mode]))
      out[`${mode}_${key}`] = hex;
  return out;
};

const browserPresets = {};

for (const preset of Object.keys(presets)) {
  const templateFile = preset === "default" ? "default.template" : `${preset}.template`;
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
  const source = out.join("\n");
  writeFileSync(path, source, "utf8");
  console.log(`gen-presets: wrote ${templateFile}`);

  const { layout, typography } = structureOf(preset, source);
  // `toolbar` is always empty and always present: applying a built-in preset
  // never rewrites the user's shortcut sections (see apply_theme_preset), and
  // the Theme Store reads the key to decide whether to draw a shortcut tile.
  browserPresets[preset] = {
    colors: flatColors(preset),
    layout,
    typography,
    toolbar: [],
  };
}

// Browser copy for the Theme Store's built-in preset cards. Same data as the
// templates, projected into the hub's payload shape; regenerated together so
// the two can never drift.
mkdirSync(dirname(HTDOCS_PRESETS), { recursive: true });
writeFileSync(
  HTDOCS_PRESETS,
  JSON.stringify({ presets: browserPresets }, null, 2) + "\n",
  "utf8",
);
console.log("gen-presets: wrote htdocs/luci-static/resources/aurora/presets.json");
