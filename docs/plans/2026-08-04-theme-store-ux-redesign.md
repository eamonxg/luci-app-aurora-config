# 主题商店 UX 重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主题商店的预览画出导航形态、让界面说清一份配置包含什么、把搜索区收敛成 LuCI 原生语汇、把分享从三字段弹窗改成带清单的常规表单区。

**Architecture:** 预览只画几何（4 个色值 + `nav_type`），其余内容（字体、圆角、Logo、登录背景图、站点图标、悬浮工具栏）走一排文字小块。这条分工让整个改动停留在客户端——只动 `theme-preview.js` 与 `gallery.js` 两个 JS 文件加 po 词条，不新增 rpcd 方法、不改 hub API、不引入任何新的网络请求。

**Tech Stack:** LuCI 客户端 JS（`"use strict"` + `require` 头 + `E()` DOM 构造，无构建步骤）、`node --test` 文本断言测试、`scripts/gen-pot.mjs` + `scripts/merge-po.mjs` 做 i18n。

设计依据：`docs/specs/2026-08-04-theme-store-ux-redesign.md`。

## Global Constraints

- **绝不使用 `innerHTML`。** `tests/gallery-view.test.mjs` 有一条测试断言 `gallery.js` 全文不含 `.innerHTML`。所有 hub 来源的文本必须经 `document.createTextNode()` 或 `E()` 的 textContent-safe children 渲染，颜色必须经 `themePreview.safeHex()` 后用 `style.backgroundColor =` 赋值。
- **文案只描述结果，不出现机制词。** 不得出现 job / schema / token / pending / bad_payload / 字节数 / uci key 名。已有测试 `share/update/delete copy stays result-only` 会检查。
- **所有面向用户的字符串必须包在 `_()` 里**，且新字符串要进 `scripts/translations.json`（Task 8）。
- **不修改任何 shell 代码。** `root/usr/libexec/rpcd/luci.aurora` 本次只读不写（rpcd 后端尚未在真机验证过，不给它加表面积）。
- **不修改 hub API、不动 `openwrt-cloud` 仓库。**
- **注入的 CSS 必须是静态字符串**，每个 `var()` 带 fallback（`STORE_CSS` 现有约定，保证非 Aurora 主题下不崩）。
- 测试命令统一是 `npm test`（`node --test tests/*.test.mjs`）。单文件跑：`node --test tests/gallery-view.test.mjs`。
- 提交信息用英文，不带任何 session 链接或私有元数据。

## File Structure

| 文件 | 职责 | 本次动作 |
|---|---|---|
| `htdocs/luci-static/resources/utils/theme-preview.js` | 纯 CSS 假页面缩略图，只吃颜色 + 导航形态 | 修改：`buildMini` 增加 `mega-menu` 分支 |
| `htdocs/luci-static/resources/view/aurora/gallery.js` | 商店页全部视图逻辑 | 修改：透传 nav、清单小块、双联抽屉预览、原生头部、内联分享面板 |
| `tests/theme-preview-module.test.mjs` | 预览模块的源码约束 | **新建** |
| `tests/gallery-view.test.mjs` | 商店视图的源码约束 | 修改：新增 5 条测试 |
| `scripts/translations.json` | 新 msgid 的各语言译文表 | 修改 |
| `po/templates/aurora-config.pot` + `po/*/aurora-config.po` | 词条 | 由脚本重新生成 |

**为什么不拆文件：** `gallery.js` 现在 1276 行，本次净增约 250 行。它是单一职责的（一个 LuCI view），且仓库里 `theme.js` 有 3000+ 行，拆分不符合既有惯例。清单渲染与预览渲染的复用部分放进 `theme-preview.js`（已经是共享模块）。

---

### Task 1: `buildMini` 画出三种导航形态

**Files:**
- Modify: `htdocs/luci-static/resources/utils/theme-preview.js:17-119`
- Test: `tests/theme-preview-module.test.mjs`（新建）

**Interfaces:**
- Consumes: 无（本次第一个任务）
- Produces: `buildMini(pal, opts)` 的 `opts.nav` 接受 `"sidebar"` / `"mega-menu"` / 其它（画普通顶栏）。`buildDuo(palette, opts)` 已经会把 `opts` 透传给两次 `buildMini` 调用，签名不变。

**背景：** `theme-preview.js:74` 的 `nav === "sidebar"` 分支从上线至今从未渲染过——唯一的调用方 `gallery.js:96` 把 `opts` 参数吃掉了（Task 2 修）。本任务先把三种形态都画对。

- [ ] **Step 1: 写失败的测试**

新建 `tests/theme-preview-module.test.mjs`：

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SRC = "htdocs/luci-static/resources/utils/theme-preview.js";

test("theme-preview draws all three nav_type shapes", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /nav === "sidebar"/, "missing sidebar branch");
  assert.match(src, /nav === "mega-menu"/, "missing mega-menu branch");
  // dropdown 走的是「其它一律顶栏」的默认分支,所以只断言注释写清了这件事
  assert.match(src, /dropdown/, "nav_type contract not documented");
});

test("theme-preview keeps geometry static and only colors variable", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes(".innerHTML"), "no innerHTML in preview module");
  // 每一处颜色赋值都必须先过 safeHex,不能把原始值拼进 style 字符串
  assert.match(src, /const safeHex = \(value, fallback\) =>/);
  assert.match(src, /HEX_RE\.test/);
});

