// A built-in preset is a whole look, not a palette. Before this, all five
// templates carried nothing but 62 colour options, so "Sage Green" and
// "Monochrome" differed by hue alone while the theme's navigation shape,
// corner radius, spacing, content width and typography -- everything the
// settings page can actually configure -- stayed wherever the user had left
// them. These tests hold the three halves of that fix together: the templates
// carry the structure, rpcd applies it, and the Marketplace's offline copy
// says the same thing the templates do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

const PRESET_IDS = ["default", "sage-green", "amber-sand", "monochrome", "sky-blue"];

// Duplicated from PRESET_STRUCT_KEYS in root/usr/libexec/rpcd/luci.aurora and
// from LAYOUT_KEYS/TYPOGRAPHY_KEYS in scripts/gen-presets.mjs. A test below
// asserts the shell list matches this one.
const LAYOUT_KEYS = [
  "nav_type",
  "struct_spacing",
  "struct_radius_base",
  "struct_content_width_centered",
  "toolbar_enabled",
];
const TYPOGRAPHY_KEYS = ["struct_font_sans", "struct_font_mono"];
const STRUCT_KEYS = LAYOUT_KEYS.concat(TYPOGRAPHY_KEYS);

const templateOf = (id) => read(`root/usr/share/aurora/${id}.template`);

const readOption = (source, key) => {
  const match = new RegExp(`^\\s*option\\s+${key}\\s+'([^']*)'`, "m").exec(source);
  return match ? match[1] : null;
};

const structOf = (id) => {
  const source = templateOf(id);
  return STRUCT_KEYS.reduce((acc, key) => {
    acc[key] = readOption(source, key);
    return acc;
  }, {});
};

const toolbarOf = (source) => {
  const items = [];
  let current = null;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (/^config\s+toolbar_item\s*$/.test(line)) {
      if (current) items.push(current);
      current = {};
      continue;
    }
    if (/^config\s/.test(line)) {
      if (current) items.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const m = line.match(/^option\s+(title|url|icon|enabled)\s+'([^']*)'/);
    if (m && m[2] !== "") current[m[1]] = m[2];
  }
  if (current) items.push(current);
  return items.map((it) =>
    it.icon
      ? { title: it.title, url: it.url, icon: it.icon, enabled: it.enabled }
      : { title: it.title, url: it.url, enabled: it.enabled },
  );
};

const rpcd = read("root/usr/libexec/rpcd/luci.aurora");
const gallery = read(".dev/src/resource/view/aurora/marketplace.js");
const browserPresets = JSON.parse(
  read(".dev/src/resource/aurora/presets.json"),
).presets;

test("every preset template carries the full structural block", () => {
  for (const id of PRESET_IDS) {
    const struct = structOf(id);
    for (const key of STRUCT_KEYS)
      assert.ok(
        struct[key],
        `${id}.template is missing option ${key} -- load_preset_struct_snapshot ` +
          `rejects a partial preset, so this template would fail to apply at all`,
      );
  }
});

