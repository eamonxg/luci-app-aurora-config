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

test("gallery view: external toolbar URLs are surfaced in plaintext before applying", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /toolbar/);
  assert.match(src, /url\.startsWith\(\s*"http/, "missing http(s) URL check on toolbar entries");
  assert.ok(src.includes("createTextNode"), "external URLs must render via textContent, not innerHTML");
});

test("gallery view: rollback banner reads hub_applied and offers callHubRestore", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /require uci/);
  assert.match(src, /hub_applied/);
  assert.ok(src.includes("callHubRestore"), "missing callHubRestore usage");
  assert.ok(src.includes("window.location.reload"), "missing reload after restore");
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

  // ✓ 和它所在的那句话必须是同一个 flex item。分成两个的时候,窄屏上句子换行
  // 到第二行,留一个光秃秃的 ✓ 吊在上面。
  assert.match(
    src,
    /E\("span", \{ class: "msg" \}, \[\s*buildCurrentTick\(\),/,
    "the banner tick must travel inside the sentence it belongs to",
  );
});

test("gallery view: share panel and my-shares management (Task 8)", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubShare"), "missing callHubShare usage");
  assert.ok(src.includes("callHubMe"), "missing callHubMe usage");
  assert.ok(src.includes("callHubUpdate"), "missing callHubUpdate usage");
  assert.ok(src.includes("callHubDelete"), "missing callHubDelete usage");
  assert.ok(src.includes("confirmDelete"), "missing confirmDelete reuse for delete confirms");
  assert.match(src, /require utils\.asset-upload as assetUpload/);
});