test("theme-preview mega-menu panel shifts the content area down", async () => {
  const src = await readFile(SRC, "utf8");
  // 顶栏 16% + 面板 13% = 29%,内容区起点必须让开,不能还用顶栏的 24%
  assert.match(src, /37%/, "mega-menu content offset missing");
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/theme-preview-module.test.mjs`
Expected: FAIL — `missing mega-menu branch`

- [ ] **Step 3: 实现**

把 `theme-preview.js:17` 的注释和 `72-111` 行的分支结构改成下面这样。注意 `bar(width, pct, extra)` 是现有签名，第三个参数是追加的 CSS 片段。

```js
// opts.nav: "sidebar" draws a left rail; "mega-menu" draws the top bar plus
// the expanded panel that sits under it; anything else (notably "dropdown")
// draws the plain top bar. These are the three values validate_and_apply_hub_
// payload accepts, so the preview covers the whole enum.
```

```js
  let chromeNodes;
  let main;
  if (nav === "sidebar") {
    const rail = E(
      "div",
      {
        style:
          "position:absolute;left:0;top:0;bottom:0;width:22%;display:flex;" +
          "flex-direction:column;gap:8%;padding:6% 4%;box-sizing:border-box;",
      },
      [dot, bar("80%", 28, "height:7%;"), bar("90%", 28, "height:7%;"), bar("70%", 28, "height:7%;")],
    );
    rail.children[2].style.background = brand;
    rail.style.background = surface;
    rail.style.borderRight = "1px solid " + mixHex(text, 12);
    chromeNodes = [rail];
    main = E(
      "div",
      { style: "position:absolute;left:27%;top:7%;right:5%;bottom:0;" },
      content,
    );
  } else {
    const top = E(
      "div",
      {
        style:
          "position:absolute;left:0;right:0;top:0;height:16%;display:flex;" +
          "align-items:center;gap:4%;padding:0 4%;box-sizing:border-box;",
      },
      [dot, bar("18%", 55), bar("12%", 34), bar("12%", 34)],
    );
    top.style.background = surface;
    top.style.borderBottom = "1px solid " + mixHex(text, 12);
    chromeNodes = [top];

    // A mega menu is only distinguishable from a dropdown once its panel is
    // open, so the thumbnail draws it open.
    if (nav === "mega-menu") {
      const panel = E(
        "div",
        {
          style:
            "position:absolute;left:0;right:0;top:16%;height:13%;display:flex;" +
            "align-items:center;gap:3%;padding:0 4%;box-sizing:border-box;",
        },
        [
          bar("10%", 30, "height:26%;"),
          bar("14%", 30, "height:26%;"),
          bar("9%", 30, "height:26%;"),
          bar("12%", 30, "height:26%;"),
        ],
      );
      panel.style.background = surface;
      panel.style.borderBottom = "1px solid " + mixHex(text, 12);
      chromeNodes.push(panel);
    }

    main = E(
      "div",
      {
        style:
          "position:absolute;left:5%;top:" +
          (nav === "mega-menu" ? "37%" : "24%") +
          ";right:5%;bottom:0;",
      },
      content,
    );
  }

  const root = E(
    "div",
    { style: "position:absolute;inset:0;overflow:hidden;" },
    chromeNodes.concat([main]),
  );
  root.style.background = bg;
  return root;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/theme-preview-module.test.mjs`
Expected: PASS（3 tests）

Run: `npm test`
Expected: 全部通过（既有测试不该受影响）

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/utils/theme-preview.js tests/theme-preview-module.test.mjs
git commit -m "feat(preview): draw the mega-menu nav shape, not just top bar vs sidebar

nav_type has three values but buildMini only ever drew two. A mega menu is
only distinguishable from a dropdown once its panel is open, so the
thumbnail draws it open and shifts the content area down to make room."
```

---

### Task 2: 把 `nav_type` 接进商店预览

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:96`（吞参数的包装）
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:391-409`（`load()`）
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:658-712, 720-798`（抽屉与卡片）
- Test: `tests/gallery-view.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `buildMini(pal, {nav})`；`themePreview.buildDuo(palette, opts)`
- Produces:
  - `const buildDuo = (palette, opts) => themePreview.buildDuo(palette, opts);`
  - `loadData.navType`：字符串，当前 uci 的 `nav_type`，缺省 `"mega-menu"`
  - `const payloadNav = (item) => string`：从 hub **详情** payload 取 `layout.nav_type`

**关键约束：** hub 的**列表**接口不返回 layout（2026-08-04 实测，见 spec §7 R1）。所以社区**卡片**拿不到 `nav_type`，只有抽屉（`callHubGet`）拿得到。卡片保持顶栏——这与现状一致，不是回退。

- [ ] **Step 1: 写失败的测试**

追加到 `tests/gallery-view.test.mjs`：

```js
test("gallery view: nav_type reaches the preview instead of being swallowed", async () => {
  const src = await readFile(SRC, "utf8");
  // 这一行曾经是 (palette) => themePreview.buildDuo(palette),把 opts 丢掉了,
  // 于是 buildMini 的侧边栏分支从未渲染过。
  assert.match(
    src,
    /const buildDuo = \(palette, opts\) => themePreview\.buildDuo\(palette, opts\)/,
    "buildDuo wrapper must forward opts",
  );
  assert.match(src, /uci\.get\("aurora", "theme", "nav_type"\)/, "current nav_type not read");
  assert.match(src, /payloadNav/, "detail nav_type helper missing");
});

test("gallery view: built-in preset previews use the current nav_type", async () => {
  const src = await readFile(SRC, "utf8");
  // 内置预设只写 62 个色值,导航保持不变 —— 所以「你当前的导航形态」正是应用后的样子。
  assert.match(src, /buildDuo\(preset\.palette, \{ nav: currentNav \}\)/);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL — `buildDuo wrapper must forward opts`

- [ ] **Step 3: 实现**

`gallery.js:96` 改为：

```js
// Forwarding opts is what makes nav_type visible at all -- an earlier version
// dropped the second parameter, which is why buildMini's sidebar branch never
// rendered.
const buildDuo = (palette, opts) => themePreview.buildDuo(palette, opts);
```

在 `paletteOf` 附近加：

```js
// The hub's *list* endpoint returns only {id,name,author,downloads,
// assets_status,created_at,palette} -- no layout. So nav_type is available on
// the detail payload only, and community cards keep drawing the top bar.
const payloadNav = (item) =>
  ((item && item.payload && item.payload.layout) || {}).nav_type || "";
```

`load()` 的返回对象里加一行（`default.template:69` 的出厂值是 `mega-menu`）：

```js
      navType: uci.get("aurora", "theme", "nav_type") || "mega-menu",
```

`render(loadData)` 开头，`activePreset` 之后加：

```js
    const currentNav = loadData.navType;
```

四处调用点：

```js
// buildBuiltinCard (原 :742)
E("div", { class: "aurora-store-prev" }, [buildDuo(preset.palette, { nav: currentNav }), acts]),

// openBuiltinDrawer (原 :660) -- Task 3 会把这一行换成 buildPanes,先照改保持一致
E("div", { class: "aurora-store-drawer-prev" }, [buildDuo(preset.palette, { nav: currentNav })]),

// buildOnlineCard (原 :780) -- 不传 nav:列表 payload 里没有,保持顶栏
E("div", { class: "aurora-store-prev" }, [buildDuo(paletteOf(item)), acts]),

// openOnlineDrawer (原 :707) -- Task 3 会换成 buildPanes
E("div", { class: "aurora-store-drawer-prev" }, [
  buildDuo(paletteOf(item), { nav: payloadNav(item) }),
]),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "fix(store): stop swallowing the preview's nav_type option

The buildDuo wrapper took one parameter and forwarded one, so buildMini's
opts were always undefined and every thumbnail drew a top bar. Built-in
presets now preview against the current nav_type -- they only rewrite the
62 colour values, so that is genuinely what applying one looks like.

Community cards still draw the top bar: the hub's list endpoint carries no
layout, and the detail drawer is where the real shape shows up."
```

---

### Task 3: 抽屉换成浅色/深色双联大预览

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`（`STORE_CSS`、`openBuiltinDrawer`、`openOnlineDrawer`）
- Test: `tests/gallery-view.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `currentNav` / `payloadNav(item)`；`themePreview.buildMini`
- Produces: `const buildPanes = (palette, nav) => Node`——并排两格，各 16:10，带「浅色」「深色」标注

抽屉宽 440px，斜切双联在这个尺寸下反而把两套配色都切掉一半。并排两格能把导航形态也看清楚。

- [ ] **Step 1: 写失败的测试**

```js
test("gallery view: the drawer shows light and dark side by side, not a diagonal split", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const buildPanes = /, "buildPanes helper missing");
  assert.match(src, /aurora-store-panes/, "panes CSS class missing");
  assert.match(src, /themePreview\.buildMini/, "panes must draw two separate minis");
  // 抽屉里不该再出现斜切双联
  assert.ok(
    !/aurora-store-drawer-prev" \}, \[buildDuo\(/.test(src),
    "drawer still renders the diagonal duo",
  );
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL — `buildPanes helper missing`

- [ ] **Step 3: 实现**

在 `buildDotRow` 之后加：

```js
// The 440px drawer is wide enough to show both modes whole; the diagonal
// duo belongs on cards, where there is no room for two panes.
const buildPane = (label, palette, nav) =>
  E("figure", { class: "aurora-store-pane" }, [
    E("div", { class: "aurora-store-pane-box" }, [
      themePreview.buildMini(palette || {}, { nav: nav }),
    ]),
    E("figcaption", {}, label),
  ]);

const buildPanes = (palette, nav) =>
  E("div", { class: "aurora-store-panes" }, [
    buildPane(_("Light"), (palette || {}).light, nav),
    buildPane(_("Dark"), (palette || {}).dark, nav),
  ]);
```

`STORE_CSS` 里，把 `.aurora-store-drawer-prev` 那条替换为：

```js
  ".aurora-store-panes{display:grid;grid-template-columns:1fr 1fr;gap:10px;" +
  "padding:1em 1.3em 0;flex:none;}" +
  ".aurora-store-pane{margin:0;}" +
  ".aurora-store-pane-box{position:relative;aspect-ratio:16/10;border-radius:8px;" +
  "overflow:hidden;border:1px solid var(--hairline,rgba(0,0,0,0.12));}" +
  ".aurora-store-pane figcaption{font-size:0.75em;color:var(--text-muted,#777);" +
  "text-align:center;margin-top:5px;}" +
```

两处抽屉调用改为：

```js
// openBuiltinDrawer
buildPanes(preset.palette, currentNav),

// openOnlineDrawer
buildPanes(paletteOf(item), payloadNav(item)),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "feat(store): show light and dark whole in the detail drawer

The diagonal split earns its place on a card, where there is no room for
two panes. In a 440px drawer it just clips both palettes in half and hides
the navigation shape."
```

---

### Task 4: 「预览之外还带了什么」清单小块

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`
- Test: `tests/gallery-view.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `payloadNav`
- Produces:
  - `const firstFontFamily = (stack) => string`（`'"Geist Sans", "Lato", …'` → `Geist Sans`）
  - `const radiusLabel = (value) => string`（rem 数值 → 档位名，取不到返回 `""`）
  - `const buildTiles = (entries) => Node`，`entries` 是 `[{glyph, label, title}]`
  - `const buildDetailTiles = (item) => Node`（抽屉用，逐项）
  - `const buildCardTiles = (item) => Node`（社区卡片用，粗粒度）
  - `const buildBuiltinTiles = () => Node`（内置卡片与抽屉用，恒为「仅配色」）

**粒度差异是 hub API 的硬限制**：列表行只有 `assets_status`，所以社区卡片只能给一块「含自定义内容」；逐项明细只在抽屉出现。

圆角是 0–1.5rem 的连续滑杆（`theme.js:1798`），**没有现成档位名**，所以这里定义档位；精确 rem 值放在 `title` 提示和抽屉明细表里。

- [ ] **Step 1: 写失败的测试**

```js
test("gallery view: tiles list what the preview cannot draw", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const buildTiles = /);
  assert.match(src, /const buildDetailTiles = /);
  assert.match(src, /const buildCardTiles = /);
  assert.match(src, /const buildBuiltinTiles = /);
  // 字体显示族名,不是预设 id —— "geist-sans" 是机制词
  assert.match(src, /const firstFontFamily = /);
  assert.match(src, /struct_font_sans/);
  assert.match(src, /const radiusLabel = /);
  // 标签必须走 createTextNode
  assert.ok(!src.includes(".innerHTML"));
});

test("gallery view: community cards degrade to assets_status, detail tiles are itemised", async () => {
  const src = await readFile(SRC, "utf8");
  // 列表接口不返回 layout/typography/toolbar,卡片只能用 assets_status
  assert.match(src, /assets_status/);
  assert.match(src, /list endpoint/i, "the degradation must be explained in a comment");
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL — `const buildTiles = ` 找不到

- [ ] **Step 3: 实现**

在 `buildDotRow` 之后加：

```js
// ---------------------------------------------------------------------------
// "What this config carries beyond the preview"
//
// Colors and nav_type are drawn; everything else is listed here as glyph+text.
// Deliberately no thumbnails: real logos and login backgrounds would need the
// hub to serve asset URLs, which would break on a LAN-only router and pull in
// a cross-repo dependency for no extra clarity at this size.

const ICON_ASSET_KINDS = ["favicon_png", "favicon_ico", "pwa_icon_192", "pwa_icon_512"];

// typography.font_sans is a preset id ("geist-sans"); struct_font_sans is the
// stack the browser actually uses. Show the family, never the id.
const firstFontFamily = (stack) =>
  String(stack || "")
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");

// struct_radius_base is a continuous 0-1.5rem slider, so there are no existing
// tier names to reuse -- these are the store's own, with the exact value kept
// in the tooltip and the detail table.
const RADIUS_TIERS = [
  { below: 0.001, label: _("Square corners") },
  { below: 0.376, label: _("Small corners") },
  { below: 0.751, label: _("Rounded corners") },
  { below: Infinity, label: _("Large corners") },
];

const radiusLabel = (value) => {
  const rem = parseFloat(value);
  if (!isFinite(rem) || rem < 0) return "";
  const tier = RADIUS_TIERS.find((entry) => rem < entry.below);
  return tier ? tier.label : "";
};

const buildTile = (glyph, label, title) => {
  const el = E("span", { class: "aurora-store-tile" }, [
    E("span", { class: "g" }, [document.createTextNode(glyph)]),
    E("span", {}, [document.createTextNode(label)]),
  ]);
  if (title) el.setAttribute("title", title);
  return el;
};

const buildTiles = (entries) =>
  E(
    "div",
    { class: "aurora-store-tiles" },
    entries.map((entry) => buildTile(entry.glyph, entry.label, entry.title)),
  );

const buildBuiltinTiles = () =>
  buildTiles([
    {
      glyph: "◑",
      label: _("Colors only"),
      title: _("Replaces the light and dark colors; everything else stays as it is."),
    },
  ]);

// Cards for community configs: the hub's list endpoint carries no layout,
// typography or toolbar, so assets_status is the only signal available here.
// The itemised version lives in the drawer, which fetches the full payload.
const buildCardTiles = (item) => {
  const status = item && item.assets_status;
  if (!status || status === "none") return null;
  return buildTiles([
    {
      glyph: "◆",
      label: _("Includes custom content"),
      title: _("Open this configuration to see everything it carries."),
    },
  ]);
};

const buildDetailTiles = (item) => {
  const payload = (item && item.payload) || {};
  const typography = payload.typography || {};
  const layout = payload.layout || {};
  const toolbar = Array.isArray(payload.toolbar) ? payload.toolbar : [];
  const kinds = ((item && item.assets) || payload.assets || [])
    .map((asset) => (asset && asset.kind) || "")
    .filter(Boolean);

  const entries = [];

  const family = firstFontFamily(typography.struct_font_sans);
  if (family)
    entries.push({
      glyph: "Aa",
      label: family,
      title:
        family +
        (firstFontFamily(typography.struct_font_mono)
          ? " · " + firstFontFamily(typography.struct_font_mono)
          : ""),
    });

  const radius = radiusLabel(layout.struct_radius_base);
  if (radius)
    entries.push({ glyph: "◜", label: radius, title: layout.struct_radius_base });

  if (kinds.indexOf("logo_svg") !== -1)
    entries.push({ glyph: "◆", label: _("Logo"), title: _("Custom logo") });

  if (kinds.indexOf("login_bg") !== -1)
    entries.push({
      glyph: "▣",
      label: _("Background"),
      title: _("Custom login page background"),
    });

  if (kinds.some((kind) => ICON_ASSET_KINDS.indexOf(kind) !== -1))
    entries.push({ glyph: "◐", label: _("Icons"), title: _("Custom site icons") });

  if (toolbar.length)
    entries.push({
      glyph: "⌘",
      label: _("Toolbar %d").format(toolbar.length),
      title: _("Floating toolbar shortcuts"),
    });

  if (!entries.length)
    return buildTiles([
      {
        glyph: "◑",
        label: _("Colors only"),
        title: _("Replaces the light and dark colors; everything else stays as it is."),
      },
    ]);

  return buildTiles(entries);
};
```

`STORE_CSS` 追加：

```js
  ".aurora-store-tiles{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;}" +
  ".aurora-store-tile{display:inline-flex;align-items:center;gap:5px;font-size:0.75em;" +
  "color:var(--text-muted,#777);background:var(--surface-sunken,rgba(0,0,0,0.04));" +
  "border:1px solid var(--hairline,rgba(0,0,0,0.08));border-radius:7px;" +
  "padding:2px 8px 2px 3px;white-space:nowrap;}" +
  ".aurora-store-tile .g{display:grid;place-items:center;width:20px;height:20px;" +
  "border-radius:5px;background:var(--surface,#fff);color:var(--text,#111);" +
  "border:1px solid var(--hairline,rgba(0,0,0,0.08));font-size:0.9em;line-height:1;}" +
```

接进卡片与抽屉。`buildBuiltinCard` 的 `.aurora-store-meta` 里，`aurora-store-nm` 之后：

```js
            buildBuiltinTiles(),
```

`buildOnlineCard` 同位置（`buildCardTiles` 可能返回 `null`，`E()` 会忽略 falsy child，但显式过滤更清楚）：

```js
      E(
        "div",
        { class: "aurora-store-meta" },
        [
          E("div", { class: "aurora-store-nm" }, [
            document.createTextNode(item.name || _("Untitled theme")),
            ...badges,
          ]),
          buildCardTiles(item),
          E("div", { class: "aurora-store-ft" }, [...]),
        ].filter(Boolean),
      ),
```

`buildDetailBody(item)` 里，把现有的 `_("Included Assets")` + `buildAssetList(item)` 两行替换为：

```js
    E("h4", { style: "margin:1em 0 0.4em;" }, _("Beyond the preview")),
    buildDetailTiles(item),
```

并在明细区补两行（`buildDetailRow` 已存在）：

```js
    buildDetailRow(_("Sans Font"), firstFontFamily(typography.struct_font_sans)),
    buildDetailRow(_("Mono Font"), firstFontFamily(typography.struct_font_mono)),
```

——替换掉原来直接打印预设 id 的 `buildDetailRow(_("Sans Font"), typography.font_sans)`。

`openBuiltinDrawer` 里，`buildPaletteChips` 之后加（导航一行显式说明「沿用你当前的设置」——
预览画的是当前形态，不写清楚会被读成「这个预设自带侧边栏」）：

```js
          E("h4", { style: "margin:1em 0 0.4em;" }, _("Beyond the preview")),
          buildBuiltinTiles(),
          buildDetailRow(
            _("Navigation"),
            (NAV_TYPE_LABELS[currentNav] || currentNav) +
              " · " +
              _("unchanged by this preset"),
          ),
```

`buildAssetList` 与 `ASSET_KIND_LABELS` 如果不再有引用，一并删除（`buildDetailTiles` 取代了它）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "feat(store): say what a config carries beyond its colours

A shared config is a whole set -- fonts, corner radius, logo, login
background, site icons, toolbar shortcuts -- and none of it was visible
anywhere. Cards and the drawer now list it.

Fonts show the family from struct_font_sans rather than the preset id, so
the drawer stops printing 'geist-sans' at people.

Community cards can only manage a coarse marker: the hub's list endpoint
returns assets_status and nothing else about the payload. The itemised
list is in the drawer, which fetches the whole thing."
```

---

### Task 5: 头部收敛为 LuCI 原生语汇

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:337-349`（`STORE_CSS` 的搜索/标签样式）
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:1025-1075`（头部构造）
- Test: `tests/gallery-view.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: 头部 DOM 结构变化；`.aurora-store-search` / `.aurora-store-tabs` 两个 class 消失，新增 `.aurora-store-filters`

现状是三种控件语汇挤在一行：自定义圆角搜索胶囊（带 `🔍` emoji 字形）、自定义 segmented 胶囊、LuCI 标准按钮。改成：普通 `cbi-input-text` 输入框 + 与页面一级 tab 同款的下划线筛选 + 标准按钮。

- [ ] **Step 1: 写失败的测试**

```js
test("gallery view: the header uses LuCI's own controls, not a bespoke pill set", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /class: "cbi-input-text"/, "search must be a standard LuCI input");
  assert.ok(!src.includes("🔍"), "emoji glyph must go");
  assert.ok(!src.includes("aurora-store-search"), "bespoke search pill must go");
  assert.ok(!src.includes("aurora-store-tabs"), "bespoke segmented pill must go");
  assert.match(src, /aurora-store-filters/, "underline filter row missing");
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL — `search must be a standard LuCI input`

- [ ] **Step 3: 实现**

`STORE_CSS` 里删掉 `.aurora-store-search`、`.aurora-store-search input`、`.aurora-store-tabs`、`.aurora-store-tabs button`、`.aurora-store-tabs button.active` 五条，换成：

```js
  ".aurora-store-head{display:flex;gap:0.8em;align-items:center;flex-wrap:wrap;margin:1em 0 0;}" +
  ".aurora-store-head input{max-width:300px;}" +
  ".aurora-store-filters{display:flex;gap:2px;flex-wrap:wrap;margin-top:0.9em;" +
  "border-bottom:1px solid var(--hairline,rgba(0,0,0,0.1));}" +
  ".aurora-store-filters button{border:0;background:transparent;font:inherit;" +
  "font-size:0.9em;color:var(--text-muted,#666);padding:0.55em 0.9em;cursor:pointer;" +
  "border-bottom:2px solid transparent;margin-bottom:-1px;}" +
  ".aurora-store-filters button:hover{color:var(--text,#111);}" +
  ".aurora-store-filters button.active{color:var(--text,#111);font-weight:600;" +
  "border-bottom-color:var(--brand,#0086bf);}" +
```

头部构造改为：

```js
    const tabsEl = E(
      "div",
      { class: "aurora-store-filters" },
      TABS.map((tab) => {
        const btn = E(
          "button",
          { type: "button", click: () => selectTab(tab.key) },
          tab.label,
        );
        tabButtons[tab.key] = btn;
        return btn;
      }),
    );

    const searchInput = E("input", {
      type: "text",
      class: "cbi-input-text",
      placeholder: _("Search themes or authors…"),
    });
    searchInput.addEventListener("input", () => {
      state.query = searchInput.value.trim().toLowerCase();
      renderContent();
    });

    const headEl = E("div", {}, [
      E("div", { class: "aurora-store-head" }, [
        searchInput,
        E("span", { style: "flex:1;" }),
        shareBtn,
      ]),
      tabsEl,
    ]);
```

（`shareBtn` 的定义不变，Task 6 会改它的 click 行为。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "refactor(store): drop the bespoke search pill and segmented tabs

The header had three control vocabularies fighting each other -- a custom
rounded search box with an emoji glyph, a custom segmented pill, and a
stock LuCI button. Now it borrows the page's own underline tabs and a
plain cbi-input-text, so there is one vocabulary instead of three."
```

---

### Task 6: 分享从弹窗改为「我的分享」里的表单区

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`（`openShareModal` → `buildSharePanel`，`renderContent`，`shareBtn`）
- Test: `tests/gallery-view.test.mjs`

**Interfaces:**
- Consumes: Task 4 的 `buildTiles` / `firstFontFamily` / `radiusLabel`；Task 2 的 `currentNav`
- Produces:
  - `const FACTORY_ASSET_NAMES = [...]`（与 shell 同步，Task 7 有测试守住）
  - `const loginBgFilename = (value) => string`
  - `const shareManifestRows = () => [{label, detail}]`（全部来自本机 uci）
  - `buildSharePanel()`：返回内联面板节点；`shareOpen` 状态位

分享弹窗只问三个字段，完全不说会发出去什么。改成「我的分享」标签页里的一段常规表单区：左预览、右字段、下清单表。

**清单数据全部来自本机 uci**，不新增 rpcd 方法（rpcd 后端尚未真机验证，不加表面积）。**不显示文件体积**——体积不在 uci 里，且字节数是机制信息。

- [ ] **Step 1: 写失败的测试**

```js
test("gallery view: sharing says what gets shared, inline rather than in a modal", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const buildSharePanel = /, "inline share panel missing");
  assert.match(src, /const shareManifestRows = /, "share manifest missing");
  assert.ok(
    !/ui\.showModal\(\s*_\("Share My Configuration"\)/.test(src),
    "share must no longer be a modal",
  );
  // 清单来自本机 uci,不是新的 rpcd 调用
  assert.match(src, /uci\.get\("aurora", "theme", "logo_svg"\)/);
  assert.match(src, /const loginBgFilename = /);
  // 体积是机制信息,不进界面
  assert.ok(!/KB|bytes|filesize/i.test(src), "no byte counts in the UI");
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL — `inline share panel missing`

- [ ] **Step 3: 实现**

模块顶层（`SWATCH_KEYS` 附近）加：

```js
// build_share_payload skips assets whose filename is still the factory one --
// an unmodified slot means the user never customised it, so nothing is
// uploaded. The manifest must skip exactly the same names, or it would
// promise to share a logo that never leaves the box.
//
// This list is duplicated from root/usr/libexec/rpcd/luci.aurora (the case
// statement in build_share_payload). tests/gallery-view.test.mjs asserts the
// two stay identical.
const FACTORY_ASSET_NAMES = [
  "logo.svg",
  "favicon.ico",
  "app-icon-192x192.png",
  "app-icon-512x512.png",
  "apple-touch-icon.png",
];

const SHARE_IMAGE_SLOTS = [
  { key: "logo_svg", label: _("Logo") },
  { key: "favicon_png", label: _("Site Icon") },
  { key: "favicon_ico", label: _("Site Icon") },
  { key: "pwa_icon_192", label: _("App Icon") },
  { key: "pwa_icon_512", label: _("App Icon") },
];

const loginBgFilename = (value) => {
  const match = /^url\('\/luci-static\/aurora\/images\/([^']+)'\)$/.exec(value || "");
  return match ? match[1] : "";
};

// Mirrors build_share_payload's own guard: a name containing "/" or ".." never
// makes it into a share, so it must not show up in the manifest either.
const isSharedAssetName = (name) =>
  !!name &&
  name.indexOf("/") === -1 &&
  name.indexOf("..") === -1 &&
  FACTORY_ASSET_NAMES.indexOf(name) === -1;
```

`render()` 内（能读 uci 的地方）加：

```js
    // Everything the manifest needs is already in uci -- no extra rpc call.
    const shareManifestRows = () => {
      const rows = [
        { label: _("Colors"), detail: _("Light and dark, 62 values") },
        {
          label: _("Navigation"),
          detail: NAV_TYPE_LABELS[currentNav] || currentNav,
        },
      ];

      const radius = radiusLabel(uci.get("aurora", "theme", "struct_radius_base"));
      if (radius) rows.push({ label: _("Shape"), detail: radius });

      const family = firstFontFamily(uci.get("aurora", "theme", "struct_font_sans"));
      const mono = firstFontFamily(uci.get("aurora", "theme", "struct_font_mono"));
      if (family)
        rows.push({
          label: _("Fonts"),
          detail: mono ? family + " · " + mono : family,
        });

      const images = [];
      SHARE_IMAGE_SLOTS.forEach((slot) => {
        const name = uci.get("aurora", "theme", slot.key);
        if (isSharedAssetName(name) && images.indexOf(slot.label) === -1)
          images.push(slot.label);
      });
      if (isSharedAssetName(loginBgFilename(uci.get("aurora", "theme", "struct_login_bg"))))
        images.push(_("Login Background"));
      images.forEach((label) =>
        rows.push({ label: label, detail: _("Included") }),
      );

      const items = uci.sections("aurora", "toolbar_item") || [];
      if (items.length)
        rows.push({
          label: _("Toolbar"),
          detail: _("%d shortcuts").format(items.length),
        });

      return rows;
    };
```

把 `openShareModal` 整体替换为 `buildSharePanel`。字段、校验、提交逻辑照搬原函数（`doSubmit` 里的 `hubApi.callHubShare` 调用、`HUB_NICK_KEY` 的读写、`shareErrorMessage` 映射一字不改），只改容器与新增清单：

```js
    let shareOpen = false;

    const buildSharePanel = () => {
      const nameInput = E("input", {
        type: "text",
        class: "cbi-input-text",
        maxlength: 60,
        placeholder: _("Give it a name"),
      });
      const descInput = E("textarea", {
        class: "cbi-input-textarea",
        rows: 3,
        maxlength: 500,
        placeholder: _("One line about where this configuration fits."),
      });
      const authorInput = E("input", {
        type: "text",
        class: "cbi-input-text",
        maxlength: 40,
        placeholder: _("Shown as Anonymous if left blank"),
        value: localStorage.getItem(HUB_NICK_KEY) || "",
      });

      const errEl = E("p", {
        style: "color:var(--danger);font-weight:600;display:none;margin:0 0 0.6em;",
      });

      const showError = (message) => {
        errEl.textContent = message;
        errEl.style.display = "block";
      };

      const submitBtn = E(
        "button",
        { type: "button", class: "btn cbi-button-action important" },
        _("Publish"),
      );

      const doSubmit = () => {
        const name = nameInput.value.trim();
        if (!name) {
          showError(_("Please enter a name."));
          return;
        }
        errEl.style.display = "none";
        submitBtn.disabled = true;
        const author = authorInput.value.trim();
        const description = descInput.value.trim();
        L.resolveDefault(hubApi.callHubShare(name, description, author), null).then(
          (res) => {
            submitBtn.disabled = false;
            if (res && res.result === 0) {
              if (author) localStorage.setItem(HUB_NICK_KEY, author);
              ui.addNotification(null, E("p", {}, _("Published.")), "info");
              shareOpen = false;
              refreshMyShares().then(renderContent);
            } else {
              showError(shareErrorMessage(res && res.error));
            }
          },
        );
      };

      submitBtn.addEventListener("click", doSubmit);

      const field = (label, control) =>
        E("div", { class: "aurora-store-field" }, [
          E("label", {}, label),
          control,
        ]);

      const manifestTable = E("table", { class: "table" }, [
        E("tr", { class: "tr table-titles" }, [
          E("th", { class: "th" }, _("Content")),
          E("th", { class: "th" }, _("Details")),
        ]),
        ...shareManifestRows().map((row) =>
          E("tr", { class: "tr" }, [
            E("td", { class: "td" }, [document.createTextNode(row.label)]),
            E("td", { class: "td", style: "color:var(--text-muted);" }, [
              document.createTextNode(row.detail),
            ]),
          ]),
        ),
      ]);

      return E("div", { class: "aurora-store-share" }, [
        E("div", { class: "aurora-store-share-head" }, [
          E("h4", { style: "margin:0;" }, _("Publish current configuration")),
          E(
            "button",
            {
              type: "button",
              class: "cbi-button",
              click: () => {
                shareOpen = false;
                renderContent();
              },
            },
            _("Cancel"),
          ),
        ]),
        E("div", { class: "aurora-store-share-cols" }, [
          E("div", { class: "aurora-store-share-prev" }, [
            E("div", { class: "aurora-store-prev" }, [
              buildDuo(
                {
                  light: {
                    bg: uci.get("aurora", "theme", "light_bg"),
                    surface: uci.get("aurora", "theme", "light_surface"),
                    text: uci.get("aurora", "theme", "light_text"),
                    brand: uci.get("aurora", "theme", "light_brand"),
                  },
                  dark: {
                    bg: uci.get("aurora", "theme", "dark_bg"),
                    surface: uci.get("aurora", "theme", "dark_surface"),
                    text: uci.get("aurora", "theme", "dark_text"),
                    brand: uci.get("aurora", "theme", "dark_brand"),
                  },
                },
                { nav: currentNav },
              ),
            ]),
            E(
              "p",
              { style: "font-size:0.75em;color:var(--text-muted);text-align:center;margin:6px 0 0;" },
              _("How it looks in the store"),
            ),
          ]),
          E("div", {}, [
            field(_("Name"), nameInput),
            field(_("Description"), descInput),
            field(_("Nickname"), authorInput),
            errEl,
          ]),
        ]),
        E("h4", { style: "margin:1.2em 0 0.4em;" }, _("What gets shared")),
        manifestTable,
        E(
          "p",
          { style: "color:var(--text-muted);font-size:0.8em;margin-top:0.8em;" },
          _("Anyone who applies this gets all of it. You can update or remove it later."),
        ),
        E("div", { class: "right", style: "margin-top:1em;" }, [submitBtn]),
      ]);
    };
```

`STORE_CSS` 追加：

```js
  ".aurora-store-share{background:var(--surface,#fff);border:1px solid var(--hairline,rgba(0,0,0,0.12));" +
  "border-radius:12px;padding:1em 1.3em 1.3em;margin-top:1em;}" +
  ".aurora-store-share-head{display:flex;align-items:center;justify-content:space-between;" +
  "gap:1em;margin-bottom:1em;}" +
  ".aurora-store-share-cols{display:grid;grid-template-columns:240px 1fr;gap:1.6em;}" +
  "@media (max-width:700px){.aurora-store-share-cols{grid-template-columns:1fr;}}" +
  ".aurora-store-share-prev .aurora-store-prev{border:1px solid var(--hairline,rgba(0,0,0,0.12));" +
  "border-radius:10px;overflow:hidden;}" +
  ".aurora-store-field{margin-bottom:0.9em;}" +
  ".aurora-store-field label{display:block;font-size:0.8em;font-weight:600;" +
  "color:var(--text-muted,#666);margin-bottom:4px;}" +
  ".aurora-store-field input,.aurora-store-field textarea{width:100%;}" +
```

`renderContent()` 的 `mine` 分支改为：

```js
      } else if (state.tab === "mine") {
        if (shareOpen) push(buildSharePanel());
        else
          push(
            E("div", { style: "margin-top:1em;" }, [
              E(
                "button",
                {
                  type: "button",
                  class: "cbi-button cbi-button-add",
                  click: () => {
                    shareOpen = true;
                    renderContent();
                  },
                },
                _("Publish current configuration"),
              ),
            ]),
          );
        push(E("h3", { class: "aurora-store-section-title" }, _("My Shares")));
        push(mySharesEl);
      }