// The same bounds validate_and_apply_hub_payload enforces on an inbound hub
// configuration. A preset that could write a value the hub rejects would mean
// the package held two different definitions of a valid look.
test("preset structure values stay inside the bounds the hub path enforces", () => {
  const rem = (value) => {
    assert.match(value, /^[0-9]+(\.[0-9]+)?rem$/);
    return parseFloat(value);
  };

  for (const id of PRESET_IDS) {
    const s = structOf(id);
    assert.ok(
      ["mega-menu", "dropdown", "sidebar"].includes(s.nav_type),
      `${id}: unknown nav_type ${s.nav_type}`,
    );
    assert.ok(["0", "1"].includes(s.toolbar_enabled), `${id}: bad toolbar_enabled`);

    const spacing = rem(s.struct_spacing);
    assert.ok(spacing >= 0.05 && spacing <= 1, `${id}: spacing out of range`);

    const radius = rem(s.struct_radius_base);
    assert.ok(radius >= 0 && radius <= 2, `${id}: radius out of range`);

    const width = rem(s.struct_content_width_centered);
    assert.ok(width >= 40 && width <= 160, `${id}: content width out of range`);

    // The settings page writes these through range inputs, so a preset landing
    // between two stops would snap to a different value the first time anyone
    // touches the slider -- and the config would silently stop matching the
    // preset it says is active.
    assert.equal(
      Math.round(spacing * 100) % 5,
      0,
      `${id}: spacing must sit on the 0.05rem slider step`,
    );
    assert.equal(
      Math.round(radius * 1000) % 125,
      0,
      `${id}: radius must sit on the 0.125rem slider step`,
    );
    assert.equal(width % 1, 0, `${id}: content width must sit on the 1rem slider step`);

    // Written into a single-quoted `uci batch` line; is_valid_font_stack
    // rejects a literal quote, and so does this.
    for (const key of TYPOGRAPHY_KEYS) {
      assert.ok(s[key].length <= 200, `${id}: ${key} too long`);
      assert.match(s[key], /^[A-Za-z0-9 ,"-]+$/, `${id}: ${key} has illegal characters`);
    }
  }
});

// The whole point of the change. Colour-only presets were five paint jobs on
// one layout; if a new preset ships without pulling any other lever, the store
// is back to selling hues.
test("the five presets are five different looks, not five palettes", () => {
  const structs = PRESET_IDS.map(structOf);

  const distinct = (key) => new Set(structs.map((s) => s[key])).size;

  assert.ok(distinct("nav_type") >= 3, "all three navigation shapes should be on offer");
  assert.equal(distinct("struct_radius_base"), 5, "every preset should own its corner radius");
  assert.equal(distinct("struct_font_sans"), 5, "every preset should own its sans typeface");
  assert.ok(distinct("struct_spacing") >= 3, "all three spacing stops should be on offer");
  assert.ok(distinct("struct_content_width_centered") >= 3, "content width should vary");
  assert.equal(distinct("toolbar_enabled"), 2, "at least one preset should turn the toolbar off");

  // No two presets may agree on their entire structure: that would be two
  // names for one look.
  const signatures = structs.map((s) => JSON.stringify(s));
  assert.equal(new Set(signatures).size, PRESET_IDS.length);
});

// Spacing scales the padding and gaps of every component at once, so it is the
// lever with the least room to be wrong: three stops are usable and one
// combination is not. A looser scale needs somewhere to breathe, and the
// sidebar shell has none -- its first column already eats the horizontal
// margin and the page runs full-width, so 0.3rem there reads as the layout
// having come apart rather than as a roomier theme. It belongs on a centred
// layout with a wide content column.
const SPACING_STOPS = ["0.2rem", "0.25rem", "0.3rem"];

test("spacing stays on its three stops, and the loose one avoids the sidebar", () => {
  assert.equal(
    structOf("default").struct_spacing,
    "0.25rem",
    "the default preset ships the middle stop",
  );

  const defaultWidth = parseFloat(structOf("default").struct_content_width_centered);

  for (const id of PRESET_IDS) {
    const s = structOf(id);
    assert.ok(
      SPACING_STOPS.includes(s.struct_spacing),
      `${id}: ${s.struct_spacing} is not one of ${SPACING_STOPS.join(" / ")}`,
    );

    if (s.struct_spacing !== "0.3rem") continue;

    assert.notEqual(
      s.nav_type,
      "sidebar",
      `${id}: the loose spacing must not ride on the sidebar shell`,
    );
    assert.ok(
      parseFloat(s.struct_content_width_centered) > defaultWidth,
      `${id}: the loose spacing needs a content column wider than the default ` +
        `${defaultWidth}rem to sit in`,
    );
  }
});

// The font stack is how the device reverse-maps a configuration back to a
// roster entry (resolve_font_preset_id / get_font_preset_by_stack). A stack
// retyped by hand instead of copied would resolve to nothing: the settings
// page would show the wrong font, and sync_and_cache_fonts_from_uci would
// never fetch the woff2 files, so the preset would silently render its
// fallback family.
test("every preset font stack is a verbatim font-presets.conf roster stack", () => {
  const roster = { sans: new Map(), mono: new Map() };
  const files = new Set();
  for (const line of read("root/usr/share/aurora/font-presets.conf").split("\n")) {
    const parts = line.split("|");
    if (parts[0] === "font") roster[parts[1]]?.set(parts[6], parts[2]);
    if (parts[0] === "file") files.add(`${parts[1]}/${parts[2]}`);
  }

  for (const id of PRESET_IDS) {
    const s = structOf(id);
    for (const slot of ["sans", "mono"]) {
      const fontId = roster[slot].get(s[`struct_font_${slot}`]);
      assert.ok(fontId, `${id}: struct_font_${slot} matches no ${slot} roster entry`);

      // marketplace.js reads typography.font_* to decide whether to warn that the
      // typeface has to be downloaded first, treating exactly "default" and
      // "system" as already on the router. That rule only holds while those
      // two ids are the ones with no woff2 files to fetch.
      const bundled = fontId === "default" || fontId === "system";
      assert.equal(
        files.has(`${slot}/${fontId}`),
        !bundled,
        `${slot}/${fontId}: BUNDLED_FONT_IDS in marketplace.js assumes only ` +
          `default/system need no download`,
      );
    }
  }
});

test("rpcd applies the same structural keys the templates carry", () => {
  const declared = /readonly PRESET_STRUCT_KEYS="([^"]+)"/.exec(rpcd);
  assert.ok(declared, "PRESET_STRUCT_KEYS is not declared");
  assert.deepEqual(
    declared[1].split(/\s+/).filter(Boolean).sort(),
    STRUCT_KEYS.slice().sort(),
  );

  // The colour snapshot alone is not enough any more: apply_theme_preset
  // writes one flat list, and the structural half has to be in it.
  assert.match(
    rpcd,
    /struct=\$\(load_preset_struct_snapshot "\$template"\) \|\| \{ PRESET_SNAPSHOT=""; return 1; \}/,
    "load_preset_snapshot must fail the whole preset when its structure is unusable",
  );

  const start = rpcd.indexOf('"apply_theme_preset")');
  const applyBlock = rpcd.slice(start, rpcd.indexOf('"export_config")', start));
  assert.match(applyBlock, /backup_if_mine/, "删之前必须先留底");
  assert.match(
    applyBlock,
    /delete aurora\.@toolbar_item\[0\]/,
    "applying a built-in preset replaces the shortcuts with its own",
  );
  assert.match(applyBlock, /load_preset_toolbar "\$template"/);
});

