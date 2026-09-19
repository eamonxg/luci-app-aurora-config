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
  // One primary action; export, import and reset sit behind "More".
  assert.match(
    src,
    /shareButton,\s*buildMoreMenu\(\[exportItem, importItem, E\("li", \{ role: "separator", class: "sep" \}\), resetItem\]\),/,
  );
});

// ---------------------------------------------------------------------------
// Header: a quiet version line, one primary action, the rest behind "More"

const headerBlock = (src) =>
  src.slice(src.indexOf("    const versionEntry ="), src.indexOf("    m.description = headerBar;"));

test("header: each package is its muted name, then its full installed version in the theme's green .label", async () => {
  const src = await readFile(SRC, "utf8");
  const head = headerBlock(src);
  assert.match(head, /E\("span", attrs, \[\s*E\("b", \{\}, label\),/);
  // Current is the theme's own success colour, and the version is shown whole.
  assert.match(head, /\{ class: installed \? "label success" : "label" \},\s*installed \|\| _\("Unknown"\),/);
  assert.ok(!src.includes("shortVersion"));
  assert.match(head, /versionEntry\(\{ id: "theme-version" \}, _\("Theme"\), installedVersions\?\.theme\?\.installed_version\)/);
  assert.match(head, /versionEntry\(\{ id: "config-version" \}, _\("Config"\), installedVersions\?\.config\?\.installed_version\)/);
  assert.match(head, /const versionArea = E\("div", \{ class: "aurora-studio-versions" \}/);
  // Nothing about an update exists until the manifest says so.
  for (const later of ['"arrow"', '"up"', 'E("a"', '"label warning"']) assert.ok(!head.includes(later), later);
  // The old separate pill and the "Theme: " prefixes are gone for good.
  for (const gone of ['_("Update available %s")', "`v${", '_("Theme: ")', '_("Config: ")'])
    assert.ok(!src.includes(gone), gone);
});

test("header: a newer build turns that package's label to warning and hangs → link after it; the other stays green", async () => {
  const src = await readFile(SRC, "utf8");
  const block = src.slice(src.indexOf("const showUpdateCapsule ="), src.indexOf('const s = m.section(form.NamedSection'));
  assert.match(block, /\["luci-theme-aurora", "theme-version", installedVersions\?\.theme\?\.installed_version\],/);
  assert.match(block, /\["luci-app-aurora-config", "config-version", installedVersions\?\.config\?\.installed_version\],/);
  assert.match(block, /packages\.forEach\(\(\[pkg, id, installed\]\) => \{/);
  assert.match(block, /feedCheck\.findManifestVersion\(\s*manifest,\s*channel,\s*format,\s*pkg,\s*\)/);
  // Versions that cannot be ordered say nothing at all: the label stays green, no arrow, no link.
  assert.match(block, /if \(!feedCheck\.isNewer\(installed, available\)\) return;/);
  assert.match(block, /const entry = versionArea\.querySelector\("#" \+ id\);/);
  assert.match(
    block,
    /entry\.classList\.add\("up"\);\s*entry\.querySelector\("\.label"\)\.className = "label warning";\s*entry\.appendChild\(E\("span", \{ class: "arrow", "aria-hidden": "true" \}, "→"\)\);/,
  );
  assert.match(block, /E\("a", \{ href: L\.url\(packagePagePath\) \}, \[label\]\)/);
  assert.match(block, /const label = _\("%s available"\)\.format\(available\);/);
  assert.match(src, /const packagePagePath = feedCheck\.pickPackageManagerPath\(menuTree\);/);
  assert.ok(!block.includes("innerHTML"));
  // It stays on this line: nothing here feeds the inbox or the header count.
  for (const inboxHook of ["inboxIndicator", "hubApi", "noticesCache", "setNoticesLocal"])
    assert.ok(!src.includes(inboxHook), inboxHook);
});

test("header: the row's colours are the theme's .label classes; the new rules only space and align", async () => {
  const src = await readFile(SRC, "utf8");
  const css = src.slice(src.indexOf("const ensureToolbarStyles"), src.indexOf("const ensureBgCardStyles"));
  const rowRules = [...css.matchAll(/^(\.aurora-studio-versions[^{]*) \{([^}]*)\}/gm)];
  const label = rowRules.find((m) => m[1] === ".aurora-studio-versions .label");
  assert.ok(label, "the label only gets spacing and numerals");
  assert.deepEqual(
    label[2].trim().split(/;\s*/).filter(Boolean).map((d) => d.split(":")[0].trim()).sort(),
    ["font-variant-numeric", "margin-left"],
  );
  const arrow = rowRules.find((m) => m[1] === ".aurora-studio-versions .arrow");
  assert.ok(arrow && !/color|background/.test(arrow[2]), "the arrow inherits the muted row colour");
  // No colour of our own on any label: success and warning are the theme's.
  assert.ok(!/\.label\.(success|warning)|\.label[^{]*\{[^}]*(color|background)/.test(css));
  assert.match(css, /\.aurora-studio-versions \{\s*color: var\(--text-subtle,/);
  assert.match(css, /\.aurora-studio-versions b \{\s*color: var\(--text-muted,/);
});

test("header: Share is the one button; Export, Import and Reset are menu items with their handlers intact", async () => {
  const src = await readFile(SRC, "utf8");
  const bar = src.slice(src.indexOf("const buildConfigToolbarNode ="), src.indexOf("const buildMoreMenu ="));
  assert.equal((bar.match(/E\(\s*"button",\s*\{\s*class: "cbi-button/g) || []).length, 1);
  assert.match(bar, /class: "cbi-button cbi-button-action",\s*click: \(\) => \{\s*window\.location\.href =/);
  for (const [name, label] of [
    ["exportItem", "Export configuration"],
    ["importItem", "Import configuration"],
    ["resetItem", "Reset everything to defaults"],
  ]) {
    const item = bar.slice(bar.indexOf(`const ${name} = E(`));
    assert.match(item, /^const \w+ = E\(\s*"li",\s*\{\s*role: "menuitem",\s*tabindex: "-1",/);
    assert.ok(bar.includes(`_("${label}")`), label);
  }
  assert.match(bar, /const resetItem = E\(\s*"li",\s*\{\s*role: "menuitem",\s*tabindex: "-1",\s*class: "danger",/);
  // Same flows as before: only the entry points moved.
  assert.match(bar, /L\.resolveDefault\(callExportConfig\(\), null\)/);
  assert.match(bar, /\.uploadFile\(CONFIG_IMPORT_PATH, btn\)/);
  assert.match(bar, /ui\.showModal\(_\("Import Aurora Configuration\?"\)/);
  assert.match(bar, /L\.resolveDefault\(\s*callImportConfig\(\),/);
  assert.match(bar, /ui\.showModal\(_\("Reset All Aurora Settings"\)/);
  assert.match(bar, /L\.resolveDefault\(callResetDefaults\(\), \{\}\)/);
  // No version text in the menu.
  assert.ok(!/installed_version|shortVersion/.test(bar));
});

test("header: the More menu is LuCI's dropdown shell, made operable as a menu", async () => {
  const src = await readFile(SRC, "utf8");
  const menu = src.slice(src.indexOf("const buildMoreMenu ="), src.indexOf("const FONT_DEFAULT_STACKS") > src.indexOf("const buildMoreMenu =") ? src.indexOf("const FONT_DEFAULT_STACKS") : src.indexOf("const versionEntry ="));
  assert.match(menu, /class: "dropdown", role: "menu", id: "aurora-studio-more-menu", tabindex: "-1"/);
  assert.match(menu, /class: "cbi-dropdown cbi-button aurora-studio-more",/);
  for (const attr of ['role: "button"', 'tabindex: "0"', '"aria-label": _("More")', '"aria-haspopup": "menu"', '"aria-expanded": "false"', '"aria-controls": menu.id'])
    assert.ok(menu.includes(attr), attr);
  // [open] is what every theme's .cbi-dropdown > ul.dropdown keys its popover on.
  assert.match(menu, /toggle\.setAttribute\("open", ""\);\s*toggle\.setAttribute\("aria-expanded", "true"\);/);
  assert.match(menu, /toggle\.removeAttribute\("open"\);\s*toggle\.setAttribute\("aria-expanded", "false"\);/);
  assert.match(menu, /entries\(\)\[0\]\.focus\(\);/);
  assert.match(menu, /if \(ev\.key === "Escape" && isOpen\) close\(true\);/);
  assert.match(menu, /if \(refocus\) toggle\.focus\(\);/);
  assert.match(menu, /\["ArrowDown", "ArrowUp", "Home", "End"\]\.includes\(ev\.key\)/);
  assert.match(menu, /else if \(ev\.key === "Tab"\) close\(false\);/);
  assert.match(menu, /if \(!toggle\.contains\(ev\.target\)\) close\(false\);/);
  assert.match(menu, /document\.addEventListener\("click", onOutside\);/);
  assert.match(menu, /document\.removeEventListener\("click", onOutside\);/);
  assert.match(menu, /if \(menu\.contains\(ev\.target\)\) close\(false\);/);
});

test("header: the new rules cover only what the theme's dropdown and buttons cannot say", async () => {
  const src = await readFile(SRC, "utf8");
  const css = src.slice(src.indexOf("const ensureToolbarStyles"), src.indexOf("const ensureBgCardStyles"));
  // The popover surface, its items and their hover are the theme's.
  for (const themeOwned of ["surface-overlay", "box-shadow", "backdrop", "border-radius: 1", ":hover {\n  background"])
    assert.ok(!css.includes(themeOwned), themeOwned);
  assert.match(css, /\.cbi-dropdown\.aurora-studio-more > ul\.dropdown \{\s*left: auto;\s*min-width: 0;\s*right: 0;\s*top: calc\(100% \+ 6px\);\s*width: min\(280px, calc\(100vw - 32px\)\);/);
  assert.match(css, /li\.danger \{\s*color: var\(--danger,/);
  const phone = css.slice(css.indexOf("@media (max-width: 600px) {"));
  assert.match(phone, /\.aurora-studio-acts \{\s*flex: 1 1 100%;/);
  assert.match(phone, /\.aurora-studio-acts > \.cbi-button:not\(\.aurora-studio-more\) \{\s*flex: 1;\s*min-height: 42px;/);
  assert.match(phone, /\.cbi-dropdown\.aurora-studio-more \{\s*height: 42px;\s*width: 42px;/);
  assert.match(phone, /@media \(max-width: 600px\), \(hover: none\) \{[\s\S]*li\[role="menuitem"\] \{\s*min-height: 42px;/);
});

test("the closed more-menu list takes no space", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /\.cbi-dropdown\.aurora-studio-more:not\(\[open\]\) > ul\.dropdown \{\s*display: none;\s*\}/);
});