```

`shareBtn` 的 click 改为：

```js
        click: () => {
          shareOpen = true;
          selectTab("mine");
        },
```

`refreshMyShares` 已返回 promise，无需改动。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全部通过（注意既有的 `share/update/delete copy stays result-only` 与 `share panel and my-shares management` 两条仍须绿）

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "feat(store): show what a share contains before publishing it

The share dialog asked for a name, a description and a nickname, and said
nothing about the logo, login background, fonts and toolbar shortcuts that
go out with them. It is now a panel inside My Shares, with a preview of how
the config will look in the store and a table of what is included.

The manifest is derived from uci in the browser, so this adds no rpcd
surface. No byte counts: they are not in uci, and they are mechanism."
```

---

### Task 7: 守住出厂文件名常量不漂移

**Files:**
- Test: `tests/gallery-view.test.mjs`
- Read-only: `root/usr/libexec/rpcd/luci.aurora:695-698`

**Interfaces:**
- Consumes: Task 6 的 `FACTORY_ASSET_NAMES`
- Produces: 无生产代码，纯测试

`FACTORY_ASSET_NAMES` 在 shell 与 JS 里各存一份。shell 那份是权威（决定实际上传什么），JS 那份决定界面承诺什么。两边一旦不一致，界面就会承诺分享一个实际不会上传的资产。