test("gallery view: updating a share resends the existing name (not id-only)", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(
    src,
    /callHubUpdate\(\s*item\.id,\s*item\.name,/,
    "callHubUpdate must be called with item.name so the hub PUT's required-name check doesn't reject the update",
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
test("gallery view: a two-row header with a segmented filter row", async () => {
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
});

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
    !/\.then\(\s*\(res\) => \{\s*submitBtn\.disabled = false;/.test(src),
    "submit button must not be re-enabled before the result is known",
  );
  assert.match(
    src,
    /\} else \{\s*submitBtn\.disabled = false;/,
    "the failure branch must be the one that re-enables the button",
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

test("share manifest skips exactly the filenames build_share_payload skips", async () => {
  const js = await readFile(SRC, "utf8");
  const shell = await readFile(repo("root/usr/libexec/rpcd/luci.aurora"), "utf8");

  // shell 侧:build_share_payload 里的 case 分支
  //   logo.svg|favicon.ico|app-icon-192x192.png|...)
  const shellMatch = /^\s*(logo\.svg(?:\|[A-Za-z0-9.\-]+)+)\)\s*$/m.exec(shell);
  assert.ok(shellMatch, "could not find the factory-filename case in luci.aurora");
  const shellNames = shellMatch[1].split("|").sort();

  const jsMatch = /const FACTORY_ASSET_NAMES = \[([\s\S]*?)\];/.exec(js);
  assert.ok(jsMatch, "FACTORY_ASSET_NAMES not found in marketplace.js");
  const jsNames = [...jsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

  // A test comparing two empty arrays would pass while proving nothing --
  // make sure both regexes actually captured the five factory names.
  assert.equal(shellNames.length, 5, "shell-side capture did not find 5 names");
  assert.equal(jsNames.length, 5, "js-side capture did not find 5 names");

  assert.deepEqual(
    jsNames,
    shellNames,
    "the share manifest and build_share_payload disagree about which assets are factory defaults",
  );
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

test("gallery view: only logo_svg is drawn, login backgrounds stay a label", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /kind === "logo_svg"/, "logo lookup missing");
  // /assets/:id/:kind streams the original image (login_bg is capped at
  // 2 MiB); 24 cards each pulling one is not acceptable. So login_bg stays a
  // glyph tile, and exactly one call site ever turns a hub asset path into a
  // fetchable url -- the logo's.
  assert.match(
    src,
    /glyph: "▣",\s+label: ASSET_LABELS\.loginBg/,
    "login background must stay a glyph tile",
  );
  assert.equal(
    (src.match(/hubAssetUrl\(/g) || []).length,
    1,
    "exactly one place turns a hub asset path into a url",
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
  // "随附内容"滤掉已经在别处说过的那几种
  assert.match(src, /const buildBundledTiles = /);
  assert.match(src, /const BUNDLED_KINDS = \["logo", "loginBg", "siteIcon", "appIcon"\]/);
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

  // 不为 icon 造任何图片:hub 批准的六种资产里没有快捷方式图标,那些字节
  // 从来没有离开过作者的路由器
  assert.match(src, /const SHORTCUT_GLYPH = /, "the icon slot must be a neutral placeholder");
  assert.ok(!/entry\.icon/.test(src), "a shared shortcut icon has no bytes on this router");

  // 关掉的工具栏要说出来,否则这一节在承诺不会出现的东西
  assert.match(src, /toolbar_enabled === "0"/);

  // buildShortcutList existing is not enough -- buildDetailBody must actually
  // call it and splice the result in, or the whole section is dead code with
  // a green suite (verified by deleting these two lines and re-running).
  assert.match(
    src,
    /const shortcuts = buildShortcutList\(payload\.toolbar, layout\);\s*\n\s*if \(shortcuts\) children\.push\(\.\.\.shortcuts\);/,
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
    /const buildShortcutRow = \(entry\) => \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*entry = entry \|\| \{\};/,
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
  const tail = src.slice(src.lastIndexOf("renderBanner();"));
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
  assert.ok(src.includes('_("Back up the current identity first")'));

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

  // 没有身份时返回 null —— 引导态由调用方负责,卡片不假装有一个空账号。
  assert.match(src, /if \(!profile\.id\) return null;/);

  assert.ok(src.includes('_("My creator identity")'));
  assert.ok(src.includes('_("Back up identity")'));
  assert.ok(src.includes('_("Not backed up")'));
  assert.ok(src.includes('_("Backed up")'));

  // 改名从发布面板里搬出来,成为身份卡上的常驻动作。
  assert.match(
    src,
    /click: \(\) => promptRename\(\) \},\s*_\("Rename"\)/,
    "the card must offer Rename",
  );

  // 折叠说明回答“这是什么、从哪来的”,并在末尾提供恢复入口。
  assert.ok(src.includes('_("What is this? Where did it come from?")'));
  assert.ok(src.includes('_("Changed routers? Restore your identity")'));
  assert.match(src, /class: "aurora-store-why"/);

  // 昵称来自 hub,属不可信文本。
  assert.match(src, /document\.createTextNode\(profile\.nickname\)/);

  // 发布面板里那份只读署名不再重复提供改名 —— 改名只有一个入口。
  const renameSites = (src.match(/promptRename\(\)/g) || []).length;
  assert.equal(renameSites, 1, "rename must have exactly one entry point");
});

test("publishing has exactly one persistent entry point", async () => {
  const src = await readFile(SRC, "utf8");

  // 页头按钮复用发布面板的标题措辞 —— 点它打开的面板就叫这个名字。
  assert.ok(
    !src.includes('_("Share My Configuration")'),
    "the header button must stop being a second, differently-worded verb",
  );

  // 常驻的页内按钮没了。剩下三处用同一个词:页头按钮、面板标题、以及空态
  // 引导卡里那个 —— 引导卡与作品列表互斥,不是第四个常驻入口。
  const publishLabels =
    (src.match(/_\("Publish current configuration"\)/g) || []).length;
  assert.equal(
    publishLabels,
    3,
    "expected the header button, the panel heading and the empty-state CTA",
  );

  assert.match(src, /shareOpen = true;\s*selectTab\("mine"\);/);
});

test("my-shares empty state onboards instead of demanding an import", async () => {
  const src = await readFile(SRC, "utf8");

  assert.ok(src.includes('_("Nothing shared yet")'));
  assert.ok(
    src.includes(
      '_("Publish this router\'s whole appearance to the store and anyone can apply it in one click. Publishing creates your creator identity automatically.")',
    ),
  );
  assert.ok(
    src.includes('_("Shared on another router before? Restore my identity")'),
  );
  assert.ok(src.includes('_("Publish your current configuration and it shows up here.")'));

  // 引导卡只在“连身份都还没有”时出现;已有身份、零作品是另一句话。
  assert.match(src, /if \(!profile\.id\) \{/);
  assert.match(src, /class: "aurora-store-empty"/);

  // 旧的那句“或者导入创作者密钥”彻底消失,连同两个旧按钮标签。
  assert.ok(
    !src.includes(
      '_("Nothing shared yet — publish your current configuration, or import a creator key to bring back what you shared before.")',
    ),
  );
  assert.ok(!src.includes('_("Import a creator key")'));
  assert.ok(!src.includes('_("Import a key")'));
});

// The hub soft-deletes: /api/v1/me keeps listing a share this device has
// already deleted, marked `status: "removed"`. Nothing else in this view reads
// `status`, so an unfiltered list re-renders that share with live Update and
// Delete buttons -- which is why a delete looked broken end to end: it
// succeeded, the row stayed, and the second click hit a 404.
test("gallery: a share the hub has removed never reaches My Shares", async () => {
  const src = await readFile(SRC, "utf8");
  const start = src.indexOf("const renderMyShares");
  assert.ok(start > 0, "renderMyShares not found");
  const head = src.slice(start, src.indexOf("TABS.forEach", start));
  assert.match(
    head,
    /status !== "removed"/,
    "renderMyShares must drop the shares the hub has already removed",
  );
});

test("gallery: a delete the hub refuses still re-reads My Shares", async () => {
  const src = await readFile(SRC, "utf8");
  const start = src.indexOf("const confirmDeleteShare");
  assert.ok(start > 0, "confirmDeleteShare not found");
  const fn = src.slice(start, src.indexOf("const buildMyShareRow", start));
  // Two refreshes, not one. The failure branch is the only way a row the hub
  // has already dropped ever leaves the screen.
  assert.equal(
    (fn.match(/refreshMyShares\(\)/g) || []).length,
    2,
    "both the success and the failure branch must re-read hub_me",
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
