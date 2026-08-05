#!/usr/bin/env node
// Sync po/<lang>/aurora-config.po against the regenerated template: drop
// entries the template no longer lists, append the ones it gained, and leave
// every existing translation untouched.
//
// Translations for the new strings come from translations.json next to this
// script. A language missing an entry leaves msgstr empty rather than shipping
// an English string dressed as a translation.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This script lives in .dev/scripts; the catalogues it edits are at the repo
// root, so nothing here may depend on the working directory.
const here = dirname(fileURLToPath(import.meta.url));
const at = (relPath) => join(here, "../..", relPath);

const POT = at("po/templates/aurora-config.pot");
const TABLE = join(here, "translations.json");

const parsePo = (text) => {
  const entries = [];
  let refs = [];
  let msgid = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("#:")) refs.push(line);
    else if (line.startsWith("msgid ")) msgid = line.slice(7, -1);
    else if (line.startsWith("msgstr ") && msgid !== null) {
      entries.push({ refs, msgid, msgstr: line.slice(8, -1) });
      refs = [];
      msgid = null;
    }
  }
  return entries;
};

const potText = await readFile(POT, "utf8");
const potEntries = parsePo(potText).filter((e) => e.msgid !== "");
const table = JSON.parse(await readFile(TABLE, "utf8"));

const langs = [
  "de", "es", "fr", "id", "it", "ja", "ko",
  "nl", "pl", "ru", "tr", "uk", "zh_Hans", "zh_Hant",
];

for (const lang of langs) {
  const path = at(`po/${lang}/aurora-config.po`);
  const existing = new Map(
    parsePo(await readFile(path, "utf8"))
      .filter((e) => e.msgid !== "")
      .map((e) => [e.msgid, e.msgstr]),
  );

  let out = 'msgid ""\nmsgstr "Content-Type: text/plain; charset=UTF-8"\n';
  let added = 0;
  let untranslated = 0;

  for (const entry of potEntries) {
    // An entry that exists but was never filled in counts as missing: a blank
    // msgstr ships the English string, which is exactly what the table is for.
    let msgstr = existing.get(entry.msgid);
    if (!msgstr) {
      if (msgstr === undefined) added += 1;
      msgstr = table[entry.msgid]?.[lang] ?? "";
      if (!msgstr) untranslated += 1;
    }
    out += "\n";
    for (const ref of entry.refs) out += `${ref}\n`;
    out += `msgid "${entry.msgid}"\nmsgstr "${msgstr}"\n`;
  }

  await writeFile(path, out);
  const dropped = [...existing.keys()].filter(
    (id) => !potEntries.some((e) => e.msgid === id),
  ).length;
  console.log(
    `${lang}: ${potEntries.length} entries (+${added} new, -${dropped} obsolete` +
      (untranslated ? `, ${untranslated} UNTRANSLATED` : "") +
      ")",
  );
}