- [ ] **Step 1: 写测试（这次先确认它通过，因为 Task 6 已经写对了常量）**

```js
test("share manifest skips exactly the filenames build_share_payload skips", async () => {
  const js = await readFile(SRC, "utf8");
  const shell = await readFile("root/usr/libexec/rpcd/luci.aurora", "utf8");

  // shell 侧:build_share_payload 里的 case 分支
  //   logo.svg|favicon.ico|app-icon-192x192.png|...)
  const shellMatch = /^\s*(logo\.svg(?:\|[A-Za-z0-9.\-]+)+)\)\s*$/m.exec(shell);
  assert.ok(shellMatch, "could not find the factory-filename case in luci.aurora");
  const shellNames = shellMatch[1].split("|").sort();

  const jsMatch = /const FACTORY_ASSET_NAMES = \[([\s\S]*?)\];/.exec(js);
  assert.ok(jsMatch, "FACTORY_ASSET_NAMES not found in gallery.js");
  const jsNames = [...jsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

  assert.deepEqual(
    jsNames,
    shellNames,
    "the share manifest and build_share_payload disagree about which assets are factory defaults",
  );
});
```

- [ ] **Step 2: 跑测试**

Run: `node --test tests/gallery-view.test.mjs`
Expected: PASS

- [ ] **Step 3: 确认它真的能抓到漂移**

