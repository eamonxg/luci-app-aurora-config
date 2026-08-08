import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

const SRC = srcPath("view/aurora/marketplace.js");
const MENU_SRC = repo("root/usr/share/luci/menu.d/luci-app-aurora.json");

test("gallery view is a browse-only view.extend using hub-api", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /^"require view";/m);
  assert.match(src, /require utils\.hub-api as hubApi/);
  assert.match(src, /return view\.extend\(/);
  assert.ok(src.includes("callHubList"), "missing callHubList usage");
  assert.ok(src.includes("callHubGet"), "missing callHubGet usage");
  assert.ok(src.includes("hub-cards"), "missing #hub-cards grid");
  assert.match(src, /style\.backgroundColor/);
  assert.ok(src.includes("ui.showModal"), "missing detail modal");
  assert.ok(src.includes("getStale"), "missing stale-cache paint");
  assert.ok(src.includes("listCache.set"), "missing cache write on refresh");
});

test("gallery view is browse-only this task -- no apply/share actions yet", () => {
  return readFile(SRC, "utf8").then((src) => {
    assert.match(src, /handleSave:\s*null/);
    assert.match(src, /handleSaveApply:\s*null/);
    assert.match(src, /handleReset:\s*null/);
  });
});

test("gallery view never assigns innerHTML with hub-sourced data", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes(".innerHTML"), "no innerHTML with user data");
});

test("gallery view: hub config name always flows through document.createTextNode, never a bare E() child", async () => {
  const src = await readFile(SRC, "utf8");
  // Positive assertion (not just the negative innerHTML check above): every
  // site that renders item.name must wrap it in createTextNode -- a bare
  // string child of E()/ui.showModal can be routed through innerHTML by
  // LuCI, and the hub only strips control characters from names, so a name
  // like "<img src=x onerror=alert(1)>" is otherwise legal hub content.
  //
  // The card site no longer writes item.name directly: buildOnlineCard hands
  // buildCard a model whose `name` field is `item.name || _(...)`, and
  // buildCard is what wraps model.name in createTextNode. Both hops must be
  // in place, or the card could end up passing the raw hub string as a bare
  // E() child.
  assert.match(
    src,
    /name:\s*item\.name\s*\|\|/,
    "buildOnlineCard must feed item.name into the shared card model",
  );
  assert.match(
    src,
    /document\.createTextNode\(\s*model\.name\s*\)/,
    "buildCard must wrap model.name in createTextNode",
  );
  const nameTextNodeSites =
    (src.match(/document\.createTextNode\(\s*item\.name\b/g) || []).length +
    (src.match(/document\.createTextNode\(\s*model\.name\b/g) || []).length;
  assert.ok(
    nameTextNodeSites >= 3,
    `expected item.name to reach the DOM via createTextNode at every render site (card, drawer heading, my-shares row); found ${nameTextNodeSites}`,
  );
  // Modal titles must be static, never the raw hub name.
  assert.ok(
    !/ui\.showModal\(\s*item\.name/.test(src),
    "modal title must never be item.name directly",
  );
});

test("gallery view: marketplace layout with detail drawer (Phase 2)", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("aurora-store-drawer"), "missing detail drawer");
  assert.ok(src.includes("aurora-store-grid"), "missing card grid class");
  assert.match(
    src,
    /require utils\.theme-preview as themePreview/,
    "missing shared preview module (light/dark split lives there)",
  );
  const preview = await readFile(
    srcPath("utils/theme-preview.js"),
    "utf8",
  );
  assert.ok(preview.includes("clipPath"), "missing light/dark split preview");
  assert.match(preview, /HEX_RE/, "preview module must sanitise palette hex values");
  assert.match(src, /_\("All"\)/, "missing All tab");
  assert.match(src, /_\("Built-in"\)/, "missing Built-in tab");
  assert.match(src, /_\("My Shares"\)/, "missing My Shares tab");
});

test("gallery view: built-in presets render offline and apply locally (Phase 2)", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("aurora/presets.json"), "missing local presets data source");
  assert.match(src, /method:\s*"apply_theme_preset"/, "built-in apply must stay on the local rpcd path");
  assert.match(src, /_\("Sage Green"\)/, "missing built-in preset labels");
  assert.ok(src.includes("isBuiltinSeed"), "official hub seeds must be deduped against built-ins");
});

test("gallery view: apply flow calls hub_apply and polls get_hub_status like pollFontCache", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubApply"), "missing callHubApply usage");
  assert.ok(src.includes("callGetHubStatus"), "missing callGetHubStatus usage");
  assert.match(src, /window\.setTimeout/, "missing setTimeout-based polling");
  assert.match(src, /1500/, "missing 1.5s poll interval");
});

// header.ut renders the whole look server-side -- it readfile()s the font CSS
// into the document and stamps every image URL with icon_cache_version -- so
// all of it is evaluated once, at document load. Updating the banner in place
// leaves the user looking at the theme they just replaced.
test("gallery view: a finished online apply reloads the page, not just the banner", async () => {
  const src = await readFile(SRC, "utf8");
  const doneBranch = src.match(
    /status\.state === "done"\)\s*\{([\s\S]*?)\}\s*else if/,
  );
  assert.ok(doneBranch, "missing the done branch of the apply poll");
  assert.ok(
    doneBranch[1].includes("window.location.reload"),
    "a completed apply must reload -- otherwise the page still shows the previous theme",
  );
});

// 审核和「身份没备份」是两件无关的事。拼成一条 msgid,加一个维度就翻一倍。
test("gallery view: the publish notice keeps its two dimensions apart", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    src.includes("Published. Its images are queued for review"),
    "a publish that uploaded images must say they are queued",
  );
  assert.ok(
    !/Published\. Your creator identity/.test(src),
    "the identity warning must stand alone, not be fused into the Published string",
  );
  assert.ok(
    src.includes("Your creator identity lives only on this router"),
    "the identity warning must survive as its own msgid",
  );
});

// 作者发布完会立刻去商店找自己的作品。审核中的作品不在那儿,而这一行是
// 唯一能解释「它去哪了」的地方 —— 没有它,发布成功读起来就是发布失败。
test("gallery view: my-shares explains a review state, and stays silent otherwise", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const reviewNoteFor\s*=/, "missing the review-note helper");
  assert.ok(
    src.includes('status === "pending"'),
    "a queued share must say it is in review",
  );
  assert.ok(
    src.includes('status === "rejected"'),
    "a rejected share must say its images were turned down",
  );
  // 正常态不出声:helper 必须有一条 return null 的路径,而不是给每种状态都
  // 造一行字。
  assert.match(
    src.slice(src.indexOf("const reviewNoteFor")),
    /return null;/,
    "none/approved must render no note at all",
  );
  assert.ok(
    src.includes("reviewNoteFor(item.assets_status)"),
    "buildMyShareRow must consult the helper",
  );
});

// rejectConfig 删掉待审的 assets 行和 R2 对象后把 assets_status 置为
// 'rejected' —— 那条配置一张图都不剩了,徽章却还在说它带着素材。
test("gallery view: only assets that cleared review earn the card badge", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    src.includes('item.assets_status === "approved"'),
    "the card badge must key off approved, not merely non-none",
  );
  assert.ok(
    !/assets_status\s*&&\s*item\.assets_status\s*!==\s*"none"/.test(src),
    "the non-none badge test would keep badging a rejected config",
  );
  assert.ok(
    src.includes('if (status !== "approved") return null;'),
    "buildLegacyCardTiles must narrow to approved too",
  );
  assert.ok(
    !/status\s*===\s*"none"\)\s*return null/.test(src),
    "the old none-only guard must be gone, not merely shadowed",
  );
});

test("gallery view: external toolbar URLs are surfaced in plaintext before applying", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /toolbar/);
  assert.match(src, /url\.startsWith\(\s*"http/, "missing http(s) URL check on toolbar entries");
  assert.ok(src.includes("createTextNode"), "external URLs must render via textContent, not innerHTML");
});

// 横幅没了。「正在使用什么」由卡上的钩子回答,「怎么回去」由「我的配置」那张
// 卡回答 —— 两个问题各有归属,顶部不需要再压一条把其中一个说第二遍。
test("store view: the banner and the standing rollback button are gone", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes("renderBanner"), "renderBanner must be gone");
  assert.ok(!src.includes("aurora-hub-banner"), "the banner element must be gone");
  assert.ok(!src.includes("aurora-store-applied"), "the banner styles must be gone");
  assert.ok(
    !/_\("Restore previous configuration"\)/.test(src),
    "rolling back is clicking your own card, not a button of its own",
  );
});

test("store view: rolling back still goes through callHubRestore, from the card", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /require uci/);
  assert.ok(src.includes("callHubRestore"), "missing callHubRestore usage");
  assert.ok(src.includes("window.location.reload"), "missing reload after restore");
  assert.match(
    src,
    /apply: \(\) => confirmRestore\(\)/,
    "the My-configuration card's apply action is the rollback",
  );
  // 引号内的才算读取:注释里提到它是允许的,那句话正是在解释为什么不再读。
  assert.ok(
    !/"hub_applied"/.test(src),
    "matching must not read hub_applied any more -- it holds a name, not an id",
  );
});

