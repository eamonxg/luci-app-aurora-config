import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SRC = "htdocs/luci-static/resources/view/aurora/theme.js";

test("layout: the workbench shell is gone", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes("aurora-wb-"), "no aurora-wb-* class may remain");
  assert.ok(!src.includes("buildWorkbench"), "buildWorkbench must be deleted");
  assert.ok(!src.includes("WB_CSS"), "WB_CSS must be deleted");
  assert.ok(
    !src.includes("refreshPreview"),
    "the preview canvas hook must be deleted",
  );
  assert.ok(
    !/require utils\.theme-preview/.test(src),
    "theme.js must stop requiring theme-preview (gallery.js still uses the file)",
  );
});

test("layout: the map carries the page title again", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(
    src,
    /new form\.Map\("aurora", _\("Aurora Theme Settings"\)\)/,
    "the title belongs to form.Map, not a wrapper",
  );
  assert.match(src, /m\.description = headerBar/);
});

test("layout: handleReset restages colors instead of reloading the page", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    !/handleReset[\s\S]{0,400}window\.location\.reload/.test(src),
    "handleReset must not reload the page",
  );
  assert.match(src, /this\.super\("handleReset", \[ev\]\)/);
  assert.match(src, /this\.colorEditor\?\.schedule\("light"\)/);
  assert.match(src, /this\.colorEditor\?\.schedule\("dark"\)/);
});

test("layout: the header has no second Theme Store entry and no preset dropdown", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    !src.includes("Browse more themes in the Theme Store"),
    "tabmenu already links the store; a header button is a duplicate entry",
  );
  assert.ok(
    !src.includes("callApplyThemePreset"),
    "presets are the store's job now",
  );
  assert.match(src, /buildConfigToolbarNode/);
  assert.match(src, /id: "theme-version"/);
  assert.match(src, /id: "config-version"/);
  assert.match(
    src,
    /const versionArea = E\(/,
    "the version area must be a named node — the update capsule appends to it",
  );
});

test("colors: source tokens hang straight off the mode sub-tab", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    !src.includes("_base_colors"),
    "the Source Color Tokens SectionValue wrapper must be gone",
  );
  assert.ok(
    !src.includes("Source Color Tokens"),
    "its title string goes with it",
  );
  assert.match(
    src,
    /option: \(\.\.\.args\) => section\.taboption\(mode, \.\.\.args\)/,
    "source colors are added through a taboption adapter",
  );
});

test("colors: derived tokens keep exactly one wrapper, without a title", async () => {
  const src = await readFile(SRC, "utf8");
  const block = src.slice(
    src.indexOf("const createColorSections ="),
    src.indexOf("const colorGroupFor ="),
  );
  const wrappers = (block.match(/form\.SectionValue/g) || []).length;
  assert.equal(wrappers, 1, "only the derived group may keep a wrapper");
  assert.ok(
    !block.includes("Derived Color Tokens"),
    "the wrapper renders no title -- the fold's summary carries the label",
  );
});

test("colors: the format help moved to the sub-tab description", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(
    src,
    /colorSubsection\.tab\("light", _\("Light Mode"\), COLOR_TAB_HINT\)/,
  );
  assert.match(
    src,
    /colorSubsection\.tab\("dark", _\("Dark Mode"\), COLOR_TAB_HINT\)/,
  );
  assert.match(src, /const COLOR_TAB_HINT =/);
});

test("colors: token groups are borderless heading + rule, not boxes", async () => {
  const src = await readFile(SRC, "utf8");
  // The group itself declares only a margin -- no box around it.
  const box = /\.aurora-token-group,\n\.aurora-derived-fold \{([^}]*)\}/.exec(src);
  assert.ok(box, "the two folds should share one box rule");
  assert.ok(!/border/.test(box[1]), "the group box border is gone");
  assert.ok(!/border-radius/.test(box[1]), "the group box radius is gone");
  // The rule lives on the summary instead, shared by both folds.
  const summary = /\.aurora-token-group > summary,\n\.aurora-derived-fold > summary \{([^}]*)\}/.exec(src);
  assert.ok(summary, "both summaries should share one rule");
  assert.match(summary[1], /border-bottom:/, "the summary carries the dividing rule");
});