临时把 `gallery.js` 的 `FACTORY_ASSET_NAMES` 删掉一项（如 `"favicon.ico"`），重跑：

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL — `the share manifest and build_share_payload disagree...`

然后改回来，再跑一次确认 PASS。**这一步不能跳过**——一条从未见过红色的测试不算测试。

- [ ] **Step 4: 提交**

```bash
git add tests/gallery-view.test.mjs
git commit -m "test: pin the share manifest to the shell's factory-filename list

build_share_payload skips assets whose filename is still the factory one,
and the browser-side manifest has to skip the same set or it promises to
share a logo that never leaves the box. The list lives in two languages,
so assert they match rather than hoping."
```

---

### Task 8: 新词条进 po

**Files:**
- Modify: `scripts/translations.json`
- Regenerate: `po/templates/aurora-config.pot`, `po/*/aurora-config.po`

**Interfaces:**
- Consumes: Task 1–7 引入的全部 `_()` 字符串
- Produces: 15 个语言目录的 po 文件更新

**注意：** 线上截图里「Hot / New / My Shares」显示为英文**不是**本次要修的设计问题——这些词条在 `po/zh_Hans` 里早已翻译（热门/最新/我的分享），是测试机上 `luci-i18n-aurora-config-zh-cn` 没装或没重编。验证本次改动时先确认 i18n 包已更新，否则会把翻译缺失误判成设计问题。

