#!/usr/bin/env node
// Regenerate po/templates/aurora-config.pot from the translatable strings in
// this package.
//
// LuCI's own i18n-scan.pl lives in the OpenWrt build tree, which is not a
// dependency of this repo -- so the template used to be refreshed by hand and
// drifted from the source. This reproduces the same output: entries sorted by
// msgid, each preceded by "#:" references relative to the LuCI feed root.
//
// Two things the naive version of this script got wrong, both caught by
// diffing against the previous template:
//   * _() calls routinely wrap across lines, so the scan runs over whole file
//     text rather than line by line;
//   * menu.d and acl.d titles/descriptions are translatable too, and LuCI's
//     scanner picks them up from the JSON.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Paths are held as repo-relative strings because they end up verbatim in the
// "#:" reference lines, but they are read through REPO so the script works from
// any working directory (it lives in .dev/scripts, two levels down).
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const at = (relPath) => join(REPO, relPath);

const PREFIX = "applications/luci-app-aurora-config";
const OUT = "po/templates/aurora-config.pot";
const JS_SCAN = ".dev/src/resource";
// The "#:" references keep naming the installed path: that is where a reader
// of the shipped package finds the string, and holding it steady keeps this
// move out of the .pot and all 15 .po files.
const JS_REF = "htdocs/luci-static/resources";
const JSON_ROOTS = ["root/usr/share/luci/menu.d", "root/usr/share/rpcd/acl.d"];

async function walk(dir, ext) {
  const found = [];
  for (const entry of await readdir(at(dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path, ext)));
    else if (entry.name.endsWith(ext)) found.push(path);
  }
  return found.sort();
}

// _("...") / _('...'), tolerating newlines and indentation after the paren.
// Concatenated expressions are deliberately not stitched together: LuCI's
// scanner does not either, and a string it cannot see whole is one a
// translator could not use whole.
const CALL = /\b_\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;

const entries = new Map();
const record = (raw, file, line) => {
  // LuCI trims surrounding whitespace when it looks a string up, which is why
  // no msgid in the existing catalogue carries a trailing space even though
  // the source writes _("Theme: "). Emitting the untrimmed form would produce
  // keys that never resolve, silently dropping those translations.
  const msgid = raw.trim();
  if (!msgid) return;
  if (!entries.has(msgid)) entries.set(msgid, new Set());
  entries.get(msgid).add(`${PREFIX}/${file}:${line}`);
};

for (const file of await walk(JS_SCAN, ".js")) {
  const text = await readFile(at(file), "utf8");
  const ref = JS_REF + file.slice(JS_SCAN.length);
  for (const match of text.matchAll(CALL)) {
    const line = text.slice(0, match.index).split("\n").length;
    record(match[2], ref, line);
  }
}

for (const root of JSON_ROOTS) {
  for (const file of await walk(root, ".json")) {
    const text = await readFile(at(file), "utf8");
    text.split("\n").forEach((line, index) => {
      const match = /"(?:title|description)"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(line);
      if (match) record(match[1], file, index + 1);
    });
  }
}

const sorted = [...entries.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

let out = 'msgid ""\nmsgstr "Content-Type: text/plain; charset=UTF-8"\n';
for (const msgid of sorted) {
  out += "\n";
  for (const ref of [...entries.get(msgid)].sort()) out += `#: ${ref}\n`;
  out += `msgid "${msgid}"\nmsgstr ""\n`;
}

await writeFile(at(OUT), out);
console.log(`${OUT}: ${sorted.length} strings`);