// PRESET_SNAPSHOT is one flat list now that it carries structure as well as
// colour. get_theme_preset publishes it grouped the way a hub payload groups
// the same fields -- an object called "colors" holding nav_type would sit
// undetected until something iterated it, because the settings UI only ever
// looks colours up by key.
test("get_theme_preset publishes the snapshot grouped, not dumped into colors", () => {
  const start = rpcd.indexOf("json_add_theme_preset_snapshot() {");
  assert.ok(start !== -1, "json_add_theme_preset_snapshot not found");
  // The top-level dispatcher, not one of the `case "$1" in` lines inside a
  // function -- those all sit above this one and would slice to nothing.
  const fn = rpcd.slice(start, rpcd.indexOf('\ncase "$1" in'));
  assert.ok(fn.length, "the function body is empty");

  for (const group of ["colors", "layout", "typography"])
    assert.match(fn, new RegExp(`json_add_object "${group}"`), `missing ${group} group`);

  assert.match(
    fn,
    /light_\*\|dark_\*\) json_add_string/,
    "the colors object must take only the colour keys",
  );
  assert.match(fn, /struct_font_sans\|struct_font_mono\) json_add_string/);
  assert.ok(
    !/\[ -n "\$key" \] && json_add_string/.test(fn),
    "the unfiltered dump would put struct_* keys inside colors",
  );
});

test("applying a preset fetches the typeface it names", () => {
  assert.match(rpcd, /sync_and_cache_fonts_from_uci\(\)\s*\{/);
  assert.match(
    rpcd,
    /cache_font_slot "sans" "\$sans_preset"/,
    "the helper must download, not merely rewrite the CSS",
  );
  // Detached: it talks to the network and the rpc call must not wait on it.
  assert.match(rpcd, /\) <\/dev\/null >\/dev\/null 2>&1 &/);

  const start = rpcd.indexOf('"apply_theme_preset")');
  const applyBlock = rpcd.slice(start, rpcd.indexOf('"export_config")', start));
  assert.ok(
    applyBlock.indexOf('uci -q commit aurora') <
      applyBlock.indexOf("sync_and_cache_fonts_from_uci"),
    "apply_theme_preset must resync fonts after committing",
  );
});