- [ ] **Step 1: 收集本次新增的 msgid**

Run: `node scripts/gen-pot.mjs && git diff --stat po/templates/aurora-config.pot`
Expected: 模板新增若干条目

Run: `git diff po/templates/aurora-config.pot | grep '^+msgid'`

同时会有**删除**：Task 4 移除了 `ASSET_KIND_LABELS` 与 `buildAssetList`，所以
`Included Assets`、`Unknown asset`、`Custom Sans Font`、`Custom Mono Font` 等 msgid 若在别处
（如 `theme.js`）没有引用就会从模板消失。`merge-po.mjs` 会同步从各语言 po 里删掉它们——
这是预期行为，不要手工加回。

逐条列出新 msgid。预期包含（以实现为准）：
`Light`、`Dark`、`Square corners`、`Small corners`、`Rounded corners`、`Large corners`、
`Colors only`、`Replaces the light and dark colors; everything else stays as it is.`、
`Includes custom content`、`Open this configuration to see everything it carries.`、
`Background`、`Custom login page background`、`Custom logo`、`Icons`、`Custom site icons`、
`Toolbar %d`、`Floating toolbar shortcuts`、`Beyond the preview`、`Site Icon`、`App Icon`、
`Publish current configuration`、`What gets shared`、`Content`、`Details`、`Included`、
`%d shortcuts`、`Shape`、`Fonts`、`How it looks in the store`、`Give it a name`、
`One line about where this configuration fits.`、`Shown as Anonymous if left blank`、
`Anyone who applies this gets all of it. You can update or remove it later.`、
`unchanged by this preset`