// 三类卡的选中态出自同一个比较。社区卡曾经写死 current:false,所以它永远不可能
// 被选中 —— 那正是应用了社区主题、钩子却留在内置卡上的原因之一。
test("store view: every card's tick comes from active_source plus modified", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /callHubLocalState/);
  assert.match(src, /activeSource === "builtin:" \+ preset\.id/);
  assert.match(src, /activeSource === "hub:" \+ item\.id/);
  assert.ok(
    !/current: false/.test(src),
    "a community card must be able to hold the tick",
  );
  assert.ok(
    !/preset\.id === activePreset/.test(src),
    "matching must not read active_preset any more",
  );
});

// 「我的配置」和另两类卡共用同一套预览访问器 —— 三种卡,一套访问器,同一个外观
// 不可能被画成两个样子。
test("store view: the My-configuration card draws through the shared accessors", async () => {
  const src = await readFile(SRC, "utf8");
  const start = src.indexOf("const buildMineModel");
  assert.ok(start !== -1, "buildMineModel is missing");
  const block = src.slice(start, start + 900);
  assert.match(block, /paletteOf\(/);
  assert.match(block, /previewOpts\(/);
  assert.match(block, /buildCardGlyphs\(/);
  assert.match(block, /name: _\("My configuration"\)/);
  assert.match(block, /current: modified/);
});

test("store view: one slot -- current uci when modified, the backup when not", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /modified \? currentPreview\(\) : backupPreview/);
  assert.match(
    src,
    /if \(!modified && !backupPreview\) return null;/,
    "with nothing of your own and nothing to go back to, the section must not render",
  );
});

test("store view: Mine comes before Built-in and Community", async () => {
  const src = await readFile(SRC, "utf8");
  const render = src.slice(src.indexOf("const renderContent"));
  const mine = render.indexOf("buildMineGrid");
  const builtin = render.indexOf("buildBuiltinGrid");
  const online = render.indexOf("buildOnlineGrid");
  assert.ok(mine !== -1, "the Mine section is missing");
  assert.ok(
    mine < builtin && mine < online,
    "the card you are using should be the first one you see",
  );
});

test("gallery view: apply/restore error copy stays result-only (no mechanism words)", async () => {
  const src = await readFile(SRC, "utf8");
  const mechanismLeaks = [
    /_\(\s*["'][^"']*\bjob\b[^"']*["']\s*\)/i,
    /_\(\s*["'][^"']*\bschema\b[^"']*["']\s*\)/i,
    /_\(\s*["'][^"']*bad_payload[^"']*["']\s*\)/i,
  ];
  mechanismLeaks.forEach((re) => assert.ok(!re.test(src), `mechanism word leaked via ${re}`));
});

test("gallery view: the store survives a phone", async () => {
  const src = await readFile(SRC, "utf8");

  // 报出来的那个 bug:操作单元格曾经是 `td center` + white-space:nowrap,
  // "Update with current configuration" 和 "Delete" 被钉在同一行不许断开 ——
  // 390px 的手机上整行撑到 748px,Delete 掉到屏幕外面去了。
  //
  // 改成 LuCI 自己的 td.cbi-section-actions > div:这一层结构 luci-theme-aurora
  // 和 luci-theme-bootstrap 都认,窄屏下把单元格拉成整行、让里面的按钮换行。
  // 换句话说这里靠的是原生类名,不是本文件另写一条媒体查询。
  assert.match(
    src,
    /class: "td cbi-section-actions"/,
    "the my-shares action cell must be a native LuCI section-actions cell",
  );
  assert.ok(
    !/class: "td center", style: "white-space:nowrap;"/.test(src),
    "the action cell must not pin its buttons to one unbreakable line again",
  );

  // 卡片上的快捷 Apply 按钮靠 :hover 显形。触摸屏没有 hover —— 手机上那颗
  // 按钮以前根本按不到,只能先开抽屉。按指针类型判断而不是按宽度:窄窗口的
  // 桌面浏览器仍然有鼠标。
  assert.ok(
    src.includes("@media (hover:none){.aurora-store-acts{opacity:1;}}"),
    "the card's quick-apply button must be reachable without a hover",
  );
});

test("gallery view: share panel and my-shares management (Task 8)", async () => {
  const src = await readFile(SRC, "utf8");
  // 发布和更新都走 publishCurrentConfig:资产字节由浏览器直传,路由器只发
  // 几 KB 的 begin/commit。原来的 callHubShare/callHubUpdate 把整张图 base64
  // 塞进一个请求,uclient-fetch 走 TLS 推不动。
  assert.ok(src.includes("publishCurrentConfig"), "missing publishCurrentConfig usage");
  assert.ok(src.includes("callHubMe"), "missing callHubMe usage");
  assert.ok(src.includes("callHubDelete"), "missing callHubDelete usage");
  assert.ok(src.includes("confirmDelete"), "missing confirmDelete reuse for delete confirms");
  assert.match(src, /require utils\.asset-upload as assetUpload/);
});

// 原意保留:更新必须带上那条分享的现有名字,否则 hub 的必填校验会拒掉它。
// 现在这件事发生在打开表单的那一刻 —— 名字被填进输入框,提交时随之送出。
test("gallery view: updating a share carries the existing name", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(
    src,
    /const openUpdateForm = \(item\) => \{[\s\S]*?nameInput\.value = item\.name \|\| "";/,
    "openUpdateForm must seed the name field so the update is not sent nameless",
  );
});

test("gallery view: share/update/delete copy stays result-only (no mechanism words)", async () => {
  const src = await readFile(SRC, "utf8");
  const mechanismLeaks = [
    /_\(\s*["'][^"']*\bjob\b[^"']*["']\s*\)/i,
    /_\(\s*["'][^"']*\bschema\b[^"']*["']\s*\)/i,
    /_\(\s*["'][^"']*\btoken\b[^"']*["']\s*\)/i,
    /_\(\s*["'][^"']*bad_payload[^"']*["']\s*\)/i,
    /_\(\s*["'][^"']*pending[^"']*["']\s*\)/i,
  ];
  mechanismLeaks.forEach((re) => assert.ok(!re.test(src), `mechanism word leaked via ${re}`));
});

test("menu: theme store entry registered after theme settings", async () => {
  const menu = JSON.parse(await readFile(MENU_SRC, "utf8"));
  assert.ok(menu["admin/system/aurora/marketplace"], "gallery menu entry missing");
  assert.equal(menu["admin/system/aurora/marketplace"].order, 15);
  assert.equal(
    menu["admin/system/aurora/marketplace"].action.path,
    "aurora/marketplace",
  );
});

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
  // 曾经叫 payloadNav,只看得到详情 payload,所以社区卡片一律画顶栏。
  // 列表行现在带 preview.layout,navOf 两种形状都读。
  assert.match(src, /const navOf = /, "nav_type helper missing");
});

test("gallery view: built-in preset previews draw the preset's own nav_type", async () => {
  const src = await readFile(SRC, "utf8");
  // 内置预设过去只写 62 个色值,导航保持不变,所以缩略图画的是「你当前的导航
  // 形态」。现在预设自己带 nav_type,画当前形态就是画错的东西 —— 卡片和抽屉
  // 都走 previewOpts,和社区卡片同一条路径。
  assert.match(src, /opts:\s*previewOpts\(preset\)/, "built-in card must draw its own nav");
  assert.match(
    src,
    /buildPanes\(paletteOf\(preset\), previewOpts\(preset\)\)/,
    "the built-in drawer must draw the preset's own nav too",
  );
  assert.match(
    src,
    /buildDuo\(model\.palette, model\.opts\)/,
    "buildCard must forward model.opts to buildDuo",
  );
  // currentNav 还在,但只服务发布面板 —— 那里描述的是"你自己的配置"。
  assert.ok(
    !/opts:\s*\{\s*nav:\s*currentNav\s*\}/.test(src),
    "no preview may still stand in the current nav for a preset's own",
  );
});

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

test("gallery view: tiles list what the preview cannot draw", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const buildTiles = /);
  // 卡片和抽屉共用同一份 entry 列表(tileEntriesFor)—— 两个各自为政的版本
  // 已经把同一份配置说成过两回事。老 hub(没有 preview)才退回粗粒度的那块。
  assert.match(src, /const tileEntriesFor = /);
  assert.match(src, /const buildLegacyCardTiles = /);
  assert.match(src, /const buildBuiltinTiles = /);
  // 字体显示族名,不是预设 id —— "geist-sans" 是机制词
  assert.match(src, /const firstFontFamily = /);
  assert.match(src, /struct_font_sans/);
  assert.match(src, /const radiusLabel = /);
  // 标签必须走 createTextNode
  assert.ok(!src.includes(".innerHTML"));
});

test("gallery view: one source of truth for what a config carries", async () => {
  const src = await readFile(SRC, "utf8");
  // 卡片要的是 glyph,抽屉要的是完整 tiles,而且抽屉还要滤掉已经在别处说过的
  // 那几种。两个消费者各自遍历 payload 会重新打开 tileEntriesFor 上方注释
  // 早就关掉的那扇门 —— 同一份配置被说成两回事。
  assert.match(src, /const tileEntriesFor = /, "entry builder missing");
  assert.match(
    src,
    /const buildCardGlyphs = \(item\) => \{\s*\n\s*const entries = tileEntriesFor\(item\);/,
    "buildCardGlyphs must consume tileEntriesFor rather than rebuild the list",
  );
  assert.match(
    src,
    /const buildBundledTiles = \(item\) => \{\s*\n\s*const entries = tileEntriesFor\(item\);/,
    "buildBundledTiles must consume tileEntriesFor rather than rebuild the list",
  );
  for (const kind of ["font", "radius", "logo", "loginBg", "siteIcon", "appIcon", "toolbar"]) {
    assert.ok(src.includes(`kind: "${kind}"`), `entry kind ${kind} missing`);
  }
  // 老 hub 的退化路径和"仅颜色"的兜底都还在 —— 不只是定义在别处,而是
  // buildBundledTiles 的两个分支真的调用了它们。否则两条退路可以被静默地
  // 换成 `return null;`,谁也不会发现配置内容凭空消失了。
  assert.match(src, /const buildLegacyCardTiles = /);
  assert.match(src, /const buildBuiltinTiles = /);
  assert.match(
    src,
    /const buildBundledTiles = \(item\) => \{\s*\n\s*const entries = tileEntriesFor\(item\);\s*\n\s*if \(!entries\) return buildLegacyCardTiles\(item\);\s*\n\s*if \(!entries\.length\) return buildBuiltinTiles\(\);/,
    "buildBundledTiles must actually call the legacy-hub and colors-only fallbacks, not just define them",
  );
});

test("gallery view: only a hub without preview degrades to assets_status", async () => {
  const src = await readFile(SRC, "utf8");
  // 以前列表接口不返回 layout/typography/toolbar,卡片只能用 assets_status。
  // 现在它返回了,所以这条退路只留给还没升级的 hub —— 而且必须留:新客户端
  // 对着老 hub 也得画得出来。降级理由要写在注释里。
  assert.match(src, /assets_status/);
  assert.match(
    src,
    /predates the preview projection/i,
    "the degradation must be explained in a comment",
  );
});

// 这条测试当初禁掉了整套自制胶囊控件。搜索框那一半继续有效 —— 它从来不是
// 问题所在。标签那一半是有意反转的:下划线选中态在深色主题下读作"没有",
// 一块有底色的实心分段在任何主题色下都成立。
// 见 docs/specs/2026-08-04-theme-store-visual-redesign.md 的"明确反转"一节。
test("gallery view: a one-row header with a segmented filter row", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /class: "cbi-input-text"/, "search must stay a standard LuCI input");
  assert.ok(!src.includes("🔍"), "emoji glyph must go");
  assert.ok(!src.includes("aurora-store-search"), "bespoke search pill must go");
  assert.ok(!src.includes(".innerHTML"));

  // 标题那条断言没了:页头里已经不放标题,tab 条自己写着"主题市场"。
  // 见下方 "the tab strip names the page, so the head carries no heading"。
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

  // 一行,不是两行:tabs、弹性间隔、搜索框是同一个 .aurora-store-head 的三个
  // 子元素。之前搜索框自己占一行,而它左边什么都没有,那一整条就是空白。
  assert.match(
    src,
    /const headEl = E\(\s*"div",\s*\{ class: "aurora-store-head" \},\s*\[\s*tabsEl,\s*E\("span", \{ class: "sp" \}\),\s*searchInput,/,
    "tabs, spacer and search must sit in one .aurora-store-head row, in that order",
  );
  // margin-top 会把胶囊组从搜索框的中线上推开 —— 行距归 .aurora-store-head 管。
  assert.ok(
    !/\.aurora-store-filters\{[^}]*margin-top/.test(src),
    "the filter pills must not carry their own top margin inside the shared row",
  );
});

test("gallery view: sharing says what gets shared, inline rather than in a modal", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const buildSharePanel = /, "inline share panel missing");
  assert.match(src, /const shareManifestRows = /, "share manifest missing");
  assert.ok(
    !/ui\.showModal\(\s*_\("Share My Configuration"\)/.test(src),
    "share must no longer be a modal",
  );
  assert.match(src, /const loginBgFilename = /);

  // 图片那几行的体积来自 rpcd 的 shared_images,而不是这里自己数 uci ——
  // 问的是 build_share_payload 打包时问的同一个函数,所以面板上说要发什么、
  // 线路上发的就是什么。字体那两行早就是这个姿态,这次图片跟上了。
  assert.match(src, /sharedImages\.forEach\(/);
  assert.match(src, /_\("Included, %s"\)\.format\(/);
  assert.ok(
    !/detail: _\("Included"\)/.test(src),
    "一句光秃秃的 Included 回答不了「要不要装到我的路由器上」",
  );

  // 超限的那张必须单独说。它现在会被 build_share_payload 跳过 —— 沉默地少发
  // 一张图,用户只会在别人的截图里发现它没了;而在此之前更糟:hub 拒掉整次
  // 分享,屏幕上只有一句"商店拒绝了这份配置"。
  assert.match(src, /_\("Too large to share \(%s; the store's limit is %s\)"\)/);
});

// 体积曾经只给字体写。那条界线站不住:一张 1.8 MB 的登录背景和一份 2 MB 的
// 中文字体,对 flash 只剩一两 MB 的设备是同一个问题,而商店里只有后者说了实话。
// 现在发布侧和使用侧都逐项带体积,字体额外多两句(它落在别处、升级不保留)。
test("gallery view: every asset carries its size, on both sides", async () => {
  const src = await readFile(SRC, "utf8");

  // 发布侧:我要发出去的这些东西各有多大。
  assert.match(src, /sharedFonts\.forEach\(/);
  assert.match(src, /_\("Uploaded with the theme, %s"\)\.format\(/);
  assert.match(src, /sharedImages\.forEach\(/);
  assert.match(src, /sharedToolbarIcons\.filter\(/);

  // 使用侧:每个 tile 自己的体积,加一句图片总计。
  assert.match(src, /const assetBytesOf = /);
  assert.match(src, /meta: sizeLabel\(assetBytesOf\(item, \["logo_svg"\]\)\)/);
  assert.match(src, /meta: bgTileMeta\(item, \["login_bg"\], layout, "struct_login_bg"\)/);
  assert.match(src, /meta: sizeLabel\(assetBytesOf\(item, SITE_ICON_KINDS\)\)/);
  assert.match(src, /meta: sizeLabel\(assetBytesOf\(item, APP_ICON_KINDS\)\)/);
  assert.match(src, /meta: sizeLabel\(assetBytesOf\(item, TOOLBAR_ICON_KINDS\)\)/);
  assert.match(src, /_\("Images: %s in total\."\)/);

  // 字体那两句是额外的,不是替代:它们说的是"存在哪、升级后还在不在",
  // 那是体积之外的信息。
  assert.match(src, /asset\.kind === "font_sans" \|\| asset\.kind === "font_mono"/);
  assert.match(src, /Includes %s of font files/);
  assert.match(src, /writable partition/);
  assert.match(src, /firmware upgrade/);
});

// 字体和图标不是一回事:自己画的 logo 是自己的,而一份字体绝大多数情况下是
// 别人的作品,多数商业授权明确不允许再分发。这句话必须在按下发布之前就在
// 眼前 —— 而且只在真的要发字体时才出现,否则它就成了人人都学会跳过的噪音。
test("gallery view: publishing a font asks about redistribution rights", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /if \(sharedFonts\.length\)/);
  assert.match(src, /right to redistribute it/);
  assert.match(src, /commercial font licences do not allow it/);
});

// 版权这件事两边都要说,但方向相反:发布面板问「你有权发吗」,详情抽屉只能
// 说「这不是商店的字体,授权没人核实过」—— 说得更满就是替上传者担保。
test("gallery view: the drawer says the licence is unverified", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /does not verify its licence/);
});

test("gallery view: a re-render must not destroy a half-typed share", async () => {
  const src = await readFile(SRC, "utf8");
  // renderContent() 重建面板(搜索框每次按键、迟到的列表请求都会触发),
  // 所以三个输入框必须建在 buildSharePanel 之外,重渲染时复用同一批节点。
  const panelAt = src.indexOf("const buildSharePanel = ");
  assert.ok(panelAt !== -1, "buildSharePanel missing");
  ["nameInput", "descInput", "nicknameInput", "errEl", "submitBtn"].forEach(
    (name) => {
      const declAt = src.indexOf("const " + name + " = E(");
      assert.ok(declAt !== -1, `${name} declaration missing`);
      assert.ok(
        declAt < panelAt,
        `${name} is rebuilt by buildSharePanel, so a re-render throws away what the user typed`,
      );
    },
  );
});

test("gallery view: publishing stays disabled until the panel is gone", async () => {
  const src = await readFile(SRC, "utf8");
  // 成功分支里提前解禁按钮,会在 my-shares 往返期间留下一个可再次点击的
  // 「发布」按钮 —— 第二次点击就是重复发布。
  assert.ok(
    !/\.then\(\s*\(res\) => \{\s*endSubmit\(\);/.test(src),
    "submit button must not be re-enabled before the result is known",
  );
  assert.match(
    src,
    /\} else \{\s*endSubmit\(\);\s*showError\(/,
    "the failure branch must be the one that re-enables the button",
  );
  // 禁用是防重复提交,不是等待反馈 —— 一个按不动又没有任何变化的按钮读起来
  // 就是坏了。转圈和禁用一起加、一起撤。
  assert.match(
    src,
    /submitBtn\.disabled = true;\s*submitBtn\.classList\.add\("spinning"\);/,
    "publishing must show the spinner, not just go dead",
  );
  assert.match(
    src,
    /const endSubmit = \(\) => \{\s*submitBtn\.disabled = false;\s*submitBtn\.classList\.remove\("spinning"\);/,
    "one restore path for all three endings",
  );
  // claim 昵称那趟往返发生在第一个资源上传之前,进度行原先在那几秒里是空的。
  assert.match(
    src,
    /renderShareProgress\(\{ phase: "begin" \}\);/,
    "the progress line must start before the nickname round trip, not after it",
  );
});

test("gallery view: the toolbar count is what the share actually sends", async () => {
  const src = await readFile(SRC, "utf8");
  // theme.js 只校验非空,shell 会静默丢弃越界项并在 12 条处停止 ——
  // 直接数 section 会承诺根本发不出去的快捷方式。
  assert.match(src, /const isSharedToolbarItem = /, "toolbar validation mirror missing");
  assert.match(src, /const MAX_SHARED_TOOLBAR_ITEMS = 12;/, "the cap of 12 is not mirrored");
  assert.match(
    src,
    /uci\.sections\("aurora", "toolbar_item"\) \|\| \[\]\)\.filter\(isSharedToolbarItem\)/,
    "the count must filter, not just measure the section array",
  );
  // 重复是有意的,必须写明抄自哪个函数的哪几行
  assert.match(
    src,
    /root\/usr\/libexec\/rpcd\/luci\.aurora, build_share_payload:/,
    "the duplication must name the shell function it mirrors",
  );
  assert.match(src, /lines 637-660/, "the mirrored line range must be named");
});

test("share manifest skips exactly the filenames the theme itself ships", async () => {
  const js = await readFile(SRC, "utf8");
  const shell = await readFile(repo("root/usr/libexec/rpcd/luci.aurora"), "utf8");

  // shell 侧:is_theme_shipped_image 的两条 case 分支
  const fnMatch = /is_theme_shipped_image\(\) \{[\s\S]*?\n\}/.exec(shell);
  assert.ok(fnMatch, "could not find is_theme_shipped_image in luci.aurora");
  const shellNames = [...fnMatch[0].matchAll(/^\t([A-Za-z0-9.\-|]+)\) return 0 ;;$/gm)]
    .flatMap((m) => m[1].split("|"))
    .sort();

  const jsMatch = /const THEME_SHIPPED_NAMES = \[([\s\S]*?)\];/.exec(js);
  assert.ok(jsMatch, "THEME_SHIPPED_NAMES not found in marketplace.js");
  const jsNames = [...jsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

  // A test comparing two empty arrays would pass while proving nothing --
  // make sure both captures actually found the names.
  assert.equal(shellNames.length, 9, "shell-side capture did not find 9 names");
  assert.equal(jsNames.length, 9, "js-side capture did not find 9 names");

  assert.deepEqual(
    jsNames,
    shellNames,
    "the share manifest and the rpcd script disagree about which files the theme ships",
  );
  // 默认工具栏那四个必须在里面:一条指着 overview.svg 的快捷方式不需要上传
  // 任何字节,而让它占掉一个 toolbar_icon_<k> 编号,接收端从那里往后的图标
  // 就全部错位。
  for (const name of ["network.svg", "overview.svg", "software.svg", "system.svg"]) {
    assert.ok(jsNames.includes(name), `${name} must count as theme-shipped`);
  }
});

// 扫的是代码不是散文:安全注释本身会点到被禁 API 的名字。
const codeOf = (src) => src.replace(/^\s*\/\/.*$/gm, "");

test("gallery view reads item.preview and falls back to the deprecated palette", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const previewOf = /, "missing preview accessor");
  // A new client must still work against a hub that predates the projection.
  assert.ok(src.includes("item.palette"), "palette fallback dropped");
  // ...and against a detail row, which carries the full payload instead.
  assert.ok(
    src.includes("payload.colors"),
    "detail payload colors path dropped",
  );
});

test("gallery view: community cards draw the config's own navigation shape", async () => {
  const src = await readFile(SRC, "utf8");
  // payloadNav only ever saw the detail payload, so every card drew a top
  // bar. preview.layout.nav_type is on the list row now.
  assert.ok(!src.includes("payloadNav"), "payloadNav must be replaced by navOf");
  assert.match(src, /const navOf = /, "missing navOf");
  // buildOnlineCard now hands the shared buildCard a model whose opts come
  // from previewOpts(item) (== { nav: navOf(item), logo: logoUrlOf(item) }),
  // and buildCard is what forwards opts to buildDuo.
  assert.match(
    src,
    /opts:\s*previewOpts\(item\)/,
    "the community card must pass previewOpts(item) as opts",
  );
  assert.match(
    src,
    /const previewOpts = \(item\) => \(\{\s*nav:\s*navOf\(item\)/,
    "previewOpts must derive nav from navOf(item)",
  );
  assert.match(
    src,
    /buildDuo\(model\.palette, model\.opts\)/,
    "buildCard must forward model.opts to buildDuo",
  );
});

test("gallery view: the logo reaches the page only as an img src", async () => {
  const code = codeOf(await readFile(SRC, "utf8"));
  assert.ok(!code.includes(".innerHTML"), "no innerHTML with hub data");
  assert.ok(
    !/insertAdjacentHTML|DOMParser|createContextualFragment/.test(code),
    "hub SVG must never be parsed as markup",
  );
  // The url is built by hub-api's validating join, never string-concatenated
  // from a hub-supplied path here.
  assert.match(code, /hubApi\.hubAssetUrl\(/, "logo url must go through hubAssetUrl");
  assert.ok(!/HUB_BASE/.test(code), "gallery must not know the hub base");
  // The image itself is built by the shared preview module, which owns the
  // error fallback.
  assert.match(code, /themePreview\.logoImage\(/, "logo tile must reuse the shared img builder");
});

test("gallery view: login backgrounds stay a label, and only cheap images reach a card", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /kind === "logo_svg"/, "logo lookup missing");
  // /assets/:id/:kind streams the original image (login_bg is capped at
  // 2 MiB); 24 cards each pulling one is not acceptable. So login_bg stays a
  // glyph tile.
  assert.match(
    src,
    /glyph: "▣",\s+label: ASSET_LABELS\.loginBg/,
    "login background must stay a glyph tile",
  );

  // 两个取 url 的地方,一个都不能多:logo(卡片和抽屉都画,每张 SVG 几 KB)和
  // 快捷方式图标(**只**在抽屉里画,每张最多 256 KiB,一次最多 12 张)。
  // 再多一处就要先回答"这会不会让一页 24 张卡各拉一张大图"。
  assert.equal(
    (src.match(/hubAssetUrl\(/g) || []).length,
    2,
    "exactly two places turn a hub asset path into a url",
  );
  const bodyOf = (name) => {
    const start = src.indexOf(`const ${name} = `);
    assert.ok(start !== -1, `${name} not found`);
    return src.slice(start, src.indexOf("\n};", start));
  };
  assert.match(bodyOf("logoUrlOf"), /hubAssetUrl\(/);
  assert.match(bodyOf("shortcutIconUrls"), /hubAssetUrl\(/);

  // 快捷方式图标只走详情路径。列表行的 preview 投影带 assets 但不带 size,
  // 而卡片本来也只画 glyph —— 这一条钉住"抽屉才调它"。
  assert.match(
    src,
    /buildShortcutList = \(item, toolbar, layout\)/,
    "shortcut list must take the item so it can resolve icon assets",
  );
  assert.ok(
    !/buildCardGlyphs[\s\S]{0,400}shortcutIconUrls/.test(src),
    "cards must never resolve shortcut icon urls",
  );
});

test("gallery view: cards and drawer itemise the same configuration identically", async () => {
  const src = await readFile(SRC, "utf8");
  // Two builders had cards saying "Includes custom content" while the drawer
  // listed the pieces. Both now derive their list from tileEntriesFor(item)
  // instead of each rebuilding it from the payload, so they cannot drift
  // back apart.
  assert.match(src, /const tileEntriesFor = /, "missing shared entry builder");
  assert.match(
    src,
    /const buildCardGlyphs = \(item\) => \{\s*\n\s*const entries = tileEntriesFor\(item\);/,
    "buildCardGlyphs must derive from tileEntriesFor",
  );
  assert.match(
    src,
    /const buildBundledTiles = \(item\) => \{\s*\n\s*const entries = tileEntriesFor\(item\);/,
    "buildBundledTiles must derive from tileEntriesFor",
  );
  assert.ok(
    !src.includes("buildDetailTiles"),
    "buildDetailTiles must be folded into tileEntriesFor",
  );
  // A hub that predates the projection sends no preview at all: claiming
  // "Colors only" there would be a lie, so the coarse signal survives. That
  // means buildBundledTiles must actually call the fallback on its null
  // branch, not merely have it defined somewhere else in the file.
  assert.match(src, /const buildLegacyCardTiles = /, "missing pre-preview fallback");
  assert.match(
    src,
    /const buildBundledTiles = \(item\) => \{\s*\n\s*const entries = tileEntriesFor\(item\);\s*\n\s*if \(!entries\) return buildLegacyCardTiles\(item\);/,
    "buildBundledTiles must call the legacy-hub fallback on its null branch",
  );
  assert.ok(src.includes("Includes custom content"), "coarse fallback copy dropped");
});

test("gallery view: one card builder, two rows of metadata", async () => {
  const src = await readFile(SRC, "utf8");
  // 内置卡和社区卡是同一个东西的两个数据源。两个构造器已经漂移过一次
  // (社区卡长出了徽章行,内置卡没有),不给它第二次机会。
  assert.match(src, /const buildCard = \(model\) => \{/, "shared card builder missing");
  assert.match(src, /const buildBuiltinCard = \(preset\) => buildCard\(/);
  assert.match(src, /const buildOnlineCard = \(item\) => buildCard\(/);

  // 卡片上是 glyph,不是整行 tiles —— 完整清单只在抽屉里出
  assert.match(src, /const buildCardGlyphs = /);
  assert.match(
    src,
    /const buildBuiltinCard = \(preset\) => buildCard\(\{[\s\S]*?glyphs: buildCardGlyphs\(preset\),/,
    "a built-in card must show its own font and corner glyphs",
  );
  assert.ok(
    !src.includes("buildBundledTiles(preset)"),
    "a built-in card must not carry the drawer's full tile row",
  );

  assert.ok(src.includes("minmax(225px,1fr)") === false, "the grid must widen");
  // 252px 是卡片的目标宽度,min(...,100%) 是它的下限保护:auto-fill 在容器
  // 比 252px 还窄时照样铺一条 252px 的轨道,网格就从手机屏幕右边溢出去了。
  assert.ok(
    src.includes("minmax(min(252px,100%),1fr)"),
    "grid must be 252px, clamped to the container so it can't overflow a phone",
  );
  assert.ok(src.includes("aspect-ratio:16/10"), "the preview must gain height");
  // 色点条浮到预览上,卡片正文因此少一整行
  assert.ok(
    src.includes(".aurora-store-dots{position:absolute"),
    "the swatch row must float on the preview",
  );
});

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
  // "随附内容"滤掉已经在别处说过的那几种(字体除外:名字在布局表里,但随附
  // 文件的体积只有这里说)
  assert.match(src, /const buildBundledTiles = /);
  assert.match(src, /const BUNDLED_KINDS = \["font", "logo", "loginBg", "mainBg", "siteIcon", "appIcon"\]/);
  assert.ok(!src.includes(".innerHTML"));
});

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

  // 图标的字节现在跟着配置走(toolbar_icon_<k>),所以抽屉可以画真图 ——
  // 但只能从 hub 那条路径画。entry.icon 是**作者路由器上**的文件名,拿它拼
  // /luci-static/aurora/images/ 就是在用 hub 给的名字读本机文件系统。
  assert.match(src, /const SHORTCUT_GLYPH = /, "there must still be a fallback glyph");
  assert.match(src, /const shortcutIconUrls = /, "shortcut icons must resolve to hub assets");
  assert.ok(
    !/["'`]\/luci-static\/aurora\/images\/["'`]\s*\+/.test(src),
    "an author's icon filename must never be concatenated into a local path",
  );
  // 名字只用来在 assets 里查编号,查不到就退回占位符。
  assert.match(src, /shortcutText\(entry\.icon\)/);

  // 关掉的工具栏要说出来,否则这一节在承诺不会出现的东西
  assert.match(src, /toolbar_enabled === "0"/);

  // buildShortcutList existing is not enough -- buildDetailBody must actually
  // call it and splice the result in, or the whole section is dead code with
  // a green suite (verified by deleting these two lines and re-running).
  assert.match(
    src,
    /const shortcuts = buildShortcutList\(item, payload\.toolbar, layout\);\s*\n\s*if \(shortcuts\) children\.push\(\.\.\.shortcuts\);/,
    "buildDetailBody must actually render the shortcut section, not just define its builder",
  );
});

test("gallery view: a hostile toolbar entry cannot crash the drawer", async () => {
  const src = await readFile(SRC, "utf8");
  // Hub storage is JSON, and {"toolbar": [null]} is ordinary valid JSON:
  // Array.isArray(toolbar) still passes, items.map(buildShortcutRow) still
  // calls buildShortcutRow(null), and any entry.x read past that point
  // throws. buildDetailBody runs inside a .then() with no .catch(), so an
  // uncaught throw here leaves the drawer stuck on "Loading theme
  // details…" forever -- the failure mode this file already documents
  // around isSharedToolbarItem (search FACTORY_ASSET_NAMES nearby).
  //
  // The fix is a single normalization at the top of the function, before
  // any entry.x access -- not a guard on each read individually (that is
  // the version that shipped once and still let entry.url through bare).
  assert.match(
    src,
    /const buildShortcutRow = \(entry, iconUrls\) => \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*entry = entry \|\| \{\};/,
    "buildShortcutRow must normalize its parameter before any entry.x access",
  );
});

test("gallery view: a hostile toolbar field, not just a hostile element, cannot crash the drawer", async () => {
  const src = await readFile(SRC, "utf8");
  // {"title": {"toString": "x", "valueOf": "y"}} is ordinary valid JSON too:
  // neither key is callable, so String(entry.title) throws "Cannot convert
  // object to primitive value" instead of returning text. entry = entry ||
  // {} guards a hostile array element; it does nothing for a hostile field
  // on an otherwise normal element. Treating anything that is not already a
  // string as absent -- the same idiom externalToolbarUrls already uses
  // (typeof entry.url === "string") -- sidesteps the coercion instead of
  // attempting and catching it.
  assert.match(
    src,
    /const shortcutText = \(value\) => \(typeof value === "string" \? value : ""\);/,
    "a typed-string guard for untrusted toolbar fields is missing",
  );

  // Every read of an untrusted toolbar field in this section must go
  // through the guard above rather than coercing with String() directly.
  //
  // The scheme regex is bound to EXTERNAL_URL_RE rather than written inline:
  // a regex literal sitting right after an arrow gets minified into a syntax
  // error by jsmin -- see tests/jsmin-safety.test.mjs. Only the shape of the
  // regex moved; both reads still go through shortcutText.
  assert.ok(
    src.includes(
      'const isExternalShortcut = (url) => EXTERNAL_URL_RE.test(shortcutText(url));',
    ),
    "isExternalShortcut must read the url through the string guard",
  );
  assert.ok(
    src.includes(
      'const shortcutTarget = (url) => shortcutText(url).replace(EXTERNAL_URL_RE, "");',
    ),
    "shortcutTarget must read the url through the string guard",
  );
  assert.ok(
    src.includes(
      'const title = shortcutText(entry.title) + (disabled ? " " + _("(disabled)") : "");',
    ),
    "the title read must go through the string guard",
  );
  assert.ok(!src.includes("String(entry.title"), "title must not be coerced with String()");
  assert.ok(!src.includes("String(url ||"), "url must not be coerced with String()");
});

test("gallery view: the nickname is account state, not a publish field", async () => {
  const src = await readFile(SRC, "utf8");
  // The hub owns the nickname now; a localStorage copy would go stale the
  // moment the user renames from another browser.
  assert.ok(!src.includes("HUB_NICK_KEY"), "stale localStorage nickname cache");
  assert.ok(!src.includes("aurora.hub.nick"), "stale localStorage key");
  assert.ok(src.includes("callHubSetNickname"), "nickname must be set through its own call");
  // Identity is shown, not re-typed, once it exists.
  assert.ok(src.includes("profile.nickname"), "publish panel must read the profile");
});

test("gallery view: a taken nickname reads as a result, not a code", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /nickname_taken:\s*_\(/);
  assert.ok(!/_\("nickname_taken"\)/.test(src), "raw error code must not surface");
  assert.ok(!src.includes("invalid_author"), "author copy outlived the author field");
});

test("gallery view: the key backup path exists and warns before overwriting", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubExportKey"), "missing export call");
  assert.ok(src.includes("callHubImportKey"), "missing import call");
  // Importing over an account that still owns work is unrecoverable -- the
  // old key is gone unless it was saved elsewhere -- so the count has to be
  // part of the decision.
  assert.ok(src.includes("myShares.length"), "import must consider existing work");
  assert.match(src, /aurora-creator-key\.txt/);
  // The key must never be painted into markup as a bare string child.
  assert.ok(!src.includes(".innerHTML"), "no innerHTML");
});

test("gallery view: the empty state offers recovery, not just publishing", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    src.includes("restoreIdentityPrompt"),
    "empty state must reach the identity-restore flow",
  );
  assert.match(src, /hub_key_saved/, "the backup reminder must read its uci flag");
});

test("gallery: hub_me seeds the cache, and a failed one must not wipe my shares", async () => {
  const src = await readFile(SRC, "utf8");
  const start = src.indexOf("const refreshMyShares");
  assert.ok(start > 0, "refreshMyShares not found");
  const fn = src.slice(start, src.indexOf("const applyMe", start));
  assert.ok(fn.includes("meCache.set"), "refreshMyShares must seed meCache on success");
  // 断网时把用户已发布的作品从界面抹掉,看起来像作品没了。保留上一帧才诚实
  // —— 我们只是没拿到新数据。
  assert.ok(
    !fn.includes("res.data : null"),
    "refreshMyShares must not applyMe(null) on failure",
  );
});

// 本设计的核心不变量,值得被钉住:LuCI 在 load() resolve 前不会进 render(),
// 所以 load() 里任何一次到 hub 的往返都等于首屏白屏 0.8s 起步。
test("gallery load() waits on nothing but local sources", async () => {
  const src = await readFile(SRC, "utf8");
  const body = src.slice(src.indexOf("  load() {"), src.indexOf("  render(loadData) {"));
  assert.ok(body.length > 0, "load() body not found");
  assert.ok(!body.includes("callHubList"), "callHubList must not block first paint");
  assert.ok(!body.includes("callHubMe"), "callHubMe must not block first paint");
  assert.ok(body.includes("presets.json"), "load() still reads the bundled presets");
  assert.ok(body.includes('uci.load("aurora")'), "load() still reads uci");
});

test("gallery paints from cache first, then goes to the network", async () => {
  const src = await readFile(SRC, "utf8");
  // 锚点是首屏挂载前的最后一件事:从缓存取一份列表先画上。横幅没了之后
  // renderBanner() 不再能当锚。
  const tail = src.slice(src.lastIndexOf("hubApi.listCache.getStale()"));
  assert.ok(tail.includes("meCache.getStale"), "my shares must paint from cache");
  assert.ok(tail.includes("appendChild"), "the tail should mount the DOM");
  // 顺序要求:两个请求都在 DOM 挂载之后
  assert.ok(
    tail.indexOf('fetchSort("hot")') > tail.indexOf("appendChild"),
    "the list fetch must come after the first paint is mounted",
  );
  assert.ok(
    tail.indexOf("refreshMyShares()") > tail.indexOf("appendChild"),
    "hub_me must come after the first paint is mounted",
  );
  // loadData 不再携带这两份网络结果
  assert.ok(!tail.includes("loadData.listRes"), "listRes is gone from loadData");
  assert.ok(!tail.includes("loadData.meRes"), "meRes is gone from loadData");
});

test("gallery: importing a creator key drops the previous account's cached profile", async () => {
  const src = await readFile(SRC, "utf8");
  const i = src.indexOf("callHubImportKey");
  assert.ok(i > 0, "callHubImportKey not found");
  const block = src.slice(i, i + 1200);
  assert.ok(
    block.includes("meCache.clear()"),
    "a new key means a different account -- the cached profile is someone else's",
  );
});

test("backup dialog: masked by default, with show/copy/download and an insecure-context copy fallback", async () => {
  const src = await readFile(SRC, "utf8");

  // 弹窗标题与正文改说“身份”,不再说“密钥”。
  assert.ok(
    src.includes('_("Back up your creator identity")'),
    "backup dialog must be titled with the identity wording",
  );
  assert.ok(
    !src.includes('_("Back up your creator key")'),
    "the old key wording must be gone",
  );

  // 默认遮住:先渲染掩码,点“显示”才换成真值。
  assert.match(src, /const KEY_MASK = "•"\.repeat\(64\)/);
  assert.ok(src.includes('_("Show")') && src.includes('_("Hide")'));

  // 复制按钮 + 复制成功的瞬时反馈。
  assert.ok(src.includes('_("Copy")') && src.includes('_("Copied")'));
  assert.ok(src.includes('_("Download backup file")'));

  // http://192.168.1.1 不是 secure context,navigator.clipboard 是 undefined。
  // execCommand 兜底才是真正会跑的那条路径。
  assert.match(src, /navigator\.clipboard && navigator\.clipboard\.writeText/);
  assert.match(src, /document\.execCommand\("copy"\)/);

  // 复制失败不能是死路:把身份亮出来让人手动选。
  assert.ok(
    src.includes(
      '_("Couldn\'t copy. The identity is shown above — select it and copy it manually.")',
    ),
    "copy failure must fall back to revealing the identity",
  );
});

test("restore dialog: identity wording, a real file button, and one parse path", async () => {
  const src = await readFile(SRC, "utf8");

  assert.match(src, /const restoreIdentityPrompt = \(\) =>/);
  assert.ok(
    !src.includes("importKeyPrompt"),
    "importKeyPrompt must be renamed everywhere, call sites included",
  );

  assert.ok(src.includes('_("Restore your creator identity")'));
  assert.ok(src.includes('_("That doesn\'t look like a creator identity.")'));
  assert.ok(src.includes('_("Couldn\'t restore that identity. Check it and try again.")'));
  assert.ok(src.includes('_("Choose backup file…")'));

  // 恢复框里曾经还有一个「先备份当前身份」按钮。身份卡上已经有一个备份入口,
  // 这里再放一个就是同一件事的第二条岔路 —— 一个对话框只做一件事。
  assert.ok(
    !src.includes('_("Back up the current identity first")'),
    "the restore dialog must not carry a second backup entry point",
  );
  assert.equal(
    (src.match(/backupKeyPrompt\(\)/g) || []).length,
    1,
    "backup must have exactly one entry point (the identity card)",
  );
  // 警告本身留着:它讲的是换身份的后果,不是一条通往别处的入口。
  assert.ok(
    src.includes(
      '_("This router already has shared configurations of its own. Switching to another identity gives them up for good — back up the current identity first if you still want them.")',
    ),
    "the irreversibility warning must survive the button it used to sit above",
  );

  // 文件选择器被 label 包住并隐藏 —— 浏览器默认的 "未选择文件" 在这里是噪音。
  assert.match(src, /class: "cbi-button aurora-store-filebtn"/);
  assert.match(src, /picker\.style\.display = "none"/);

  // 弹窗自身的旧措辞。两个"导入"按钮标签还挂在 keybar 和空态上,它们连同
  // 那两处一起消失 —— 断言在下面身份卡和空态的用例里。
  assert.ok(!src.includes('_("That doesn\'t look like a creator key.")'));
  assert.ok(!src.includes('_("Couldn\'t use that key. Check it and try again.")'));
});

test("identity card: names the router's creator, and carries back-up / rename / restore", async () => {
  const src = await readFile(SRC, "utf8");

  assert.match(src, /const buildIdentityCard = \(\) =>/);
  assert.ok(!src.includes("buildKeyBar"), "buildKeyBar must be gone, call site included");

  // 一张卡两个状态。没有身份时它照画 —— 只是名字换成"还没有创作者身份",
  // 动作只剩「恢复…」。此前这里 return null,于是一台刚刷好的路由器在「我的」
  // 页上只剩一句"还没有分享过",而带着备份文件从旧路由器过来的人要的恰恰
  // 就是这一屏上的恢复入口。
  assert.ok(
    !/if \(!profile\.id\) return null;/.test(src),
    "a router without an identity must still get the card -- that is where Restore lives",
  );
  assert.ok(
    src.includes('_("No creator identity yet")'),
    "the empty identity state must name itself",
  );
  assert.ok(
    src.includes('_("Created the first time you publish — or restore one you backed up.")'),
    "the empty identity state must say where an identity comes from",
  );
  // 数据还没回来时才 return null:那时 profile 是空的,画空态等于先撒谎再纠正。
  assert.match(
    src,
    /const buildIdentityCard = \(\) => \{\s*if \(!myLoaded\) return null;/,
    "the card must wait for hub_me rather than guess",
  );

  // 身份不再占一个和作品同级的 section。它并进「我的分享」的标题下面 ——
  // 这台路由器以谁的名义发布,说的本来就是那张表里的东西归谁。
  assert.ok(
    !src.includes('_("My creator identity")'),
    "identity is no longer a section of its own",
  );
  assert.ok(src.includes('_("Back up identity")'));
  assert.ok(src.includes('_("Not backed up")'));
  assert.ok(src.includes('_("Backed up")'));

  // 改名从发布面板里搬出来,成为身份卡上的常驻动作。
  assert.match(
    src,
    /click: \(\) => promptRename\(\) \},\s*_\("Rename"\)/,
    "the card must offer Rename",
  );

  // 折叠说明只回答“这是什么、从哪来的”。恢复入口曾经挂在它末尾 —— 而空态
  // 引导卡里还有第二条,同屏可见,点开是同一个对话框。现在恢复只在身份卡上。
  assert.ok(src.includes('_("What is this? Where did it come from?")'));
  assert.match(src, /class: "aurora-store-why"/);
  assert.ok(
    !src.includes('_("Changed routers? Restore your identity")'),
    "the explainer must not carry a second restore entry point",
  );
  assert.ok(
    src.includes('_("Restore…")'),
    "the card must offer Restore",
  );
  // 两个调用点,但它们是同一张卡的两个互斥状态(有身份 / 没身份),同屏永远
  // 只看得见一个 —— 而且都在这张卡里,没有第三处。
  const cardSrc = src.slice(
    src.indexOf("const buildIdentityCard"),
    src.indexOf("const KEY_RE"),
  );
  const restoreSites = (src.match(/restoreIdentityPrompt\(\)/g) || []).length;
  assert.equal(restoreSites, 2, "restore lives in the identity card's two states, nowhere else");
  assert.equal(
    (cardSrc.match(/restoreIdentityPrompt\(\)/g) || []).length,
    2,
    "both restore entry points must be inside the identity card",
  );

  // 昵称来自 hub,属不可信文本。
  assert.match(src, /document\.createTextNode\(profile\.nickname\)/);

  // 发布面板里那份只读署名不再重复提供改名 —— 改名只有一个入口。
  const renameSites = (src.match(/promptRename\(\)/g) || []).length;
  assert.equal(renameSites, 1, "rename must have exactly one entry point");
});

// 等待反馈只有一种机制:LuCI 自带的 .spinning 加 disabled。这一条钉的是
// "别长出第二套 loading",以及每个会让人干等的动作都接上了它。
test("waiting has exactly one mechanism, and every round trip uses it", async () => {
  const src = await readFile(SRC, "utf8");

  assert.match(
    src,
    /const withBusy = \(btn, promise\) => \{\s*btn\.disabled = true;\s*btn\.classList\.add\("spinning"\);/,
    "the one busy helper must both disable and spin",
  );
  // 自制的转圈会和页面上已有的那几处不一样。复用 LuCI 的类,不新增样式。
  assert.ok(
    !/@keyframes|aurora-store-spinner|animation:/.test(src),
    "no second spinner -- .spinning is what the rest of this page already uses",
  );

  // 确认框:onConfirm 返回 thenable 才 busy。返回 undefined 的同步路径(应用
  // 预设、应用配置 —— 它们当场换成一个 spinner 模态)必须一个字不变。
  assert.match(
    src,
    /if \(!pending \|\| typeof pending\.then !== "function"\) return;/,
    "synchronous confirm paths must keep their old behaviour",
  );
  assert.match(src, /cancelBtn\.disabled = true;/, "cancel must not stay live mid-flight");

  // 每一趟会让人干等的动作都接上了它:模态确认键、备份身份、删除某一行、
  // 重试读取我的分享。(发布另有 endSubmit —— 它要跨 renderContent 存活。)
  [
    [/withBusy\(confirmBtn, pending\)/, "modal confirm buttons"],
    [/withBusy\(ev\.currentTarget, backupKeyPrompt\(\)\)/, "back up identity"],
    [/withBusy\(\s*btn,/, "delete a share"],
    [/withBusy\(ev\.currentTarget, refreshMyShares\(\)\)/, "retry my-shares"],
  ].forEach(([re, what]) =>
    assert.match(src, re, `${what} must show a wait`),
  );
  // 改名和恢复走确认框那条路 —— 它们把 promise 交回去,而不是自己 fire-and-forget。
  assert.match(
    src,
    /return L\.resolveDefault\(hubApi\.callHubSetNickname\(next\), null\)/,
    "rename must hand its promise to the confirm footer",
  );
  assert.match(
    src,
    /return L\.resolveDefault\(hubApi\.callHubImportKey\(key\), null\)/,
    "restore must hand its promise to the confirm footer",
  );
});

// 首屏那一句"还没有分享过"曾经在 hub_me 回来之前就说出口了 —— 在一台其实
// 发布过东西的路由器上,它是假的。三种"没有表格"的理由现在各说各的。
test("my-shares tells loading, unreachable and empty apart", async () => {
  const src = await readFile(SRC, "utf8");

  assert.match(src, /let myLoaded = false;/, "the view must know whether hub_me answered");
  assert.match(src, /let myFailed = false;/, "and whether it failed");

  const listSrc = src.slice(
    src.indexOf("const renderMyShares"),
    src.indexOf("const shareManifestRows"),
  );
  assert.match(listSrc, /if \(myFailed && !myShares\.length\)/, "unreachable state missing");
  assert.match(listSrc, /if \(!myLoaded\)/, "loading state missing");
  assert.match(listSrc, /class: "spinning"/, "loading must look like the rest of the page");
  // 文案跟社区网格共用,不新造 msgid。
  assert.ok(listSrc.includes('_("Loading…")'));
  assert.ok(listSrc.includes('_("Unable to reach the theme store right now.")'));
  assert.ok(listSrc.includes('_("Retry")'));

  // 拿不到就不假装知道:失败时不置 myLoaded,身份卡因此不会画出"还没有创作者
  // 身份"这种替 hub 编的答案。
  const refresh = src.slice(
    src.indexOf("const refreshMyShares"),
    src.indexOf("const applyMe"),
  );
  assert.ok(
    !/^\s*myLoaded = true;$/m.test(refresh.slice(refresh.indexOf("} else {"))),
    "a failed hub_me must not count as loaded",
  );
});

// 这一条原先钉的是"三处入口用同一个词"。三处已经一起删了:发布的起点搬到
// 主题工作台,商店只负责逛和管。它现在钉的是"零个" —— 同一条回归线,更严。
test("publishing has no entry point on this page at all", async () => {
  const src = await readFile(SRC, "utf8");

  assert.ok(
    !src.includes('_("Share My Configuration")'),
    "the header button must stop being a second, differently-worded verb",
  );

  const publishLabels =
    (src.match(/_\("Publish current configuration"\)/g) || []).length;
  assert.equal(publishLabels, 0, "every publish entry point moved to the studio");

  // 页头那颗按钮连同它切标签的副作用一起没了。
  assert.ok(
    !/shareOpen = true;\s*selectTab\("mine"\);/.test(src),
    "the header button's tab-switching side effect should be gone with it",
  );
});

// 空态一路瘦到只剩一行字。它曾经是一张虚线卡:标题、一段说明、一颗"去工作台"
// 按钮,外加第二条"恢复身份"链接。三样东西现在都没有存在的理由 —— 发布入口
// 就在同一屏上方那条横幅上,恢复在身份卡里。剩下要说的只有"这里以后会长出
// 什么",而商店别处的空态本来就是一行灰字。
test("my-shares empty state is one line, not a card with its own buttons", async () => {
  const src = await readFile(SRC, "utf8");

  assert.ok(
    src.includes(
      '_("Nothing shared yet. Publish the configuration above and it shows up here.")',
    ),
  );
  assert.match(src, /class: "aurora-store-none"/);

  // 那张卡整块没了,连同它的样式类。
  assert.ok(
    !/class: "aurora-store-empty"/.test(src),
    "the dashed empty card is gone",
  );
  assert.ok(
    !src.includes('_("Go to the design studio")'),
    "the empty state must not send people away -- publishing happens here now",
  );
  assert.ok(
    !src.includes('_("Shared on another router before? Restore my identity")'),
    "the second restore entry point is gone",
  );

  // 两种空态合并了:这一段不再按 profile.id 分叉。(身份卡自己是分叉的 ——
  // 有没有身份决定它画什么、给哪个动作 —— 那是另一段代码的事。)
  const listSrc = src.slice(
    src.indexOf("const renderMyShares"),
    src.indexOf("const shareManifestRows"),
  );
  assert.ok(
    !/if \(!profile\.id\)/.test(listSrc),
    "the two empty states now say the same next step and were merged",
  );

  // 旧的那句“或者导入创作者密钥”彻底消失,连同两个旧按钮标签。
  assert.ok(!src.includes('_("Import a creator key")'));
  assert.ok(!src.includes('_("Import a key")'));
});

// 这一条以前钉的是"removed 一律滤掉"。当时非滤不可:hub 的软删除让作者自己
// 删掉的作品继续出现在 /api/v1/me 里,只是 status 变成 removed —— 删成功了、
// 那一行还在,再点一次就撞 404。代价是被管理员下架的作品跟着一起被藏了。
//
// hub 那边现在分得清了(migration 0007 的 removed_by):作者自己删的根本不再
// 下发,status === "removed" 只剩"被下架"一个意思。所以这里反过来钉:不许再
// 滤,那一行必须画出来 —— 而且不带按钮,因为 hub 的 requireOwnedConfig 要求
// status='active',对已下架的调 delete 只会拿回 404。
test("gallery: a taken-down share is shown, and carries no buttons", async () => {
  const src = await readFile(SRC, "utf8");

  const start = src.indexOf("const renderMyShares");
  assert.ok(start > 0, "renderMyShares not found");
  const head = src.slice(start, src.indexOf("TABS.forEach", start));
  assert.ok(
    !/\.filter\(\(item\) => item && item\.status !== "removed"\)/.test(head),
    "renderMyShares must no longer drop removed rows -- the hub already did",
  );

  const row = src.slice(
    src.indexOf("const buildMyShareRow"),
    src.indexOf("let myShares = []"),
  );
  assert.match(row, /const takenDown = item\.status === "removed";/);
  assert.ok(
    row.includes(
      '_("Taken down — no longer in the store. Nothing you can do from here.")',
    ),
    "the author must be told, here or nowhere",
  );
  assert.match(
    row,
    /takenDown \? \[\] : \[updateBtn, " ", deleteBtn\]/,
    "a taken-down row must offer neither Update nor Delete",
  );
});

test("gallery: a delete the hub refuses still re-reads My Shares", async () => {
  const src = await readFile(SRC, "utf8");
  const start = src.indexOf("const confirmDeleteShare");
  assert.ok(start > 0, "confirmDeleteShare not found");
  const fn = src.slice(start, src.indexOf("const buildMyShareRow", start));
  // 刷新只写一次,但在 if/else 之外 —— 两条分支都必须走到它。失败分支是一行
  // hub 那边其实已经不存在的作品离开屏幕的唯一途径。
  assert.equal(
    (fn.match(/refreshMyShares\(\)/g) || []).length,
    1,
    "one unconditional refresh, not one per branch",
  );
  assert.ok(
    fn.indexOf("refreshMyShares()") > fn.indexOf("deleteErrorMessage"),
    "the refresh must sit after both branches, not inside the success one",
  );
  // 确认框关掉之后还有两趟网络 —— 期间那一行的 Delete 键转圈并按不动。
  assert.match(
    fn,
    /return withBusy\(\s*btn,/,
    "the row's own Delete button is what shows the wait",
  );
});

// Same duplication as studio.js: the tab strip above the content already says
// "主题市场", and the store head printed it again as an <h2> immediately below.
test("gallery: the tab strip names the page, so the head carries no heading", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    !src.includes('_("Theme Marketplace")'),
    "the tab strip above already names the page",
  );
  assert.ok(
    !/E\("h2"/.test(src),
    "no page-level h2 belongs in the store head",
  );
  // The spacer is what pushes search and share to the right; without the
  // heading it is the first child, and it still has to be there.
  assert.match(src, /class: "sp"/);
});

// 三处发布入口(页头按钮、面板标题、空态卡按钮)说的是同一句话,而且面板开着
// 的时候下面还在劝你开面板 —— 那三处一次删干净了。
//
// 这一条现在钉的是"回来的只有一个":入口挂在「我的配置」那条横幅上,也就是
// 被发布的那个对象自己身上,而不是页头/面板标题/空态卡各来一个。页头那颗
// 按钮和它切标签的副作用必须仍然不存在。
// 「我的配置」恒为 1(它只是当前 uci 的投影),而「我的分享」是 0…N。这两样
// 曾经共用一个 auto-fill minmax(252px,1fr) 网格 —— 单例被塞进为 N 准备的容器
// 里,一张卡后面拖着几格空白。
//
// 「我的」页因此改画横幅:换来的宽度不是留白,是清单。清单必须来自
// shareManifestRows() 本尊 —— 复制一份的话,以后加一项配置要改两处,而两处
// 迟早会长歪,横幅上写着要发什么、线路上发的却是另一套。
test("mine banner: one row, and its manifest is the publish panel's own", async () => {
  const src = await readFile(SRC, "utf8");

  assert.match(src, /const buildMineBanner = \(\) =>/);
  assert.match(src, /class: "aurora-store-share aurora-store-mine"/);
  assert.match(
    src,
    /buildTiles\(\s*shareManifestRows\(\)\.map\(/,
    "the banner must render the publish panel's manifest, not a copy of it",
  );

  // 「全部」页仍然是卡片:那一页拿来逛,内置和社区也是网格。横幅只在「我的」。
  assert.match(
    src,
    /if \(state\.tab === "all"\) \{\s*const mineGrid = buildMineGrid\(\);/,
    "the browse tab keeps the card so it reads like the other groups",
  );

  // modified=false 时这条横幅代表的是"被商店主题盖掉之前那份备份",而
  // build_share_payload 打包的是当前 uci —— 两者不是同一个东西。那时根本
  // 不给发布按钮,不是置灰。
  const banner = src.slice(
    src.indexOf("const buildMineBanner"),
    src.indexOf("// ------------------------------------------------------------------\n    // My shares"),
  );
  assert.match(banner, /const acts = modified\s*\?/);
  assert.match(banner, /confirmRestore\(\)/);
  assert.equal(
    (banner.match(/openSharePanel\(\)/g) || []).length,
    1,
    "the share action exists only on the modified branch",
  );
});

test("marketplace: publishing has exactly one entry point, on the thing being published", async () => {
  const src = await readFile(srcPath("view/aurora/marketplace.js"), "utf8");

  assert.ok(!/cbi-button-add/.test(src), "the header publish button (and its CSS) should be gone");
  assert.ok(
    !/_\("Publish current configuration"\)/.test(src),
    "the copy that named three separate entry points should be gone",
  );
  assert.ok(
    !/shareOpen = true;\s*selectTab\("mine"\);/.test(src),
    "the header button's tab-switching side effect should stay gone",
  );

  // 唯一入口:横幅上的这颗按钮。openSharePanel 只被它调用一次。
  assert.match(src, /const openSharePanel = \(\) =>/);
  assert.equal(
    (src.match(/openSharePanel\(\)/g) || []).length,
    1,
    "openSharePanel must have exactly one call site",
  );
  assert.match(
    src,
    /click: \(\) => openSharePanel\(\),?\s*\},\s*_\("Share to the store"\)/,
    "the banner's primary action must be the publish entry",
  );
  // 工作台那个入口保留,两处落到同一张面板 —— 但它不在这个文件里。
});

// 意图优先,状态兜底:用户上一秒刚在工作台点了"分享到商店",这句话不该被
// "你已经发过东西了"盖掉。
test("marketplace: intent beats state when deciding what to show", async () => {
  const src = await readFile(srcPath("view/aurora/marketplace.js"), "utf8");
  assert.match(src, /URLSearchParams\(window\.location\.search\)/);
  assert.match(src, /shareIntent/);
  assert.match(src, /history\.replaceState/);
});

// 带意图进来又已经有作品时,只给一张空表单会让人发出第二条几乎一样的东西。
// "更新"的语义本来就是"用当前配置替换商店里的它",起点同样在工作台 ——
// 所以它和发布共用同一张表单,只差一个目标。
test("marketplace: an author with works picks new-vs-update before publishing", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /shareTarget/);
  assert.match(src, /_\("Publish as a new one"\)/);
  assert.match(src, /_\("Replace “%s”"\)/);
  assert.match(src, /nameInput\.value = target\.name/);
  // 列表里的"更新"不再弹确认框,而是跳回同一张表单、那条已选中
  assert.ok(!/confirmUpdateShare/.test(src), "update now reuses the publish form");
  assert.match(src, /openUpdateForm/);
});

// 一张 1.2MB 的图在慢上行的线路上要传十几秒。没有进度就是"卡死"。
test("marketplace: a multi-second upload shows progress, not a frozen button", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /renderShareProgress/);
  assert.match(src, /_\("Uploading %s… %d%%"\)/);
  assert.match(src, /asset_upload_failed/);
  assert.match(src, /asset_unreadable/);
  // 进度回调必须真的接上,否则上面那些字一次都不会显示
  assert.match(src, /onProgress: renderShareProgress/);
});

// ---------------------------------------------------------------------------
// 主界面背景:与登录背景同权重的资产,在浏览、打包、发布三处都要能看见
// ---------------------------------------------------------------------------

test("main background shows up in tiles, totals, and the publish manifest", async () => {
  const src = await readFile(SRC, "utf8");
  // 标签与详情 tile(和 login_bg 一样只作标签行,不拉原图)
  assert.match(src, /mainBg: _\("Main Background"\)/);
  assert.match(src, /label: ASSET_LABELS\.mainBg/);
  assert.match(src, /meta: bgTileMeta\(item, \["main_bg"\], layout, "struct_main_bg"\)/);
  // 详情页图片合计与打包清单都数它
  assert.match(src, /\["logo_svg", "login_bg", "main_bg"\]\.concat\(/);
  assert.match(src, /const BUNDLED_KINDS = \["font", "logo", "loginBg", "mainBg", "siteIcon", "appIcon"\]/);
  // 发布面板:rpcd shared_images 的 main_bg 行有标签可挂
  assert.match(src, /main_bg: ASSET_LABELS\.mainBg/);
});

// 背景 tile 的 meta 同时报体积与随包参数(体积 · 67% / 20px / 20%),
// 参数缺席就只报体积——使用方在应用前看得见这套背景的完整观感设定
test("background tiles surface the bundled tunables", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const bgTileMeta = /);
  assert.match(src, /prefix \+ "_alpha"/);
  assert.match(src, /prefix \+ "_scrim"/);
});

// ---------------------------------------------------------------------------
// 随附内容的体积:字体和自定义工具栏图标与背景同权重,都要带体积
// (docs/superpowers/specs/2026-08-08-bundled-content-sizes-design.md)
// ---------------------------------------------------------------------------

test("bundled tiles put a size on fonts and custom toolbar icons", async () => {
  const src = await readFile(SRC, "utf8");
  // 字体 entry 的 meta = 随附字体文件的字节数(font_sans + font_mono 合计)
  assert.match(
    src,
    /kind: "font",[\s\S]{0,400}?meta: sizeLabel\(assetBytesOf\(item, \["font_sans", "font_mono"\]\)\)/,
    "font entry must carry the bundled font bytes as meta",
  );
  // 字体进随附内容 —— 但名册字体不随附文件(meta 空),那是"应用后路由器自己
  // 下载",不能算随附内容;既有的"需下载字体"脚注继续负责说明它
  assert.match(
    src,
    /entry\.kind !== "font" \|\| entry\.meta/,
    "a roster font with no bundled file must stay out of Bundled content",
  );
  // 工具栏图标 tile:报数量与合计体积
  assert.match(
    src,
    /kind: "toolbarIcons",[\s\S]{0,400}?meta: sizeLabel\(assetBytesOf\(item, TOOLBAR_ICON_KINDS\)\)/,
    "toolbar icons tile must total the icon assets",
  );
  assert.match(src, /_\("Toolbar icons ×%d"\)/);
  // 抽屉专属:由 buildBundledTiles 合成并且真的接上;卡片 glyph 仍走共享的
  // toolbar entry,不受影响
  assert.match(src, /const toolbarIconsTile = \(item\) => \{/);
  assert.match(
    src,
    /const iconsTile = toolbarIconsTile\(item\);\s*\n\s*if \(iconsTile\) bundled\.push\(iconsTile\);/,
    "buildBundledTiles must actually append the toolbar icons tile",
  );
});
