import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

const SRC = srcPath("view/aurora/studio.js");

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
    "studio.js must stop requiring theme-preview (marketplace.js still uses the file)",
  );
});

// LuCI already names this page in the tab strip directly above the content
// (menu.d: "Design Studio"). form.Map renders its own title as an <h2> right
// under that strip, so handing it one printed the same two words twice, a
// hand's width apart. The tab is the one that has to stay: it is how you get
// to the other page.
test("layout: the tab strip names the page, so the map carries no title", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /new form\.Map\("aurora"\)/, "form.Map must take no title");
  assert.ok(
    !/new form\.Map\("aurora",\s*_\(/.test(src),
    "no title string may be handed to form.Map",
  );
  // description is a separate slot in form.js and still renders on its own,
  // which is what keeps the version chips and the export/import/reset row.
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

test("layout: the header has no second Marketplace entry and no preset dropdown", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    !src.includes("Browse more themes in the Marketplace"),
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

test("the two engine scripts download in parallel and still execute in order", async () => {
  const source = await readFile(srcPath("view/aurora/studio.js"), "utf8");
  assert.match(
    source,
    /script\.async = false/,
    "a dynamically inserted script defaults to async; without this the two " +
      "engine files race and tokens.global.js can evaluate before Color exists",
  );
  assert.ok(
    !/await loadGlobalScript\("utils\/color\.global\.js"\);\s*\n\s*if \(typeof AuroraTokens/.test(
      source,
    ),
    "awaiting the first script before requesting the second costs a second round trip",
  );
});

// 发布的起点在工作台,不在商店。导出/导入/重置都是对"整套配置"动手,分享是
// 同一族的事 —— 导出是存给自己,分享是发给别人。商店那边三处发布入口因此
// 全部删掉(见 marketplace-view.test.mjs)。
test("studio: publishing starts here, next to export/import", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /_\("Share to the store"\)/);
  // 意图用 URL 参数传,不用 sessionStorage:刷新、回退、收藏行为都可预测。
  assert.match(src, /L\.url\("admin\/system\/aurora\/marketplace"\)/);
  assert.match(src, /"\?share=1"/);
  assert.match(src, /\[exportButton, importButton, shareButton, resetButton\]/);
});