- [ ] **Step 2: 把译文写进 `scripts/translations.json`**

按该文件既有格式（`"<msgid>": { "<lang>": "<译文>" }`）追加。至少补齐 `zh_Hans`；其余语言留空即可——`merge-po.mjs` 的注释明确写着「缺条目就留空 msgstr，而不是把英文当译文发出去」。

zh_Hans 参考译法：

```
Light → 浅色
Dark → 深色
Square corners → 直角
Small corners → 小圆角
Rounded corners → 圆角
Large corners → 大圆角
Colors only → 仅配色
Includes custom content → 含自定义内容
Background → 背景图
Icons → 图标
Toolbar %d → 工具栏 %d
Beyond the preview → 预览之外还带了
Site Icon → 站点图标
App Icon → 应用图标
Publish current configuration → 发布当前配置
What gets shared → 本次分享包含
Content → 内容
Details → 明细
Included → 包含
%d shortcuts → %d 个入口
Shape → 外形
Fonts → 字体
How it looks in the store → 在商店里的样子
Give it a name → 起个名字
Anyone who applies this gets all of it. You can update or remove it later.
  → 应用这套配置的人会连同上面这些一起装上。你随时可以更新或删除。
unchanged by this preset → 此预设不改动
```

- [ ] **Step 3: 重新生成并检查**

