// Regenerate the preset templates under root/usr/share/aurora/ from
// scripts/aurora-presets.json -- resolved preset values precomputed at
// @eamonxg/luci-theme-tokens build time (inputs rounded to hex first, then
// derived, so stored == what the config UI recomputes; see the package's
// build.mjs). This script only formats and injects UCI option lines, and
// mirrors the preset data into the JS sources so the Marketplace can render
// the built-in preset cards offline (.dev/src/resource/aurora/presets.json).
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
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// here = .dev/scripts, so the repo root is two levels up.
const root = resolve(here, "../..");
const PRESET_DIR = resolve(root, "root/usr/share/aurora");
const SRC_PRESETS = resolve(
  root,
  ".dev/src/resource/aurora/presets.json",
);

// The two groups a hub payload sorts these keys into (see build_share_payload
// in root/usr/libexec/rpcd/luci.aurora). The browser copy is emitted in that
// same shape, so the Marketplace reads a built-in preset with exactly the
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

const toolbarOf = (preset, source) => {
  const items = [];
  let current = null;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (/^config\s+toolbar_item\s*$/.test(line)) {
      if (current) items.push(current);
      current = { title: "", url: "", icon: "", enabled: "" };
      continue;
    }
    if (/^config\s/.test(line)) {
      if (current) items.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const m = line.match(/^option\s+(title|url|icon|enabled)\s+(.*)$/);
    if (!m) continue;
    current[m[1]] = m[2].replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
  }
  if (current) items.push(current);

  for (const item of items) {
    if (!item.title || !item.url || !/^[01]$/.test(item.enabled))
      throw new Error(
        `${preset}: a toolbar_item is missing title/url/enabled -- the device ` +
          `rejects the whole preset on this (see load_preset_toolbar)`,
      );
  }
  return items.map(({ title, url, icon, enabled }) =>
    icon ? { title, url, icon, enabled } : { title, url, enabled },
  );
};

// The four colours the Marketplace draws a card from -- marketplace.js SWATCH_KEYS.
// Kept in sync by builtin-presets.test.mjs, which parses that declaration and
// fails if this list drifts from it.
const SWATCH_KEYS = ["bg", "surface", "text", "brand"];

// Flat light_*/dark_* keys, the shape a hub payload's `colors` object uses --
// but only the swatch keys. The templates keep all 62; this copy is downloaded
// by every visitor to the store and the store reads no others. Applying a
// built-in preset does not go through here at all: the browser sends a name and
// apply_theme_preset reads the full template on the router.
const flatColors = (preset) => {
  const out = {};
  for (const mode of ["light", "dark"])
    for (const key of SWATCH_KEYS) {
      const hex = presets[preset][mode][key];
      if (hex === undefined)
        throw new Error(`${preset}: ${mode} is missing the swatch key ${key}`);
      out[`${mode}_${key}`] = hex;
    }
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
  browserPresets[preset] = {
    colors: flatColors(preset),
    layout,
    typography,
    toolbar: toolbarOf(preset, source),
  };
}

// Browser copy for the Marketplace's built-in preset cards. Same data as the
// templates, projected into the hub's payload shape; regenerated together so
// the two can never drift.
mkdirSync(dirname(SRC_PRESETS), { recursive: true });
const presetsJson = JSON.stringify({ presets: browserPresets }, null, 2) + "\n";
writeFileSync(SRC_PRESETS, presetsJson, "utf8");
console.log("gen-presets: wrote .dev/src/resource/aurora/presets.json");

// Stamp a content hash into marketplace.js, which appends it as ?v= when fetching
// the file above. uhttpd dates every static resource at the epoch and sends no
// Cache-Control, so a browser's heuristic freshness for it runs to years and it
// never revalidates -- without this stamp, a change here reaches nobody who has
// already opened the store. Same mechanism sync-tokens.mjs uses for the token
// engine; tests/builtin-presets.test.mjs checks the two agree.
const hash = createHash("sha256").update(presetsJson).digest("hex").slice(0, 8);
const stampLine = `const PRESETS_VERSION = "${hash}";`;
const galleryPath = resolve(root, ".dev/src/resource/view/aurora/marketplace.js");
const gallery = readFileSync(galleryPath, "utf8").replace(
  /const PRESETS_VERSION = "[^"]*";/,
  stampLine,
);
if (!gallery.includes(stampLine))
  throw new Error("PRESETS_VERSION marker not found in marketplace.js");
writeFileSync(galleryPath, gallery, "utf8");
console.log(`gen-presets: stamped PRESETS_VERSION=${hash} into marketplace.js`);
