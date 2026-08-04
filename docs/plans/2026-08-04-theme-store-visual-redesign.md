# 配置广场视觉重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/specs/2026-08-04-theme-store-visual-redesign.md`（方案 A「安静货架」）重做配置广场的页头、标签、卡片和详情抽屉，并在详情里真正列出配置带的快捷方式。

**Architecture:** 全部改动集中在一个文件 `htdocs/luci-static/resources/view/aurora/gallery.js`：文件顶部的 `STORE_CSS` 静态字符串（注入式样式表）、模块级的构造器函数、以及 `render()` 里的 DOM 装配。`utils/theme-preview.js` 的 mini 预览画法一行不动，hub 后端零改动。测试是对源码文本做正则断言（`tests/gallery-view.test.mjs` 既有风格），不是 DOM 测试。

**Tech Stack:** LuCI 客户端 JS（`view.extend` + 全局 `E()` 构造器 + `_()` i18n），Node 内置 test runner（`node --test`），gettext 工具链是本仓库自带的 `scripts/gen-pot.mjs` + `scripts/merge-po.mjs` + `scripts/translations.json`。

## Global Constraints

- 唯一要改的源文件是 `htdocs/luci-static/resources/view/aurora/gallery.js`。`utils/theme-preview.js` 不动。
- **openwrt-cloud（hub）零改动。** 详情要的 `payload.toolbar[]` 已经全量返回，卡片要的 `preview.toolbar[]` 有标题和条数。
- **一切 hub 来的文本都是不可信自由文本**（name、author、description、hex、toolbar 的 title/url/icon、layout/typography 的每个值）。只能经 `document.createTextNode` 或 `E()` 的 textContent-safe 子节点进入 DOM。
- 源码里**不得出现 `.innerHTML`**。既有测试 `"gallery view never assigns innerHTML with hub-sourced data"` 在守这条。
- 源码里**不得出现 emoji 字形**。既有测试在守这条。几何字符（`✓ ↗ ▫ ◑ ◆ ◐ ◜ ⌘ ▣`）不是 emoji，可以用。
- 搜索框**保持 `class: "cbi-input-text"` 的标准 LuCI 输入框**，不加图标、不做自制搜索胶囊。既有测试在守这条，本次不反转这一半。
- **不得为 toolbar 的 `icon` 字段构造任何 `<img src>` 或路径。** hub 只批准 6 种资产（`root/usr/libexec/rpcd/luci.aurora:676`：logo_svg、favicon_png、favicon_ico、pwa_icon_192、pwa_icon_512、login_bg），快捷方式图标的字节从未离开作者的路由器。
- **不得把不可信 url 交给 `new URL()` 解析。** 显示时只做字符串截断。
- 所有面向用户的文案只描述结果，不出现机制词（job、schema、token、pending、bad_payload）。文件头的注释写明了这条规矩。
- 每个 `var()` 都要带回退值（`var(--brand,#0086bf)`），`STORE_CSS` 的自足性靠这个——页面在非 Aurora 主题下也要能看。
- `STORE_CSS` 是由 `+` 拼接的字符串字面量。**一条 CSS 规则要么完整落在一个字面量里，要么在测试断言用得上的那个片段完整落在一个字面量里**，否则跨行拼接会让正则断言失效。
- 跑测试：`npm test`（= `node --test tests/*.test.mjs`）。单独跑一个文件：`node --test tests/gallery-view.test.mjs`。
- 提交信息不带任何 session 标识、`Claude-Session:` trailer 或 claude.ai 链接。

---

## File Structure

| 文件 | 职责 | 本次变化 |
|---|---|---|
| `htdocs/luci-static/resources/view/aurora/gallery.js` | 配置广场整个视图：样式表、构造器、apply/share 流程、DOM 装配 | 全部 7 个任务都改这里 |
| `tests/gallery-view.test.mjs` | 对 gallery.js 源码文本的正则断言 | 改 1 条既有测试，新增 6 条 |
| `scripts/translations.json` | 新 msgid 的 14 语翻译表，`merge-po.mjs` 从这里取 | Task 7 加 11 条 |
| `po/templates/aurora-config.pot` | gettext 模板，`gen-pot.mjs` 生成 | Task 7 重新生成 |
| `po/<lang>/aurora-config.po` | 14 个语种的翻译 | Task 7 由 `merge-po.mjs` 同步 |

`gallery.js` 已经 1872 行，本次不拆分它——它是一个 LuCI view 模块，LuCI 的加载方式（`"require"` 头 + 单一 `view.extend` 返回值）不鼓励把一个视图拆成多个资源文件，而且本次改动是替换而非净增（去掉 `buildDetailRow`、`.aurora-store-badge.current`、`cbi-map-descr`，加上快捷方式清单），行数基本持平。

---