Run: `node scripts/gen-pot.mjs && node scripts/merge-po.mjs`
Run: `grep -c '^msgid' po/templates/aurora-config.pot po/zh_Hans/aurora-config.po`
Expected: 两个数字相同（改动前是 341/341）

Run: `grep -A1 'msgid "Beyond the preview"' po/zh_Hans/aurora-config.po`
Expected: `msgstr "预览之外还带了"`

- [ ] **Step 4: 全量测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add scripts/translations.json po
git commit -m "i18n: translate the theme store's new strings"
```

---

### Task 9: 真机前的自检与收尾

**Files:**
- Read-only 检查

- [ ] **Step 1: 确认没有违反全局约束**

```bash
grep -n "innerHTML" htdocs/luci-static/resources/view/aurora/gallery.js htdocs/luci-static/resources/utils/theme-preview.js
```
Expected: 无输出

```bash
git diff --stat master
```
Expected: 只有 `gallery.js`、`theme-preview.js`、两个 test 文件、`scripts/translations.json`、`po/`、`docs/` 被改。
**`root/` 下不应有任何改动**——本次不碰 shell。

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全部通过，且总数比改动前多 8 条以上

- [ ] **Step 3: 浏览器人工过一遍（需要真机或已装本包的设备）**

因为整个改动是纯客户端的，**不需要**重跑 rpcd 真机 smoke test，但下面这几项必须在浏览器里看过：

1. 「全部」标签：内置 5 张卡的预览导航形态 = 你当前的 `nav_type`；每张挂一个「仅配色」。
2. 把设置里的导航改成侧边栏再回来，内置卡的预览跟着变。
3. 社区卡：预览是顶栏（预期行为，非缺陷）；`assets_status` 非 none 的卡有「含自定义内容」。
4. 点开一张社区配置：抽屉里浅色/深色两格并排，导航形态正确，清单逐项列出。
5. 搜索框、筛选 tab、按钮三者视觉一致，无 emoji 字形。
6. 「我的分享」→「发布当前配置」：左侧预览是你自己的配色 + 导航；清单表列出配色/导航/外形/字体/资产/工具栏；**清单里出现的资产 = 你确实自定义过的那些**（把 Logo 换回出厂 `logo.svg` 后该行应消失）。
7. 中文界面下无英文残留（若有，先确认 `luci-i18n-aurora-config-zh-cn` 已重新编译安装）。

- [ ] **Step 4: 更新 spec 的状态行**

把 `docs/specs/2026-08-04-theme-store-ux-redesign.md` 的 `状态：设计已确认，待实现` 改为 `状态：已实现（见 docs/plans/2026-08-04-theme-store-ux-redesign.md）`。

```bash
git add docs/specs/2026-08-04-theme-store-ux-redesign.md
git commit -m "docs: mark the theme store redesign spec implemented"
```

- [ ] **Step 5: 停下来报告，不要推送**

本地提交完成后停止。**不执行 `git push`**——推送需要单独放行。报告：分支、提交范围、`npm test` 结果、以及第 3 步里哪些项已在浏览器验证过、哪些还没有。
