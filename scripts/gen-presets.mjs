// Regenerate the preset templates under root/usr/share/aurora/ from
// scripts/aurora-presets.json -- resolved preset values precomputed at
// @eamonxg/luci-theme-tokens build time (inputs rounded to hex first, then
// derived, so stored == what the config UI recomputes; see the package's
// build.mjs). This script only formats and injects UCI option lines.
//
// Zero dependencies / no build step. Run:  node scripts/gen-presets.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PRESET_DIR = resolve(root, "root/usr/share/aurora");

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
  writeFileSync(path, out.join("\n"), "utf8");
  console.log(`gen-presets: wrote ${templateFile}`);
}