test("the browser copy of the presets matches the templates", () => {
  assert.deepEqual(Object.keys(browserPresets).sort(), PRESET_IDS.slice().sort());

  for (const id of PRESET_IDS) {
    const entry = browserPresets[id];
    const struct = structOf(id);

    for (const key of LAYOUT_KEYS)
      assert.equal(entry.layout[key], struct[key], `${id}: layout.${key} drifted`);
    for (const key of TYPOGRAPHY_KEYS)
      assert.equal(entry.typography[key], struct[key], `${id}: typography.${key} drifted`);

    // The hub's payload shape, so the store reads a built-in preset with the
    // accessors it already uses for a shared configuration.
    assert.ok(Array.isArray(entry.toolbar), `${id}: toolbar must be an array`);
    assert.deepEqual(
      entry.toolbar,
      toolbarOf(templateOf(id)),
      `${id}: toolbar drifted from the template`,
    );
    assert.ok(entry.toolbar.length > 0, `${id}: every preset ships its own shortcuts`);
    for (const key of Object.keys(entry.colors))
      assert.equal(
        entry.colors[key],
        readOption(templateOf(id), key),
        `${id}: colors.${key} drifted from the template`,
      );
  }
});

// The browser copy is downloaded by every visitor to the store; the templates
// are not. So it carries only what the store reads, and the store reads only
// the swatch keys -- applying a built-in preset goes through
// apply_theme_preset, which reads the full template on the router. Shipping all
// 62 colours cost 7,968 bytes that nothing looked at.
test("the browser copy carries exactly the swatch keys the store reads", () => {
  const declared = /const SWATCH_KEYS = \[([^\]]*)\]/.exec(gallery);
  assert.ok(declared, "marketplace.js no longer declares SWATCH_KEYS");
  const swatchKeys = [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(swatchKeys.length > 0, "SWATCH_KEYS parsed empty");

  const expected = ["light", "dark"]
    .flatMap((mode) => swatchKeys.map((key) => `${mode}_${key}`))
    .sort();

  for (const id of PRESET_IDS) {
    assert.deepEqual(
      Object.keys(browserPresets[id]).includes("colors")
        ? Object.keys(browserPresets[id].colors).sort()
        : null,
      expected,
      `${id}: the browser copy must carry the store's swatch keys and nothing else ` +
        `-- add a key to SWATCH_KEYS and gen-presets.mjs must follow, or the ` +
        `card renders a blank swatch`,
    );
  }
});

test("the Marketplace no longer promises that a preset only repaints", () => {
  assert.ok(
    !gallery.includes("Layout (unchanged by this preset)"),
    "the built-in drawer must show the preset's own layout, not the current one",
  );
  assert.ok(
    !/Presets set the light and dark colors only/.test(gallery),
    "the apply confirmation must stop claiming a preset changes colours alone",
  );
  assert.match(
    gallery,
    /const buildLayoutRows = /,
    "built-in and community drawers must share one layout table",
  );
  assert.match(
    gallery,
    /buildLayoutRows\(preset\.preview\.layout \|\| \{\}, typography\)/,
    "the built-in drawer must render that table",
  );
  // The card advertises "Works offline"; a preset naming a Fontsource family
  // is not fully offline until the woff2 files land.
  assert.match(gallery, /const needsFontDownload = /);
  assert.match(gallery, /const BUNDLED_FONT_IDS = \["default", "system"\]/);
});

// The shape of presets.json changed once already (151e50a moved it from
// {light,dark} to {colors,layout,typography,toolbar}), and browsers kept
// serving the old one for months: uhttpd reports Last-Modified as the epoch
// and sends no Cache-Control, so a browser's heuristic freshness works out to
// roughly 5.6 years and it never revalidates. A cached copy of the old shape
// renders every built-in card with the fallback palette and a top nav bar --
// no colours, no sidebar, no font chip -- and nothing in the UI says why.
//
// So the fetch carries a content hash, the way theme.js does for the token
// engine. gen-presets.mjs stamps it; this checks the two agree.
test("the store cache-busts presets.json with a hash of its contents", () => {
  const data = read(".dev/src/resource/aurora/presets.json");
  const expected = createHash("sha256").update(data).digest("hex").slice(0, 8);

  const stamped = /const PRESETS_VERSION = "([^"]+)";/.exec(gallery)?.[1];
  assert.ok(stamped, "marketplace.js declares PRESETS_VERSION");
  assert.equal(
    stamped,
    expected,
    "PRESETS_VERSION is stale -- rerun `pnpm gen-presets`",
  );

  assert.match(
    gallery,
    /L\.resource\("aurora\/presets\.json"\)\s*\+\s*"\?v="\s*\+\s*PRESETS_VERSION/,
    "the fetch must carry the stamp, or browsers keep the copy they already have",
  );
});