test("colors: derived tokens collapse into a single fold", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const enhanceDerivedFold = \(root\) => \{/);
  assert.match(src, /class: "aurora-derived-fold"/);
  assert.ok(
    !/aurora-derived-fold"[\s\S]{0,120}open: ""/.test(src),
    "the derived fold must start collapsed",
  );
  assert.match(
    src,
    /enhanceColorTokenGroups\(mapNode\);\s*\n\s*enhanceDerivedFold\(mapNode\);/,
    "the fold runs after the groups are built",
  );
});

test("nav: the style picker stays a ListValue so depends() keeps working", async () => {
  const src = await readFile(SRC, "utf8");
  const option = src.slice(
    src.indexOf('"nav_type",\n      _("Navigation Style")'),
    src.indexOf('"struct_spacing"'),
  );
  assert.match(option, /so\.widget = "radio"/, "radio widget, not a bare DOM control");
  assert.match(
    option,
    /so\.renderWidget = renderNavChoiceWidget/,
    "the option only points at the decorator",
  );

  const widget = src.slice(
    src.indexOf("const renderNavChoiceWidget ="),
    src.indexOf("const renderColorField ="),
  );
  assert.match(
    widget,
    /form\.ListValue\.prototype\.renderWidget\.apply\(this, arguments\)/,
    "the parent widget must still produce the inputs -- change/depends ride on it",
  );
});

test("nav: the wireframe goes before the input, never between input/label/text", async () => {
  const src = await readFile(SRC, "utf8");
  // ui.Select's radio markup is span.cbi-radio > [input, label, span(text)],
  // and the caption span's click handler walks previousElementSibling twice to
  // reach the input. Splitting that chain silently kills click-to-select.
  assert.match(src, /insertBefore\(drawing, input\)/);
  assert.ok(
    !/closest\("label"\)/.test(src),
    "there is no wrapping label in LuCI's radio markup",
  );
});

test("nav: three wireframes, no images, no network", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const NAV_CHOICE_WIREFRAMES = \{/);
  const block = src.slice(
    src.indexOf("const NAV_CHOICE_WIREFRAMES = {"),
    src.indexOf("const ensureNavChoiceStyles"),
  );
  ["mega-menu", "dropdown", "sidebar"].forEach((key) => {
    assert.ok(
      new RegExp(`"${key}":|${key}:`).test(block),
      `missing wireframe for ${key}`,
    );
  });
  assert.ok(!/<img|url\(|fetch\(/.test(block), "wireframes must be pure CSS");
});

test("nav: content width still depends on nav_type and is retained", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /so\.retain = true;/);
  assert.match(src, /so\.depends\("nav_type", "mega-menu"\);/);
  assert.match(src, /so\.depends\("nav_type", "dropdown"\);/);
});

test("layout: the three outer tabs are back", async () => {
  const src = await readFile(SRC, "utf8");
  // The workbench replaced these with an accordion. Restoring the map without
  // restoring them stacks every section into one endless page -- which no
  // source assertion caught, only a screenshot did.
  assert.match(src, /s\.tab\("colors", _\("Colors"\)\)/);
  assert.match(src, /s\.tab\("layout_typography", _\("Layout & Typography"\)\)/);
  assert.match(src, /s\.tab\("icons_branding", _\("Branding & Shortcuts"\)\)/);
  ["colorSection", "structureSection", "fontSection", "assetSection",
   "logoSection", "toolbarSection"].forEach((name) => {
    assert.match(
      src,
      new RegExp(`const ${name} = s\\.taboption\\(`),
      `${name} must hang off a tab, not the bare section`,
    );
  });
  assert.ok(
    !/= s\.option\(\s*\n\s*form\.SectionValue/.test(src),
    "no top-level SectionValue may bypass the tabs",
  );
});