## Task 1: 页头压成两行，标签换成分段控件

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`（`STORE_CSS` ~661-731；`renderContent` ~1758-1799；页头装配 ~1600-1653；根节点装配 ~1855-1868；`renderBanner` ~834-858；`renderMySharesTab` ~1294-1305）
- Test: `tests/gallery-view.test.mjs`（重写 :219 那条）

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: `buildSectionTitle(title, hint)` → 返回一个 `.aurora-store-section-title` 容器（内含 `h3` + 副标题 `span`）；`renderTabLabel(tab)` → 重画某个标签按钮的文字与计数。CSS 类 `.aurora-store-applied` 供 `renderBanner` 使用。

- [ ] **Step 1: 改既有测试，让它描述新的页头**

把 `tests/gallery-view.test.mjs` 里这一整条测试：

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

替换成：

```js
// 这条测试当初禁掉了整套自制胶囊控件。搜索框那一半继续有效 —— 它从来不是
// 问题所在。标签那一半是有意反转的:下划线选中态在深色主题下读作"没有",
// 一块有底色的实心分段在任何主题色下都成立。
// 见 docs/specs/2026-08-04-theme-store-visual-redesign.md 的"明确反转"一节。
test("gallery view: a two-row header with a segmented filter row", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /class: "cbi-input-text"/, "search must stay a standard LuCI input");
  assert.ok(!src.includes("🔍"), "emoji glyph must go");
  assert.ok(!src.includes("aurora-store-search"), "bespoke search pill must go");
  assert.ok(!src.includes(".innerHTML"));

  // 标题和搜索、分享按钮同一行,所以 h2 必须在页头容器里,不在它上面
  assert.match(src, /aurora-store-head" \}, \[\s*titleEl/, "the title must sit in the header row");
  // 那句总说明删掉了 —— 分区副标题接管了它的活
  assert.ok(!src.includes("cbi-map-descr"), "the blanket description must give way to section subtitles");

  // 选中的标签是一块填色的分段,不是一道下划线
  assert.ok(
    !src.includes("border-bottom-color:var(--brand"),
    "underline active state must go",
  );
  assert.ok(
    src.includes(".aurora-store-filters button.active{background:"),
    "active filter must be a filled segment",
  );
  assert.match(src, /const buildSectionTitle = /, "section subtitle builder missing");
  assert.match(src, /const renderTabLabel = /, "tab label/count builder missing");
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL —— `the title must sit in the header row`（`titleEl` 还不存在）

- [ ] **Step 3: 改 `STORE_CSS` 的页头、状态条、标签、分区标题四段**

在 `STORE_CSS` 里，把 `.aurora-store-head` 和 `.aurora-store-filters` 两段（约 662-671 行）连同 `.aurora-store-section-title`（约 693 行）整体替换成：

```js
  ".aurora-store-head{display:flex;gap:0.8em;align-items:flex-end;flex-wrap:wrap;" +
  "margin:0.4em 0 0;}" +
  ".aurora-store-head h2{margin:0;}" +
  ".aurora-store-head input{max-width:280px;}" +
  ".aurora-store-applied{display:flex;align-items:center;gap:0.6em;flex-wrap:wrap;" +
  "margin-top:0.9em;padding:0.35em 0.4em 0.35em 0.9em;border-radius:0.6em;" +
  "background:var(--brand-subtle,rgba(0,134,191,0.12));font-size:0.9em;}" +
  ".aurora-store-applied .sp{flex:1;}" +
  ".aurora-store-filters{display:flex;gap:2px;flex-wrap:wrap;margin-top:0.9em;" +
  "padding:3px;width:max-content;max-width:100%;border-radius:10px;" +
  "background:var(--surface-sunken,rgba(0,0,0,0.04));" +
  "border:1px solid var(--hairline,rgba(0,0,0,0.1));}" +
  ".aurora-store-filters button{border:0;background:transparent;font:inherit;" +
  "font-size:0.88em;color:var(--text-muted,#666);padding:0.35em 0.85em;" +
  "border-radius:7px;cursor:pointer;white-space:nowrap;}" +
  ".aurora-store-filters button:hover{color:var(--text,#111);}" +
  ".aurora-store-filters button.active{background:var(--surface,#fff);" +
  "color:var(--text,#111);font-weight:600;" +
  "box-shadow:var(--app-shadow-sm,0 1px 2px rgba(0,0,0,0.08));}" +
  ".aurora-store-filters .n{font-size:0.8em;opacity:0.6;margin-left:0.4em;}" +
  ".aurora-store-section-title{display:flex;align-items:baseline;gap:0.6em;" +
  "margin:1.6em 0 0.6em;}" +
  ".aurora-store-section-title h3{margin:0;font-size:0.95em;font-weight:650;}" +
  ".aurora-store-section-title span{font-size:0.8em;color:var(--text-subtle,#888);}" +
```

注意 `.aurora-store-filters button.active{background:` 这个片段必须完整落在一个字面量里——上面的写法已经保证了，测试断言的就是它。

- [ ] **Step 4: 加两个构造器**

在 `STORE_CSS` 上方（`// ---- Detail body pieces (drawer)` 那一节之前，紧跟 `formatDownloads` 之后）加：

```js
// 分区标题带一句副标题。它接管了页头上那句被删掉的总说明 ——
// "内置" 和 "社区" 各自的性质不一样,一句笼统的话说不到点上,而说明放在
// 它描述的那一组上方才有用。
//
// 注意:这段注释里不能出现被删掉的那个 LuCI 类名字面量,Step 1 的测试用
// !src.includes(...) 断言它已经从整个源文件里消失。
const buildSectionTitle = (title, hint) =>
  E("div", { class: "aurora-store-section-title" }, [
    E("h3", {}, title),
    E("span", {}, hint),
  ]);
```

- [ ] **Step 5: 页头装配改成两行**

在 `render()` 里，把 `headEl` 那一段（约 1646-1653 行）替换成：

```js
    const titleEl = E("h2", {}, _("Theme Store"));

    const headEl = E("div", {}, [
      E("div", { class: "aurora-store-head" }, [
        titleEl,
        E("span", { style: "flex:1;" }),
        searchInput,
        shareBtn,
      ]),
      bannerEl,
      tabsEl,
    ]);
```

`bannerEl` 从根节点搬进 `headEl`：状态条属于页头，不是页头之上的另一块东西。

- [ ] **Step 6: 状态条改用 class，不再拼 cssText**

把 `renderBanner`（约 834-858 行）的函数体替换成：

```js
    const renderBanner = () => {
      while (bannerEl.firstChild) bannerEl.removeChild(bannerEl.firstChild);
      if (!appliedName) {
        bannerEl.className = "";
        return;
      }
      bannerEl.className = "aurora-store-applied";
      bannerEl.appendChild(buildCurrentTick());
      bannerEl.appendChild(
        E("span", {}, [
          document.createTextNode(_("In use") + " "),
          E("strong", {}, [document.createTextNode(appliedName)]),
        ]),
      );
      bannerEl.appendChild(E("span", { class: "sp" }));
      bannerEl.appendChild(
        E(
          "button",
          { type: "button", class: "cbi-button", click: confirmRestore },
          _("Restore previous configuration"),
        ),
      );
    };
```

`buildCurrentTick` 和 `_("In use")` 在 Task 4 才落地。**本步先用占位实现**，Task 4 会替换掉它——在 `formatDownloads` 之后临时加：

```js
const buildCurrentTick = () =>
  E("span", { class: "aurora-store-tick" }, "✓");
```

并在 CSS 里加一行：

```js
  ".aurora-store-tick{color:var(--brand,#0086bf);font-size:0.85em;}" +
```

（Task 4 会给它补上 `title` 属性和 `_("In use")`；这里先让状态条能画出来，不留断口。）

- [ ] **Step 7: 标签加计数，`renderMySharesTab` 泛化**

把 `TABS` 定义（约 1600-1606 行）替换成：

```js
    // count 是惰性的:builtinItems 在渲染前就定好了,myShares 要等 hub_my_shares
    // 回来。两个都读的是渲染那一刻的值,而不是定义这张表时的值。
    const TABS = [
      { key: "all", label: _("All") },
      { key: "builtin", label: _("Built-in"), count: () => builtinItems.length },
      { key: "hot", label: _("Hot") },
      { key: "new", label: _("New") },
      { key: "mine", label: _("My Shares"), count: () => myShares.length },
    ];

    const renderTabLabel = (tab) => {
      const btn = tabButtons[tab.key];
      if (!btn) return;
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      btn.appendChild(document.createTextNode(tab.label));
      const n = tab.count ? tab.count() : 0;
      if (n) btn.appendChild(E("span", { class: "n" }, [document.createTextNode(String(n))]));
    };
```

`tabsEl` 的构造（紧随其后）改成：

```js
    const tabButtons = {};
    const tabsEl = E(
      "div",
      { class: "aurora-store-filters" },
      TABS.map((tab) => {
        const btn = E("button", { type: "button", click: () => selectTab(tab.key) });
        tabButtons[tab.key] = btn;
        return btn;
      }),
    );
    TABS.forEach(renderTabLabel);
```

把 `renderMySharesTab`（约 1294-1305 行）整个删掉，`renderMyShares` 里那一句 `renderMySharesTab();` 改成：

```js
      TABS.forEach(renderTabLabel);
```

**注意声明顺序**：`renderMyShares` 在 `TABS` 之前定义，但它只在被调用时才读 `TABS`，而首次调用（约 1847 行）在 `TABS` 定义之后，所以 `const` 的暂时性死区不会被触发。

- [ ] **Step 8: 分区标题带副标题，删掉总说明**

在 `renderContent`（约 1758-1799 行）里，把三处 `E("h3", { class: "aurora-store-section-title" }, ...)` 换成：

```js
          push(buildSectionTitle(_("Built-in"), _("Ships with the theme, works offline")));
```

```js
        push(buildSectionTitle(_("Community"), _("Shared by other people")));
```

```js
        push(buildSectionTitle(_("My Shares"), ""));
```

- [ ] **Step 9: 根节点装配去掉 h2 和 cbi-map-descr**

把 `render()` 末尾的数组（约 1855-1868 行）替换成：

```js
    [
      styleEl,
      headEl,
      contentEl,
      drawerMask,
      drawerEl,
    ].forEach((child) => rootEl.appendChild(child));
```

- [ ] **Step 10: 跑测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 11: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "feat(store): the header stops eating half the screen

Title, search and share now share one row; the blanket description is
gone -- it said less than the per-section subtitles that replace it --
and the applied-configuration banner shrinks to a strip inside the
header rather than a block above it.

The filter row becomes a segmented control. The underline it replaces
reads as absent against a dark theme: a two-pixel line under a muted
label is the weakest active state the page had. A filled segment holds
up under any brand colour, and it has room for the counts that were
previously glued onto the My Shares label with a space."
```

---

## Task 2: `tileEntriesFor` —— 一个来源，两个消费者

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`（`buildTilesFor` ~387-457）
- Test: `tests/gallery-view.test.mjs`（新增 1 条）

**Interfaces:**
- Consumes: Task 1 的成果（无直接依赖）
- Produces: `tileEntriesFor(item)` → `null`（老 hub，无 preview 也无 payload）或 `[{kind, glyph, label, title}]`，`kind` ∈ `"font" | "radius" | "logo" | "loginBg" | "siteIcon" | "appIcon" | "toolbar"`。空数组表示这份配置除了颜色什么都没带。`buildTilesFor(item)` 签名和返回值不变。

- [ ] **Step 1: 写失败的测试**

在 `tests/gallery-view.test.mjs` 里，紧跟 `"tiles list what the preview cannot draw"` 之后加：

```js
test("gallery view: one source of truth for what a config carries", async () => {
  const src = await readFile(SRC, "utf8");
  // 卡片要的是 glyph,抽屉要的是完整 tiles,而且抽屉还要滤掉已经在别处说过的
  // 那几种。两个消费者各自遍历 payload 会重新打开 buildTilesFor 上方注释
  // 早就关掉的那扇门 —— 同一份配置被说成两回事。
  assert.match(src, /const tileEntriesFor = /, "entry builder missing");
  assert.match(
    src,
    /const buildTilesFor = \(item\) => \{\s*\n\s*const entries = tileEntriesFor\(item\);/,
    "buildTilesFor must consume tileEntriesFor rather than rebuild the list",
  );
  for (const kind of ["font", "radius", "logo", "loginBg", "siteIcon", "appIcon", "toolbar"]) {
    assert.ok(src.includes(`kind: "${kind}"`), `entry kind ${kind} missing`);
  }
  // 老 hub 的退化路径和"仅颜色"的兜底都还在
  assert.match(src, /const buildLegacyCardTiles = /);
  assert.match(src, /const buildBuiltinTiles = /);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL —— `entry builder missing`

- [ ] **Step 3: 把 `buildTilesFor` 拆成两半**

把 `buildTilesFor`（约 387-457 行）整个替换成：

```js
// 一份配置在颜色之外还带了什么,只在这里数一次。卡片只画 glyph、抽屉画完整
// tiles 并且滤掉已经在"布局与排版"和"快捷方式"里说过的那几种 —— 两个消费者,
// 一张表。`kind` 就是给消费者过滤用的。
//
// 返回 null 表示这行来自没有 preview 投影的老 hub,调用方退回
// buildLegacyCardTiles;返回空数组表示这份配置确实只带了颜色。
const tileEntriesFor = (item) => {
  const preview = previewOf(item);
  const source = preview || (item && item.payload);
  if (!source) return null;

  const typography = source.typography || {};
  const layout = source.layout || {};
  // Both toolbar and assets are hub-sourced and therefore untrusted shapes: a
  // hub (or anything sitting between it and the router) answering with
  // assets: "logo_svg" would otherwise throw inside the promise that renders
  // the drawer, leaving it stuck on "Loading theme details…" forever.
  const toolbar = Array.isArray(source.toolbar) ? source.toolbar : [];
  const kinds = assetKindsOf(item);

  const entries = [];

  const family = firstFontFamily(typography.struct_font_sans);
  if (family)
    entries.push({
      kind: "font",
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
    entries.push({
      kind: "radius",
      glyph: "◜",
      label: radius,
      title: layout.struct_radius_base,
    });

  if (kinds.indexOf("logo_svg") !== -1)
    entries.push({
      kind: "logo",
      glyph: logoGlyph(logoUrlOf(item)),
      label: ASSET_LABELS.logo,
      title: _("Custom logo"),
    });

  if (kinds.indexOf("login_bg") !== -1)
    entries.push({
      kind: "loginBg",
      glyph: "▣",
      label: ASSET_LABELS.loginBg,
      title: _("Custom login page background"),
    });

  if (kinds.some((kind) => SITE_ICON_KINDS.indexOf(kind) !== -1))
    entries.push({
      kind: "siteIcon",
      glyph: "◐",
      label: ASSET_LABELS.siteIcon,
      title: _("Custom site icons"),
    });

  if (kinds.some((kind) => APP_ICON_KINDS.indexOf(kind) !== -1))
    entries.push({
      kind: "appIcon",
      glyph: "◐",
      label: ASSET_LABELS.appIcon,
      title: _("Custom app icons"),
    });

  if (toolbar.length)
    entries.push({
      kind: "toolbar",
      glyph: "⌘",
      label: _("Toolbar %d").format(toolbar.length),
      title: _("Floating toolbar shortcuts"),
    });

  return entries;
};

const buildTilesFor = (item) => {
  const entries = tileEntriesFor(item);
  if (!entries) return buildLegacyCardTiles(item);
  if (!entries.length) return buildBuiltinTiles();
  return buildTiles(entries);
};
```

`buildTiles` 只读 `entry.glyph / entry.label / entry.title`，多出来的 `kind` 它不看，所以不用改。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全部 PASS。**特别确认既有的 `"cards and drawer itemise the same configuration identically"`（:385）和 `"tiles list what the preview cannot draw"`（:190）仍然 PASS** —— 这一步是纯重构，行为不该有任何变化。

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "refactor(store): count what a config carries once, not per consumer

buildTilesFor went straight from a payload to finished tiles, which was
fine while cards and the drawer wanted the same tiles. They no longer
do: a card wants glyphs alone and the drawer wants the full list minus
the entries it already spells out elsewhere.

Splitting off tileEntriesFor keeps that one traversal. Each entry now
carries a kind so a consumer can filter without knowing how the entry
was derived -- which is the only way both consumers can keep describing
the same configuration the same way."
```

---

## Task 3: 卡片重排 —— 两行，不是三行

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`（`STORE_CSS` 的 grid/card/prev/meta/ft 几段；`buildBuiltinCard` ~1077-1114；`buildOnlineCard` ~1116-1164）
- Test: `tests/gallery-view.test.mjs`（新增 1 条）

**Interfaces:**
- Consumes: Task 2 的 `tileEntriesFor(item)`
- Produces: `buildCardGlyphs(item)` → `.aurora-store-glyphs` 容器或 `null`；`buildCard(model)` → 一张卡片，`model` 的形状是
  `{ name, author, right, palette, opts, badge, glyphs, current, open, apply }`。
  `buildBuiltinCard(preset)` 和 `buildOnlineCard(item)` 都变成对 `buildCard` 的一次调用。

- [ ] **Step 1: 写失败的测试**

```js
test("gallery view: one card builder, two rows of metadata", async () => {
  const src = await readFile(SRC, "utf8");
  // 内置卡和社区卡是同一个东西的两个数据源。两个构造器已经漂移过一次
  // (社区卡长出了徽章行,内置卡没有),不给它第二次机会。
  assert.match(src, /const buildCard = \(model\) => \{/, "shared card builder missing");
  assert.match(src, /const buildBuiltinCard = \(preset\) => buildCard\(/);
  assert.match(src, /const buildOnlineCard = \(item\) => buildCard\(/);

  // 卡片上是 glyph,不是整行 tiles —— 完整清单只在抽屉里出
  assert.match(src, /const buildCardGlyphs = /);
  assert.ok(
    !src.includes("buildTilesFor(preset)"),
    "a built-in card must not carry a tile row",
  );

  assert.ok(src.includes("minmax(225px,1fr)") === false, "the grid must widen");
  assert.ok(src.includes("minmax(252px,1fr)"), "grid must be 252px");
  assert.ok(src.includes("aspect-ratio:16/10"), "the preview must gain height");
  // 色点条浮到预览上,卡片正文因此少一整行
  assert.ok(
    src.includes(".aurora-store-dots{position:absolute"),
    "the swatch row must float on the preview",
  );
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL —— `shared card builder missing`

- [ ] **Step 3: 改 `STORE_CSS` 的卡片几段**

把 `.aurora-store-grid` / `.aurora-store-card` / `.aurora-store-prev` / `.aurora-store-acts` / `.aurora-store-meta` / `.aurora-store-nm` / `.aurora-store-ft` 这几段（约 672-685 行）整体替换成：

```js
  ".aurora-store-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(252px,1fr));" +
  "gap:16px;margin-top:0.4em;}" +
  ".aurora-store-card{background:var(--surface,#fff);border:1px solid var(--hairline,rgba(0,0,0,0.12));" +
  "border-radius:13px;overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s;}" +
  ".aurora-store-card:hover{transform:translateY(-3px);box-shadow:0 2px 6px rgba(0,0,0,0.12)," +
  "0 10px 28px rgba(0,0,0,0.10);}" +
  ".aurora-store-prev{aspect-ratio:16/10;position:relative;" +
  "border-bottom:1px solid var(--hairline,rgba(0,0,0,0.08));}" +
  ".aurora-store-dots{position:absolute;right:8px;bottom:8px;z-index:2;display:flex;" +
  "padding:4px 6px;border-radius:999px;background:var(--surface,#fff);" +
  "border:1px solid var(--hairline,rgba(0,0,0,0.12));}" +
  ".aurora-store-acts{position:absolute;left:8px;bottom:8px;opacity:0;transition:opacity .15s;z-index:2;}" +
  ".aurora-store-card:hover .aurora-store-acts{opacity:1;}" +
  ".aurora-store-meta{padding:10px 12px 11px;}" +
  ".aurora-store-nm{font-weight:600;display:flex;align-items:center;gap:6px;word-break:break-word;}" +
  ".aurora-store-glyphs{margin-left:auto;display:flex;gap:3px;flex:none;}" +
  ".aurora-store-glyphs span{width:19px;height:19px;display:grid;place-items:center;" +
  "border-radius:5px;background:var(--surface-sunken,rgba(0,0,0,0.04));" +
  "border:1px solid var(--hairline,rgba(0,0,0,0.08));font-size:0.62em;" +
  "line-height:1;color:var(--text-muted,#777);}" +
  ".aurora-store-ft{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:0.8em;" +
  "color:var(--text-muted,#777);}" +
  ".aurora-store-ft .dl{margin-left:auto;white-space:nowrap;}" +
```

色点条的浮层底色用不透明的 `--surface`：半透明加 `backdrop-filter` 在 LuCI 会遇到的老 WebKit 上会整块糊掉，而这个胶囊压在任意配色的缩略图上，读得清比好看重要。

- [ ] **Step 4: 加 `buildCardGlyphs`**

在 `buildTilesFor` 之后加：

```js
// 卡片上只放前几个 glyph:一行写着"仅颜色"的标签在 252px 宽的卡上占掉整整
// 一行,而它说的东西在抽屉里有完整版本。title 属性留着完整文字。
const CARD_GLYPH_LIMIT = 3;

const buildCardGlyphs = (item) => {
  const entries = tileEntriesFor(item);
  if (!entries || !entries.length) return null;
  return E(
    "span",
    { class: "aurora-store-glyphs" },
    entries.slice(0, CARD_GLYPH_LIMIT).map((entry) => {
      const box = E("span", { title: entry.title || entry.label });
      box.appendChild(
        typeof entry.glyph === "string"
          ? document.createTextNode(entry.glyph)
          : entry.glyph,
      );
      return box;
    }),
  );
};
```

- [ ] **Step 5: 用一个 `buildCard` 取代两个卡片构造器**

把 `buildBuiltinCard`（~1077-1114）和 `buildOnlineCard`（~1116-1164）整体替换成：

```js
    // 内置卡和社区卡画的是同一个东西,只是数据来源不同。两个各自为政的构造器
    // 已经漂移过一次 —— 社区卡长出了徽章而内置卡没有 —— 所以只留一个。
    const buildCard = (model) => {
      const prev = E("div", { class: "aurora-store-prev" }, [
        buildDuo(model.palette, model.opts),
        E("span", { class: "aurora-store-dots" }, [buildDotRow(model.palette)]),
        E("div", { class: "aurora-store-acts" }, [
          E(
            "button",
            {
              type: "button",
              class: "btn cbi-button-action",
              click: (ev) => {
                ev.stopPropagation();
                model.apply();
              },
            },
            model.current ? _("Re-apply") : _("Apply"),
          ),
        ]),
      ]);

      const nm = E("div", { class: "aurora-store-nm" }, [
        document.createTextNode(model.name),
      ]);
      if (model.badge) nm.appendChild(model.badge);
      if (model.glyphs) nm.appendChild(model.glyphs);

      return E(
        "div",
        { class: "aurora-store-card", click: model.open },
        [
          prev,
          E("div", { class: "aurora-store-meta" }, [
            nm,
            E("div", { class: "aurora-store-ft" }, [
              E("span", { style: "word-break:break-all;" }, [
                document.createTextNode(model.author),
              ]),
              E("span", { class: "dl" }, [document.createTextNode(model.right)]),
            ]),
          ]),
        ],
      );
    };

    // 内置卡不带 "Built-in" 徽章:它上方的分区标题已经写着"内置",而每张卡
    // 再重复一遍就是拿掉一行密度换零信息。徽章那个样式类留着,抽屉还在用。
    const buildBuiltinCard = (preset) => buildCard({
      name: preset.label,
      author: "Aurora",
      right: _("Works offline"),
      palette: preset.palette,
      opts: { nav: currentNav },
      badge: null,
      glyphs: null,
      current: preset.id === activePreset,
      open: () => openBuiltinDrawer(preset),
      apply: () => confirmBuiltinApply(preset),
    });

    const buildOnlineCard = (item) => buildCard({
      name: item.name || _("Untitled theme"),
      author: item.author || _("Anonymous"),
      right: formatDownloads(item.downloads),
      palette: paletteOf(item),
      opts: previewOpts(item),
      badge:
        item.assets_status && item.assets_status !== "none"
          ? buildBadge(_("Includes assets"))
          : null,
      glyphs: buildCardGlyphs(item),
      current: false,
      open: () => openOnlineDrawer(item.id),
      apply: () => quickApplyOnline(item.id),
    });
```

`model.current` 目前只有内置卡可能为真（`hub_applied` 存的是名字不是 id，社区卡认不出自己）。Task 4 会用到它。

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "feat(store): cards drop to two rows and the thumbnail grows

A 225px column on a wide screen put five cards in a row and shrank the
thumbnail until the five built-in presets were indistinguishable. The
grid starts at 252px now and the preview is 16/10 rather than 16/9.

The card body loses a row: the swatch strip floats onto the thumbnail,
and the tile row -- most often a single pill reading Colors only --
becomes at most three glyphs beside the name, with the full list still
in the drawer where there is room for it.

Built-in and community cards collapse into one builder. They had
already drifted once."
```

---

## Task 4: 「正在使用」= 对号，没有字

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`（`STORE_CSS` 的 badge 段；`buildCard`；`drawerFoot` ~993-1005；`openBuiltinDrawer` ~1007-1041；Task 1 留下的临时 `buildCurrentTick`）
- Test: `tests/gallery-view.test.mjs`（新增 1 条）

**Interfaces:**
- Consumes: Task 3 的 `buildCard(model)`（读 `model.current`）
- Produces: `buildCurrentPin()` → 压在缩略图角上的实心对号圆片；`buildCurrentTick()` → 跟在文字后面的裸对号（替换 Task 1 的临时版本）；`drawerFoot(applyLabel, onApply, current)` 多一个参数。

- [ ] **Step 1: 写失败的测试**

```js
test("gallery view: the applied configuration is marked, not labelled", async () => {
  const src = await readFile(SRC, "utf8");
  // "Current" 是一枚写着字的药丸,占掉卡片一整行的宽度去说一件描边就能说的事
  assert.ok(!src.includes('_("Current")'), "the Current pill must go");
  assert.ok(!src.includes("aurora-store-badge.current"), "and its style with it");

  assert.match(src, /const buildCurrentPin = /, "thumbnail mark missing");
  assert.match(src, /const buildCurrentTick = /, "inline tick missing");
  assert.ok(
    src.includes(".aurora-store-card.current{border-color:var(--brand"),
    "the applied card must carry a brand border",
  );
  // 对号是几何字符,不是 emoji —— 既有测试禁的是 emoji,这个和 ◑ ◆ ⌘ 同类
  assert.ok(src.includes('}, "✓")'), "the tick glyph is missing");
  assert.match(src, /_\("In use"\)/, "the mark needs an accessible label");
  assert.match(src, /_\("Re-apply"\)/, "applying the current config again is a re-apply");

  // 分类徽章留着 —— 那不是状态
  assert.ok(src.includes("aurora-store-badge.builtin"), "the Built-in badge stays");
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL —— `the Current pill must go`

- [ ] **Step 3: 改 CSS**

把 `.aurora-store-badge.current` 那一段（约 691-692 行）删掉，并在 `.aurora-store-badge.builtin` 之后加：

```js
  ".aurora-store-card.current{border-color:var(--brand,#0086bf);}" +
  ".aurora-store-pin{position:absolute;left:9px;top:9px;z-index:3;width:20px;height:20px;" +
  "border-radius:50%;display:grid;place-items:center;background:var(--brand,#0086bf);" +
  "color:var(--on-brand,#fff);font-size:0.7em;line-height:1;" +
  "box-shadow:0 0 0 2px var(--surface,#fff);}" +
```

`.aurora-store-tick` 那一行（Task 1 加的）保持不变。

`box-shadow` 那圈 2px 的 `--surface` 描边是必须的：缩略图的底色来自任意一份配置，实心 brand 圆片直接压上去可能和背景撞色。

- [ ] **Step 4: 落地两个标记构造器**

把 Task 1 加的临时 `buildCurrentTick` 替换成：

```js
// "正在使用"是一个标记,不是一个词。写着字的药丸在 252px 的卡上占掉一整行
// 的宽度,去说一件描边已经说清楚的事。
//
// 两个形态:压在缩略图角上的实心圆片(缩略图底色是任意的,所以它自带一圈
// surface 描边),和跟在标题文字后面的裸对号。两个都挂 title 属性 —— 一个
// 光秃秃的对号对读屏软件是没有意义的。
const buildCurrentPin = () =>
  E("span", { class: "aurora-store-pin", title: _("In use") }, "✓");

const buildCurrentTick = () =>
  E("span", { class: "aurora-store-tick", title: _("In use") }, "✓");
```

- [ ] **Step 5: 卡片挂上标记**

在 `buildCard` 里，`const prev = ...` 之后加一行：

```js
      if (model.current) prev.appendChild(buildCurrentPin());
```

把 `buildCard` 的返回值里那个 `class` 改成：

```js
        {
          class: "aurora-store-card" + (model.current ? " current" : ""),
          click: model.open,
        },
```

- [ ] **Step 6: 抽屉底部按钮和标题**

把 `drawerFoot`（约 993-1005 行）替换成：

```js
    const drawerFoot = (applyLabel, onApply, current) =>
      E("div", { class: "aurora-store-drawer-foot" }, [
        E("button", { type: "button", class: "btn", click: closeDrawer }, _("Close")),
        current
          ? E(
              "button",
              { type: "button", class: "btn apply", disabled: "disabled" },
              "✓ " + _("In use"),
            )
          : E(
              "button",
              {
                type: "button",
                class: "btn cbi-button-action important apply",
                click: onApply,
              },
              applyLabel,
            ),
      ]);
```

在 `openBuiltinDrawer` 里，把标题那一段和 `drawerFoot` 调用改成：

```js
    const openBuiltinDrawer = (preset) => {
      const current = preset.id === activePreset;
      const title = E("h3", { style: "margin:0 0 0.3em;" }, [
        document.createTextNode(preset.label),
        " ",
        E("span", { class: "aurora-store-badge builtin" }, _("Built-in")),
      ]);
      if (current) title.appendChild(buildCurrentTick());
      renderDrawer([
        buildPanes(preset.palette, { nav: currentNav }),
        E("div", { class: "aurora-store-drawer-body" }, [
          title,
          // ...(其余 children 保持原样)
        ]),
        drawerFoot(_("Apply"), () => confirmBuiltinApply(preset), current),
      ]);
    };
```

`openOnlineDrawer` 里的 `drawerFoot(_("Apply"), () => confirmOnlineApply(item))` 保持两个参数不变——第三个参数是 `undefined`，走非 current 分支，社区配置本来就认不出自己。

- [ ] **Step 7: 跑测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "feat(store): mark the applied configuration, do not label it

A pill spelling out Current sat on a 252px card next to the name and
pushed everything else down. The border already carries that meaning:
it turns brand-coloured, and a filled tick sits on the thumbnail with
its own surface ring so it stays legible over any palette.

The drawer gets the bare tick beside the title and a disabled footer
button instead of a live Apply that would re-run a configuration
already in place. The quick-apply button on the card says Re-apply
there, since re-running it is still a thing someone might want.

Built-in keeps its badge. That one is a category, not a state."
```

---

## Task 5: 详情抽屉正文重做

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`（`buildDetailRow` ~467-471；`buildPaletteChips` ~473-499；`buildDetailBody` ~501-551；`openBuiltinDrawer`；`STORE_CSS` 加抽屉正文样式）
- Test: `tests/gallery-view.test.mjs`（新增 1 条）

**Interfaces:**
- Consumes: Task 2 的 `tileEntriesFor(item)`，Task 4 的 `buildCurrentTick()`
- Produces: `buildKvList(rows)`（`rows` 是 `[[label, value]]`，值为空的行整行丢掉）；`buildDetailHeading(text)`；`radiusJoin(value)`；`buildBundledTiles(item)`。`buildDetailRow` 被删除。

- [ ] **Step 1: 写失败的测试**

```js
test("gallery view: the drawer stops borrowing LuCI's form row", async () => {
  const src = await readFile(SRC, "utf8");
  // cbi-value 右对齐标签列。在一个 460px 的抽屉里,那意味着每个标签和它的值
  // 之间隔着一道峡谷 —— 页面上最难读的东西。
  assert.ok(!src.includes("const buildDetailRow"), "the cbi-value row builder must go");
  assert.ok(!src.includes("cbi-value-title"), "and its classes with it");
  assert.match(src, /const buildKvList = /, "left-aligned key/value list missing");
  assert.match(src, /const buildDetailHeading = /, "section heading builder missing");

  // 颜色分成"浅色/深色"两行,而不是八个 hex 摊平
  assert.match(src, /aurora-store-pal-row/, "the palette must be grouped by mode");
  // 圆角同时给档位名和原值
  assert.match(src, /const radiusJoin = /);
  // "随附内容"滤掉已经在别处说过的那几种
  assert.match(src, /const buildBundledTiles = /);
  assert.match(src, /const BUNDLED_KINDS = \["logo", "loginBg", "siteIcon", "appIcon"\]/);
  assert.ok(!src.includes(".innerHTML"));
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL —— `the cbi-value row builder must go`

- [ ] **Step 3: 加抽屉正文的 CSS**

在 `STORE_CSS` 里，`.aurora-store-drawer-body` 那一行之后加：

```js
  ".aurora-store-drawer{width:460px;}" +
  ".aurora-store-dt-title{margin:0 0 0.25em;word-break:break-word;}" +
  ".aurora-store-dt-sub{color:var(--text-muted,#777);font-size:0.85em;}" +
  ".aurora-store-dt-desc{color:var(--text-muted,#777);font-size:0.9em;" +
  "word-break:break-word;margin:0.8em 0 0;}" +
  ".aurora-store-dt-h{margin:1.4em 0 0.6em;font-size:0.72em;font-weight:700;" +
  "letter-spacing:0.09em;text-transform:uppercase;color:var(--text-subtle,#888);}" +
  ".aurora-store-kv{display:grid;grid-template-columns:auto 1fr;gap:5px 18px;" +
  "margin:0;font-size:0.88em;}" +
  ".aurora-store-kv dt{color:var(--text-muted,#777);white-space:nowrap;}" +
  ".aurora-store-kv dd{margin:0;text-align:right;word-break:break-word;}" +
  ".aurora-store-pal{display:grid;gap:6px;}" +
  ".aurora-store-pal-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}" +
  ".aurora-store-pal-row .l{font-size:0.72em;color:var(--text-subtle,#888);" +
  "width:2.6em;flex:none;}" +
  ".aurora-store-dt-foot{color:var(--text-muted,#777);font-size:0.8em;margin-top:1.4em;}" +
```

`.aurora-store-drawer{width:460px;}` 出现在原规则之后，覆盖掉原来的 440px——比回去改那条长规则安全。

- [ ] **Step 4: 用 `buildKvList` 取代 `buildDetailRow`**

把 `buildDetailRow`（约 467-471 行）替换成：

```js
// LuCI 的 cbi-value 把标签列右对齐。在一个 460px 的抽屉里那就是每个标签和
// 它的值之间隔着一道峡谷 —— 这一页上最难读的东西。一张 <dl>,标签靠左,值
// 靠右,中间没有空档。
//
// 值为空的行整行丢掉:一行写着"间距 -"的东西什么也没说。
const buildKvList = (rows) =>
  E(
    "dl",
    { class: "aurora-store-kv" },
    rows
      .filter((row) => row[1])
      .reduce((nodes, [label, value]) => {
        nodes.push(E("dt", {}, [document.createTextNode(label)]));
        nodes.push(E("dd", {}, [document.createTextNode(value)]));
        return nodes;
      }, []),
  );

const buildDetailHeading = (text) => E("h4", { class: "aurora-store-dt-h" }, text);

// "圆角 · 0.5rem":档位名是读的人想要的,原值是想复现的人需要的。
const radiusJoin = (value) => {
  const label = radiusLabel(value);
  if (!label) return "";
  return value ? label + " · " + value : label;
};
```

- [ ] **Step 5: 颜色按明暗分组**

把 `buildPaletteChips`（约 473-499 行）的后半段（`chipRow` 和 `return`）替换成：

```js
  const chipRow = (label, mode) =>
    E("div", { class: "aurora-store-pal-row" }, [
      E("span", { class: "l" }, label),
      ...SWATCH_KEYS.map((key) => chip((palette[mode] || {})[key])),
    ]);
  return E("div", { class: "aurora-store-pal" }, [
    chipRow(_("Light"), "light"),
    chipRow(_("Dark"), "dark"),
  ]);
```

`chip` 函数体不变，只是去掉它 style 里的 `margin-top:4px`（现在由 `.aurora-store-pal` 的 gap 管）——把 `chipRow` 原来那个内联 style 整个删掉即可。

- [ ] **Step 6: 加 `buildBundledTiles`**

在 `buildCardGlyphs` 之后加：

```js
// 抽屉的"随附内容"。字体和圆角在"布局与排版"那张表里已经写了值,快捷方式
// 自己占一整节 —— 在这里再画一遍就是同一句话说三次。
const BUNDLED_KINDS = ["logo", "loginBg", "siteIcon", "appIcon"];

const buildBundledTiles = (item) => {
  const entries = tileEntriesFor(item);
  if (!entries) return buildLegacyCardTiles(item);
  if (!entries.length) return buildBuiltinTiles();
  const bundled = entries.filter(
    (entry) => BUNDLED_KINDS.indexOf(entry.kind) !== -1,
  );
  return bundled.length ? buildTiles(bundled) : null;
};
```

- [ ] **Step 7: 重写 `buildDetailBody`**

把 `buildDetailBody`（约 501-551 行）整体替换成：

```js
const buildDetailBody = (item) => {
  const payload = item.payload || {};
  const layout = payload.layout || {};
  const typography = payload.typography || {};

  const children = [
    E("h3", { class: "aurora-store-dt-title" }, [
      document.createTextNode(item.name || _("Untitled theme")),
    ]),
    E("div", { class: "aurora-store-dt-sub" }, [
      document.createTextNode(
        (item.author || _("Anonymous")) + " · " + formatDownloads(item.downloads),
      ),
    ]),
  ];

  if (item.description)
    children.push(
      E("p", { class: "aurora-store-dt-desc" }, [
        document.createTextNode(item.description),
      ]),
    );

  children.push(
    buildDetailHeading(_("Colors")),
    buildPaletteChips(item),
    buildDetailHeading(_("Layout & Typography")),
    buildKvList([
      [_("Navigation"), NAV_TYPE_LABELS[layout.nav_type] || layout.nav_type],
      [_("Spacing"), layout.struct_spacing],
      [_("Corner Radius"), radiusJoin(layout.struct_radius_base)],
      [_("Content Width"), layout.struct_content_width_centered],
      [_("Sans Font"), firstFontFamily(typography.struct_font_sans)],
      [_("Mono Font"), firstFontFamily(typography.struct_font_mono)],
    ]),
  );

  const bundled = buildBundledTiles(item);
  if (bundled) children.push(buildDetailHeading(_("Bundled content")), bundled);

  children.push(
    E(
      "p",
      { class: "aurora-store-dt-foot" },
      _(
        "Your current settings are backed up before applying, and you can roll back with one click afterwards.",
      ),
    ),
  );

  return E("div", {}, children);
};
```

原来那行 `buildDetailRow(_("Toolbar"), layout.toolbar_enabled === "1" ? ... )` 在这里没了——Task 6 的快捷方式那一节会连同"工具栏本身是关的"一起说清楚，比一行 `工具栏 已启用` 说得多。

- [ ] **Step 8: `openBuiltinDrawer` 跟上**

把 `openBuiltinDrawer` 里 `buildDetailRow(_("Navigation"), ...)` 那一段（约 1025-1030 行）替换成：

```js
          buildDetailHeading(_("Layout (unchanged by this preset)")),
          buildKvList([
            [_("Navigation"), NAV_TYPE_LABELS[currentNav] || currentNav],
          ]),
```

同时把它里面剩下的三个 `E("h4", { style: "margin:1em 0 0.4em;" }, ...)` 换成 `buildDetailHeading(...)`，那两个内联 style 的 `p` 换成 `class: "aurora-store-dt-desc"` 和 `class: "aurora-store-dt-foot"`。

- [ ] **Step 9: 跑测试确认通过**

Run: `npm test`
Expected: 全部 PASS。特别确认 `"cards and drawer itemise the same configuration identically"`（:385）仍然 PASS。

- [ ] **Step 10: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "feat(store): the drawer stops borrowing LuCI's form row

cbi-value right-aligns the label column. In a 460px drawer that leaves
a canyon between every label and its value, which made the detail panel
the hardest thing on the page to read. It becomes one <dl>: labels
left, values right, nothing in between. Rows with no value are dropped
rather than printed as a dash.

Layout and Typography merge into one table -- they were two headings
over three rows each. Corner radius now gives both the tier name and
the exact value, since one is what a reader wants and the other is what
someone reproducing it needs.

The eight palette hexes group into a Light row and a Dark row. Laid
flat there was no way to tell which four were which.

Bundled content drops the font, radius and shortcut entries: the table
above states the first two and shortcuts get a section of their own."
```

---

## Task 6: 详情里真正列出快捷方式

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js`（`buildDetailBody`；`STORE_CSS` 加快捷方式列表样式）
- Test: `tests/gallery-view.test.mjs`（新增 1 条）

**Interfaces:**
- Consumes: Task 5 的 `buildDetailHeading(text)`、`buildDetailBody(item)`
- Produces: `shortcutTarget(url)` → 去掉 scheme 的显示串；`isExternalShortcut(url)` → 布尔；`buildShortcutRow(entry)` → 一个 `<li>`；`buildShortcutList(toolbar, layout)` → 节点数组或 `null`。

- [ ] **Step 1: 写失败的测试**

```js
test("gallery view: the drawer lists the shortcuts, not just how many", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const buildShortcutList = /, "shortcut section missing");
  assert.match(src, /const buildShortcutRow = /);
  assert.match(src, /const shortcutTarget = /);
  assert.match(src, /const isExternalShortcut = /);

  // 标题和 url 都是 hub 来的自由文本
  assert.match(
    src,
    /document\.createTextNode\(shortcutTarget\(entry\.url\)\)/,
    "the target must go through createTextNode",
  );
  assert.ok(!src.includes(".innerHTML"));

  // 不可信 url 不交给解析器 —— 显示它不需要解析它
  assert.ok(!src.includes("new URL("), "an untrusted url must not reach a parser");

  // 不为 icon 造任何图片:hub 批准的六种资产里没有快捷方式图标,那些字节
  // 从来没有离开过作者的路由器
  assert.match(src, /const SHORTCUT_GLYPH = /, "the icon slot must be a neutral placeholder");
  assert.ok(!/entry\.icon/.test(src), "a shared shortcut icon has no bytes on this router");

  // 关掉的工具栏要说出来,否则这一节在承诺不会出现的东西
  assert.match(src, /toolbar_enabled === "0"/);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `node --test tests/gallery-view.test.mjs`
Expected: FAIL —— `shortcut section missing`

- [ ] **Step 3: 加快捷方式列表的 CSS**

在 `STORE_CSS` 里，`.aurora-store-tile .g` 那一段之后加：

```js
  ".aurora-store-sc{list-style:none;margin:0;padding:0;display:grid;gap:1px;" +
  "border-radius:10px;overflow:hidden;border:1px solid var(--hairline,rgba(0,0,0,0.1));}" +
  ".aurora-store-sc li{display:flex;align-items:center;gap:10px;padding:8px 10px;" +
  "background:var(--surface-sunken,rgba(0,0,0,0.04));font-size:0.85em;}" +
  ".aurora-store-sc li.off{opacity:0.45;}" +
  ".aurora-store-sc .ic{width:24px;height:24px;flex:none;display:grid;place-items:center;" +
  "border-radius:6px;background:var(--surface,#fff);color:var(--text-muted,#777);" +
  "border:1px solid var(--hairline,rgba(0,0,0,0.08));font-size:0.8em;line-height:1;}" +
  ".aurora-store-sc .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;" +
  "white-space:nowrap;}" +
  ".aurora-store-sc .to{font-size:0.85em;color:var(--text-subtle,#888);" +
  "font-family:ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;" +
  "white-space:nowrap;max-width:44%;}" +
  ".aurora-store-sc .ext{flex:none;color:var(--text-muted,#777);font-size:0.85em;}" +
  ".aurora-store-sc-note{color:var(--text-subtle,#888);font-size:0.78em;" +
  "margin:0.5em 0 0;line-height:1.6;}" +
```

- [ ] **Step 4: 加四个构造器**

在 `buildBundledTiles` 之后（`formatDownloads` 之前）加：

```js
// ---------------------------------------------------------------------------
// Shortcuts
//
// 详情以前只写 "Toolbar 4",可 payload.toolbar[] 里 title、url、enabled 一直
// 都在 —— 一个准备把别人的配置装到自己路由器上的人,最该看清楚的就是这四条
// 到底指向哪里。列表行来自 hub 的投影(preview.toolbar)则不带 url:那是详情
// 路径的活,卡片不需要。
//
// SECURITY: 每个 toolbar 条目的 icon 存的是作者路由器上
// /www/luci-static/aurora/images/ 里的文件名,而 hub 只批准六种资产
// (logo_svg / login_bg / favicon_png / favicon_ico / pwa_icon_192 /
// pwa_icon_512,见 root/usr/libexec/rpcd/luci.aurora 的 build_share_payload),
// 快捷方式图标不在其中 —— 那些字节从来没有离开过作者的路由器。为 icon 拼一个
// 路径就是画一张本机没有的图,还是用 hub 给的名字拼的。图标槽因此是一个中性
// 占位符,而真正有用的两列是标题和目标。
const SHORTCUT_GLYPH = "▫";

// hub 的字段是发送方选择发送的任何 JSON 类型,不是 schema 承诺的那个类型。
// String(value) 会尝试把值转成原始值,而当 toString 和 valueOf 都不可调用时
// 它会抛 —— {"toString":"x","valueOf":"y"} 就是这样一个纯 JSON 能表达的形状。
// 不是字符串就当没有,从根上绕开这次转换,而不是转了再 catch。这也是
// externalToolbarUrls 早就在用的写法(typeof entry.url === "string")。
const shortcutText = (value) => (typeof value === "string" ? value : "");

const isExternalShortcut = (url) => /^https?:\/\//.test(shortcutText(url));

// 剥掉 scheme,让站外链接读成它的主机名,本地 LuCI 路径原样留着。刻意是字符串
// 手术而不是交给解析器:这是不可信自由文本,只为了显示它没有理由去解析它。
// (这里不能写出那个解析器构造函数的名字 —— Step 1 的测试断言它不在源码里。)
const shortcutTarget = (url) => shortcutText(url).replace(/^https?:\/\//, "");

// `payload.toolbar` 是从 hub 存的 JSON 里解析出来的,{"toolbar":[null]} 是
// 完全合法的 JSON。数组元素为 null 时,后面任何一处 entry.x 都会抛,而画抽屉
// 的那个 .then() 没有 catch —— 抽屉会永远停在"正在加载"上。所以在函数入口
// 就把参数归一化,后面每一处属性访问都落在一个真对象上。
const buildShortcutRow = (rawEntry) => {
  const entry = rawEntry || {};
  const disabled = entry.enabled === "0";
  const external = isExternalShortcut(entry.url);
  const title = shortcutText(entry.title) + (disabled ? " " + _("(disabled)") : "");
  const children = [
    E("span", { class: "ic" }, [document.createTextNode(SHORTCUT_GLYPH)]),
    E("span", { class: "nm" }, [document.createTextNode(title)]),
    E("span", { class: "to" }, [
      document.createTextNode(shortcutTarget(entry.url)),
    ]),
  ];
  if (external)
    children.push(E("span", { class: "ext", title: _("Opens an external site") }, "↗"));
  return E("li", { class: disabled ? "off" : "" }, children);
};

// 返回 [标题, 列表, ...注脚] 一整节,或者在这份配置没带快捷方式时返回 null。
const buildShortcutList = (toolbar, layout) => {
  const items = Array.isArray(toolbar) ? toolbar : [];
  if (!items.length) return null;

  const nodes = [
    buildDetailHeading(_("Shortcuts %d").format(items.length)),
    E("ul", { class: "aurora-store-sc" }, items.map(buildShortcutRow)),
  ];

  // 带了快捷方式却把工具栏整个关掉是合法的。不说的话这一节就是在承诺
  // 一批不会出现的按钮。
  if (layout && layout.toolbar_enabled === "0")
    nodes.push(
      E(
        "p",
        { class: "aurora-store-sc-note" },
        _("The toolbar itself is turned off in this configuration."),
      ),
    );

  if (items.some((entry) => isExternalShortcut(entry && entry.url)))
    nodes.push(
      E(
        "p",
        { class: "aurora-store-sc-note" },
        _(
          "Links marked ↗ open sites outside your router. You'll be asked to confirm before applying.",
        ),
      ),
    );

  return nodes;
};
```

`_("Opens an external site")` 是给 `↗` 的无障碍标签，也要进 Task 7 的翻译表。

- [ ] **Step 5: 挂进 `buildDetailBody`**

在 `buildDetailBody` 里，`buildKvList([...])` 那个 `children.push(...)` 之后、`const bundled = ...` 之前插入：

```js
  const shortcuts = buildShortcutList(payload.toolbar, layout);
  if (shortcuts) children.push(...shortcuts);
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test`
Expected: 全部 PASS。特别确认 `"external toolbar URLs are surfaced in plaintext before applying"`（:90）仍然 PASS —— 应用前的外链确认框不变，这一节是在它之前多给一次信息，不是替代它。

- [ ] **Step 7: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -m "feat(store): the drawer lists the shortcuts it was counting

Toolbar 4 told you a number. payload.toolbar has carried title, url and
enabled all along, and someone about to put a stranger's configuration
on their router wants to see where those four point -- so the drawer
lists them: title, target, an arrow on anything off-box, and a line
saying those get confirmed before applying.

The icon slot stays a neutral placeholder on purpose. A shortcut icon
names a file in the AUTHOR's images directory, and the hub approves six
asset kinds -- none of them a shortcut icon -- so those bytes never
leave the author's box. Building a path from that name would draw an
image this router does not have, from a string the hub supplied.

A config can carry shortcuts with the toolbar switched off. The section
says so rather than promising buttons that will not appear."
```

---

## Task 7: 新 msgid 的 14 语翻译

**Files:**
- Modify: `scripts/translations.json`
- Regenerate: `po/templates/aurora-config.pot`、`po/<lang>/aurora-config.po`（14 个）
- Test: `tests/gallery-view.test.mjs`（无新增；跑一遍确认没打破）

**Interfaces:**
- Consumes: Task 1、4、5、6 引入的所有新 `_()` 字符串
- Produces: 无代码接口

新增 12 个 msgid：`Ships with the theme, works offline`、`Shared by other people`、`In use`、`Re-apply`、`Layout & Typography`、`Layout (unchanged by this preset)`、`Shortcuts %d`、`(disabled)`、`Opens an external site`、`Links marked ↗ open sites outside your router. You'll be asked to confirm before applying.`、`The toolbar itself is turned off in this configuration.`、`Bundled content`。

停用 3 个：`Current`、`Beyond the preview`、`Browse configurations shared by the community. Click one to see its details.`（`merge-po.mjs` 会把模板里不再出现的条目自动删掉）。

- [ ] **Step 1: 往 `scripts/translations.json` 加 12 条**

在 JSON 顶层对象里加入（保持文件既有的两空格缩进）：

```json
  "Ships with the theme, works offline": {
    "de": "Im Theme enthalten, funktioniert offline",
    "es": "Incluido con el tema, funciona sin conexión",
    "fr": "Fourni avec le thème, fonctionne hors ligne",
    "id": "Disertakan dengan tema, berfungsi offline",
    "it": "Incluso nel tema, funziona offline",
    "ja": "テーマに同梱、オフラインでも使えます",
    "ko": "테마에 포함되어 있으며 오프라인에서도 작동합니다",
    "nl": "Meegeleverd met het thema, werkt offline",
    "pl": "Dołączone do motywu, działa offline",
    "ru": "Входит в состав темы, работает офлайн",
    "tr": "Temayla birlikte gelir, çevrimdışı çalışır",
    "uk": "Входить до складу теми, працює офлайн",
    "zh_Hans": "随主题附带，离线可用",
    "zh_Hant": "隨主題附帶，離線可用"
  },
  "Shared by other people": {
    "de": "Von anderen geteilt",
    "es": "Compartidas por otras personas",
    "fr": "Partagées par d'autres",
    "id": "Dibagikan oleh orang lain",
    "it": "Condivise da altri",
    "ja": "他のユーザーが共有したもの",
    "ko": "다른 사용자가 공유한 것",
    "nl": "Gedeeld door anderen",
    "pl": "Udostępnione przez innych",
    "ru": "Поделились другие пользователи",
    "tr": "Başkalarının paylaştıkları",
    "uk": "Поділилися інші користувачі",
    "zh_Hans": "由其他人分享",
    "zh_Hant": "由其他人分享"
  },
  "In use": {
    "de": "In Verwendung",
    "es": "En uso",
    "fr": "Utilisé",
    "id": "Sedang dipakai",
    "it": "In uso",
    "ja": "使用中",
    "ko": "사용 중",
    "nl": "In gebruik",
    "pl": "W użyciu",
    "ru": "Используется",
    "tr": "Kullanımda",
    "uk": "Використовується",
    "zh_Hans": "正在使用",
    "zh_Hant": "正在使用"
  },
  "Re-apply": {
    "de": "Erneut anwenden",
    "es": "Volver a aplicar",
    "fr": "Réappliquer",
    "id": "Terapkan ulang",
    "it": "Riapplica",
    "ja": "再適用",
    "ko": "다시 적용",
    "nl": "Opnieuw toepassen",
    "pl": "Zastosuj ponownie",
    "ru": "Применить снова",
    "tr": "Yeniden uygula",
    "uk": "Застосувати знову",
    "zh_Hans": "重新应用",
    "zh_Hant": "重新套用"
  },
  "Layout & Typography": {
    "de": "Layout & Typografie",
    "es": "Diseño y tipografía",
    "fr": "Mise en page et typographie",
    "id": "Tata Letak & Tipografi",
    "it": "Layout e tipografia",
    "ja": "レイアウトと書体",
    "ko": "레이아웃 및 서체",
    "nl": "Lay-out en typografie",
    "pl": "Układ i typografia",
    "ru": "Макет и типографика",
    "tr": "Düzen ve tipografi",
    "uk": "Макет і типографіка",
    "zh_Hans": "布局与排版",
    "zh_Hant": "版面與排版"
  },
  "Layout (unchanged by this preset)": {
    "de": "Layout (von dieser Vorlage nicht verändert)",
    "es": "Diseño (este preajuste no lo cambia)",
    "fr": "Mise en page (inchangée par ce préréglage)",
    "id": "Tata letak (tidak diubah oleh preset ini)",
    "it": "Layout (non modificato da questo preset)",
    "ja": "レイアウト（このプリセットでは変更されません）",
    "ko": "레이아웃 (이 프리셋은 변경하지 않음)",
    "nl": "Lay-out (wordt niet gewijzigd door deze preset)",
    "pl": "Układ (ten zestaw go nie zmienia)",
    "ru": "Макет (этот набор его не меняет)",
    "tr": "Düzen (bu ön ayar değiştirmez)",
    "uk": "Макет (цей набір його не змінює)",
    "zh_Hans": "布局（本预设不改动）",
    "zh_Hant": "版面（本預設不變更）"
  },
  "Shortcuts %d": {
    "de": "Verknüpfungen %d",
    "es": "Accesos directos %d",
    "fr": "Raccourcis %d",
    "id": "Pintasan %d",
    "it": "Scorciatoie %d",
    "ja": "ショートカット %d",
    "ko": "바로 가기 %d",
    "nl": "Snelkoppelingen %d",
    "pl": "Skróty %d",
    "ru": "Ярлыки %d",
    "tr": "Kısayollar %d",
    "uk": "Ярлики %d",
    "zh_Hans": "快捷方式 %d",
    "zh_Hant": "捷徑 %d"
  },
  "(disabled)": {
    "de": "(deaktiviert)",
    "es": "(desactivado)",
    "fr": "(désactivé)",
    "id": "(nonaktif)",
    "it": "(disattivato)",
    "ja": "（無効）",
    "ko": "(사용 안 함)",
    "nl": "(uitgeschakeld)",
    "pl": "(wyłączony)",
    "ru": "(отключён)",
    "tr": "(devre dışı)",
    "uk": "(вимкнено)",
    "zh_Hans": "（已关闭）",
    "zh_Hant": "（已關閉）"
  },
  "Opens an external site": {
    "de": "Öffnet eine externe Website",
    "es": "Abre un sitio externo",
    "fr": "Ouvre un site externe",
    "id": "Membuka situs eksternal",
    "it": "Apre un sito esterno",
    "ja": "外部サイトを開きます",
    "ko": "외부 사이트를 엽니다",
    "nl": "Opent een externe site",
    "pl": "Otwiera witrynę zewnętrzną",
    "ru": "Открывает внешний сайт",
    "tr": "Harici bir siteyi açar",
    "uk": "Відкриває зовнішній сайт",
    "zh_Hans": "会打开外部网站",
    "zh_Hant": "會開啟外部網站"
  },
  "Links marked ↗ open sites outside your router. You'll be asked to confirm before applying.": {
    "de": "Mit ↗ markierte Links öffnen Seiten außerhalb Ihres Routers. Vor dem Anwenden werden Sie um Bestätigung gebeten.",
    "es": "Los enlaces marcados con ↗ abren sitios fuera de su router. Se le pedirá confirmación antes de aplicar.",
    "fr": "Les liens marqués ↗ ouvrent des sites extérieurs à votre routeur. Une confirmation vous sera demandée avant application.",
    "id": "Tautan bertanda ↗ membuka situs di luar router Anda. Anda akan diminta konfirmasi sebelum menerapkan.",
    "it": "I link contrassegnati con ↗ aprono siti esterni al router. Ti verrà chiesta conferma prima di applicare.",
    "ja": "↗ の付いたリンクはルーター外のサイトを開きます。適用前に確認を求められます。",
    "ko": "↗ 표시가 있는 링크는 라우터 외부 사이트를 엽니다. 적용하기 전에 확인을 요청합니다.",
    "nl": "Links met ↗ openen sites buiten uw router. U wordt om bevestiging gevraagd voordat er wordt toegepast.",
    "pl": "Odnośniki oznaczone ↗ otwierają witryny poza routerem. Przed zastosowaniem zostaniesz poproszony o potwierdzenie.",
    "ru": "Ссылки со значком ↗ ведут на сайты за пределами роутера. Перед применением потребуется подтверждение.",
    "tr": "↗ işaretli bağlantılar yönlendiricinizin dışındaki siteleri açar. Uygulamadan önce onayınız istenir.",
    "uk": "Посилання зі знаком ↗ ведуть на сайти поза межами роутера. Перед застосуванням буде запит на підтвердження.",
    "zh_Hans": "标 ↗ 的会打开路由器以外的网站，应用前会再确认一次。",
    "zh_Hant": "標 ↗ 的會開啟路由器以外的網站，套用前會再確認一次。"
  },
  "The toolbar itself is turned off in this configuration.": {
    "de": "Die Werkzeugleiste selbst ist in dieser Konfiguration ausgeschaltet.",
    "es": "La barra de herramientas está desactivada en esta configuración.",
    "fr": "La barre d'outils elle-même est désactivée dans cette configuration.",
    "id": "Bilah alat itu sendiri dimatikan dalam konfigurasi ini.",
    "it": "In questa configurazione la barra degli strumenti è disattivata.",
    "ja": "この構成ではツールバー自体がオフになっています。",
    "ko": "이 구성에서는 툴바 자체가 꺼져 있습니다.",
    "nl": "De werkbalk zelf staat uit in deze configuratie.",
    "pl": "W tej konfiguracji sam pasek narzędzi jest wyłączony.",
    "ru": "В этой конфигурации сама панель инструментов отключена.",
    "tr": "Bu yapılandırmada araç çubuğunun kendisi kapalı.",
    "uk": "У цій конфігурації сама панель інструментів вимкнена.",
    "zh_Hans": "这套配置里工具栏本身是关闭的。",
    "zh_Hant": "這套設定裡工具列本身是關閉的。"
  },
  "Bundled content": {
    "de": "Enthaltene Inhalte",
    "es": "Contenido incluido",
    "fr": "Contenu inclus",
    "id": "Konten yang disertakan",
    "it": "Contenuti inclusi",
    "ja": "同梱コンテンツ",
    "ko": "포함된 콘텐츠",
    "nl": "Meegeleverde inhoud",
    "pl": "Dołączona zawartość",
    "ru": "Вложенное содержимое",
    "tr": "Birlikte gelen içerik",
    "uk": "Вкладений вміст",
    "zh_Hans": "随附内容",
    "zh_Hant": "隨附內容"
  },
```

- [ ] **Step 2: 确认 JSON 没写坏**

Run: `node -e "const t=require('./scripts/translations.json'); console.log(Object.keys(t).length)"`
Expected: `69`（原来 57 + 新增 12）

- [ ] **Step 3: 重新生成模板**

Run: `node scripts/gen-pot.mjs`
Expected: 无输出或成功提示；`git diff --stat po/templates/aurora-config.pot` 显示有增有删

- [ ] **Step 4: 确认模板抓到了新字符串、丢掉了停用的**

Run:
```bash
grep -c 'msgid "Shortcuts %d"' po/templates/aurora-config.pot
grep -c 'msgid "In use"' po/templates/aurora-config.pot
grep -c 'msgid "Current"' po/templates/aurora-config.pot
grep -c 'msgid "Beyond the preview"' po/templates/aurora-config.pot
```
Expected: 前两条各 `1`，后两条各 `0`

- [ ] **Step 5: 同步 14 个语种**

Run: `node scripts/merge-po.mjs`
Expected: 成功；`git status --short po/` 列出 14 个 `.po` 文件被修改

- [ ] **Step 6: 抽查 zh_Hans**

Run:
```bash
grep -A1 'msgid "Shortcuts %d"' po/zh_Hans/aurora-config.po
grep -A1 'msgid "In use"' po/zh_Hans/aurora-config.po
grep -c 'msgid "Current"' po/zh_Hans/aurora-config.po
```
Expected: `msgstr "快捷方式 %d"`、`msgstr "正在使用"`、`0`

- [ ] **Step 7: 确认没有语种落下空 msgstr**

Run:
```bash
for lang in de es fr id it ja ko nl pl ru tr uk zh_Hans zh_Hant; do
  printf '%-8s ' "$lang"
  grep -c '^msgstr ""$' "po/$lang/aurora-config.po"
done
```
Expected: 每个语种都是 `1`（只有 po 文件头那个空 msgstr）。若某个语种大于 1，回到 Step 1 把缺的那条补上。

- [ ] **Step 8: 跑全部测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 9: 提交**

```bash
git add scripts/translations.json po/
git commit -m "i18n: translate the redesigned store's strings

Twelve new msgids across fourteen languages, and three retired ones
that merge-po drops with them: Current lost to the tick that replaced
it, Beyond the preview to Bundled content, and the blanket page
description to the per-section subtitles."
```

---

## 收尾验证

- [ ] **在真机或浏览器里过一遍**

用 `/run` 或直接把 `htdocs/luci-static/resources/view/aurora/gallery.js` 同步到路由器的
`/www/luci-static/resources/view/aurora/gallery.js`，硬刷新后逐项确认：

1. 页头两行，标题和搜索、分享按钮同一行，没有那句总说明。
2. 标签是一排胶囊，选中的那个有实底；内置和我的分享带计数。
3. 当前预设那张卡描边是主色，缩略图左上角有对号；悬停时按钮写「重新应用」。
4. 卡片正文只有两行；色点条浮在缩略图右下。
5. 打开一个带快捷方式的社区配置：详情里列出每条的标题和目标，外链带 ↗，下面有一句确认提示。
6. 详情的「布局与排版」是左对齐两列，标签和值之间没有大空档。
7. 颜色分成「浅色」「深色」两行。
8. 浅色和深色主题各看一遍。

- [ ] **确认 i18n 包是新的**

规格里记着：真机上看到的中英混排是设备上的 `luci-i18n-aurora-config` 比代码旧，不是本次改动的问题。验证前先确保装的是当前构建，否则会把旧包的症状误判成新引入的回归。

---

## Self-Review

**Spec 覆盖：** spec §1 页头 → Task 1；§2 标签 → Task 1；§3 分区标题 → Task 1；§4 卡片 → Task 2+3；§5 对号 → Task 4；§6 详情抽屉（颜色分组、去 cbi-value、合并布局与排版、随附内容过滤）→ Task 5，快捷方式 → Task 6；§7 安全约束 → Global Constraints + Task 6 的断言；"需要改的测试"一节 → Task 1 改既有那条，Task 2/3/4/5/6 各新增一条。i18n 在 spec 的交付顺序第 6 步 → Task 7。

**超出 spec 的两处，已在任务里写明理由：**
- Task 5 删掉了详情里的 `Toolbar 启用/停用` 行 —— Task 6 的快捷方式那一节把它说得更完整（连"工具栏整个关掉了"这种情况都覆盖）。
- Task 6 多了一个 msgid `Opens an external site`（`↗` 的无障碍标签），spec 的新 msgid 清单里没有；已并入 Task 7。

**类型一致性：** `tileEntriesFor` 的 `kind` 七个取值在 Task 2 定义、Task 3（`buildCardGlyphs`）和 Task 5（`BUNDLED_KINDS`）消费，名字一致。`buildCurrentTick` 在 Task 1 以占位形式引入、Task 4 替换为正式版本，两处签名相同（无参数）。`drawerFoot` 在 Task 4 加第三个参数 `current`，`openOnlineDrawer` 的两参数调用照旧有效。
