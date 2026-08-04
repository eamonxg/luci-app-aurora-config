# 主题商店 UX 重做：预览分工、搜索区归一、分享改为常规表单区

日期：2026-08-04
状态：已实现（见 docs/plans/2026-08-04-theme-store-ux-redesign.md）
影响文件：`htdocs/luci-static/resources/utils/theme-preview.js`、
`htdocs/luci-static/resources/view/aurora/gallery.js`、
`root/usr/libexec/rpcd/luci.aurora`（仅 `remove_icon`，见 §7 R4）、
`tests/gallery-view.test.mjs`、`tests/theme-preview-module.test.mjs`、
`tests/rpcd-upload-validation.test.mjs`、`scripts/translations.json`、
`po/*`（新增词条）

## 1. 问题

主题商店上线后有三处问题：

1. **搜索区语汇混杂。** 头部同时出现三种控件语汇：自定义的圆角搜索胶囊（带 `🔍` emoji
   字形）、自定义的 segmented 胶囊标签组、LuCI 标准的 `cbi-button-add`。三者高度接近但
   底色、字重、边框各不相同，读起来不是一套东西。

2. **卡片体现不出「一整套」。** 一份分享的 payload 实际包含 62 个色值、导航形态、间距/
   圆角/内容宽度、字体选择、最多 12 个工具栏项，以及 6 类图片资产（Logo、favicon、PWA
   图标、登录背景图）。但卡片预览只画了 4 个色值，导航形态被丢弃，其余一概不体现。两份
   主色接近但一个是侧边栏 + 自定义 Logo + 背景图、另一个是纯配色的配置，卡片长得一模一样。

3. **分享交互只有三个输入框。** `Share My Configuration` 弹窗只问名称/描述/署名，完全不
   告诉用户「按下发布会把什么发出去」。用户自定义过背景图和 Logo，界面上没有任何地方
   说明这些也会一起分享。

根因（已定位到具体代码）：

- `gallery.js:96` 的包装函数把 `opts` 参数吃掉了：
  `const buildDuo = (palette) => themePreview.buildDuo(palette)`。所以 `buildMini` 的
  `opts.nav` 永远是 `undefined`，一律走顶栏分支——**`theme-preview.js:74` 的侧边栏分支
  是当前全仓库唯一的调用方之外的死代码**（`theme.js` 根本没引 `theme-preview`）。
- `paletteOf`（`gallery.js:82`）只取 `bg/surface/text/brand` 四个 token，其余 27 个（
  `text_muted`、`hairline`、`success`…）不进预览——这是刻意的，缩略图画不下，保留。
- 抽屉里 `buildDetailRow(_("Sans Font"), typography.font_sans)` 直接打印预设 id（显示为
  `geist-sans`），是机制词，违反零心智负担原则。

## 2. 设计原则：预览画几何，清单画其余

一份配置里的东西分两类处理，这条分工是本次设计的核心：

| | 内容 | 理由 |
|---|---|---|
| **进预览** | 4 个色值 + `nav_type` | 它们是**几何**——现有那套纯 CSS 假页面能直接画出来，不需要任何外部资源、不需要网络 |
| **走清单** | 字体、圆角/间距、Logo、登录背景图、站点图标、悬浮工具栏 | 缩略图尺寸下画不清楚；且 Logo / 背景图需要 hub 返回资产 URL，会引入跨仓库依赖和断网裂图问题 |

**这条分工的直接收益：呈现层的改动全部落在客户端。** 不需要修改 `openwrt-cloud` 的
hub API，不需要新增 rpcd 方法，不引入任何新的网络请求。内网、断网、LAN-only 路由器上
表现不变。

唯一的例外是 `remove_icon`：清单要如实说出「这次会发出去什么」，前提是 uci 里的资产
槽位不指向已删除的文件，而这个根因只能在 shell 侧修（见 §7 R4）。除此之外没有任何
shell 改动。

（未来若 hub 开始返回资产缩略图 URL，可以给抽屉加第三格「登录页」，把真实背景图和 Logo
画出来。**不在本次范围内。**）

## 3. 预览层改动

### 3.1 `theme-preview.js`：`buildMini` 支持三种导航形态

`nav_type` 的三个合法值都要能画出区别（`luci.aurora:826` 的枚举）：

- `sidebar` → 左侧竖栏（**现有分支，复活即可**）
- `mega-menu` → 顶栏 + 其下一条展开的宽面板（新增分支），内容区起始位置相应下移
- `dropdown` → 顶栏（现有默认分支）

几何仍然全部是静态 cssText，只有颜色是变量——`buildMini` 现有的注入防线不受影响。

### 3.2 `gallery.js`：把 `nav_type` 透传进去

- 删掉 `gallery.js:96` 吞参数的包装，改为透传 `opts`。
- 社区配置：`payload.layout.nav_type`，**只有抽屉拿得到**（`callHubGet`）。列表接口确认
  不返回 layout（见 §7 R1），所以**卡片预览一律画顶栏**——与现状一致，不是回退。
- 内置预设：**用当前 uci 的 `nav_type`**。内置预设只写 62 个色值，导航保持不变，所以
  「你当前的导航形态」正是应用后的真实样子。`load()` 里已经 `uci.load("aurora")`，多读
  一个值即可。内置卡片的 footer **不**显示导航标签（那不是这个预设的属性）。
- `nav_type` 值到中文标签的映射：`sidebar`→侧边栏、`mega-menu`→顶部大菜单、
  `dropdown`→顶部下拉菜单。未知值退回原始字符串（经 `createTextNode`）。

### 3.3 抽屉大预览：浅色 / 深色 两格

抽屉顶部的单张斜切双联换成并排两格（各 16:10，带「浅色」「深色」标注）。斜切图适合卡片
尺寸，抽屉里有空间就该把两套配色分开看清楚，导航形态也更明显。

## 4. 清单层：`buildTiles(item)`

新增一个渲染函数，卡片和抽屉共用，输出一排「符号 + 文字」小块，只列**预览之外**的内容：

| 条件 | 显示 |
|---|---|
| 有字体选择 | `Aa` + 无衬线字体族名 |
| 有圆角/间距 | `◜` + 圆角档位 |
| `assets` 含 `logo_svg` | `◆ Logo` |
| `assets` 含 `login_bg` | `▣ 登录背景` |
| `assets` 含 `favicon_*` | `◐ 站点图标` |
| `assets` 含 `pwa_icon_*` | `◐ 应用图标` |
| `toolbar` 非空 | `⌘ 工具栏 N` |
| 以上皆无 | `◑ 仅配色`（弱化样式） |

细节：

- **字体标签用族名，不用预设 id。** 从 `typography.struct_font_sans` 取第一个族名并去掉
  引号（`"Geist Sans", "Lato", …` → `Geist Sans`），显示为「Geist Sans」而不是
  `geist-sans`。该字段入站已被 `^[A-Za-z0-9 ,"'-]+$` 校验（`luci.aurora:873`），但渲染
  仍走 `createTextNode`。
- **圆角标签**优先复用 `theme.js` 的 `renderRadiusControl` 已有的档位名；取不到则退回原始
  `rem` 值。
- 所有小块用 `title` 属性给出完整说明（如「悬浮工具栏快捷方式」），鼠标悬停可见。
- 内置预设永远只有「仅配色」一块；社区配置若什么都不带，也复用同一块，不另写一份。
- **资产名称只有一套。** 抽屉的小块和分享清单说的是同一份 payload，所以「Logo /
  站点图标 / 应用图标 / 登录背景」四个标签共用一份常量（`ASSET_LABELS`），不允许各写
  各的字面量——「背景」对「登录背景」这种漂移就是这么来的。

**卡片与抽屉能显示的粒度不同**（列表接口限制，见 §7 R1）：上表的逐项明细只在**抽屉**里
完整出现；**社区卡片**只能根据 `assets_status` 给一块「含自定义内容」，**内置预设卡片**
照常显示「仅配色」。

抽屉里明细表在清单**之上**：沿用页面原有的 `cbi-value` 行（导航 / 间距 / 圆角 / 内容宽度 /
工具栏开关 / 字体），小块作为「预览之外」一节接在它下面。明细表**不含**「自定义资产」
一行——资产由小块表达，写两遍就是两套说法。内置预设的导航一行标注「（沿用你当前的
设置）」。

## 5. 头部：只用 LuCI 已有的语汇

- **搜索** → 普通 `cbi-input-text` 输入框。删掉 `.aurora-store-search` 胶囊和 `🔍` emoji。
- **筛选** → 下划线 tab，与页面自身的「主题设置 / 主题商店」一级 tab 同一种视觉。删掉
  `.aurora-store-tabs` segmented 胶囊。
- **按钮** → 保持 LuCI 标准按钮。
- 三者不再是三种语汇，`STORE_CSS` 相应减少两段。

「我的分享」标签后面带一个计数（如 `我的分享 1`），来自已加载的 `hub_my_shares`；
发布、更新、删除之后随 `renderMyShares` 一起刷新，没有分享时只显示标签本身。

## 6. 分享：从弹窗改为「我的分享」里的常规表单区

`openShareModal` 的 `ui.showModal` 改成一段内联的 `cbi-section` 风格面板，位于「我的分享」
标签页顶部。头部的「分享我的配置」按钮切到该标签并展开面板。

面板结构：

1. **左栏**：当前配置的预览卡（复用卡片组件，标注「在商店里的样子」）。
2. **右栏**：名称 / 描述 / 署名三个字段。**标签在字段上方**，不用 LuCI 的宽左标签栅格——
   截图里那个布局在窄容器里把标签和输入框拉得极开，很难读。
3. **下方**：`本次分享包含` 表格，逐行列出：配色 / 导航 / 间距 / 外形 / 内容宽度 / 字体 /
   Logo / 站点图标 / 应用图标 / 登录背景 / 悬浮工具栏。清单必须与
   `build_share_payload` 实际发送的字段一一对应——少列一项，就是在「应用它的人会拿到
   全部内容」这句话上面少说了一项。
4. **底部**：取消 / 发布。

「更新分享」走的是同一次 `build_share_payload`（Logo、登录背景、图标、快捷方式全部重发），
所以它的确认弹窗复用同一张清单表，不能退回成一行「要用当前设置替换吗？」。

### 6.1 清单数据从 uci 客户端推导，不新增 rpcd 方法

需要的信息全在 uci 里，`load()` 已经 `uci.load("aurora")`：

- 颜色数量：固定 62
- `nav_type`、`struct_spacing`、`struct_radius_base`、`struct_content_width_centered`
- `struct_font_sans` / `struct_font_mono`
- 资产文件名：`logo_svg`、`favicon_png`、`favicon_ico`、`pwa_icon_192`、`pwa_icon_512`、
  以及从 `struct_login_bg` 的 `url('…')` 里抠出的文件名
- 工具栏项数：`toolbar_item` 匿名段计数

**不显示文件体积。** 体积不在 uci 里，拿到它需要新增 rpcd 方法；而字节数属于机制信息，
按零心智负担原则本就不该进界面。

### 6.2 出厂默认文件名必须与 shell 保持一致（关键正确性约束）

`build_share_payload`（`luci.aurora:695`）会**跳过**仍是出厂默认文件名的资产——用户没改过
的槽位不上传：

```
logo.svg | favicon.ico | app-icon-192x192.png | app-icon-512x512.png | apple-touch-icon.png
```

客户端清单必须套用同一份跳过规则，否则会向用户承诺分享一个实际不会上传的 Logo。这份常量
因此在 shell 和 JS 里各存一份，**存在漂移风险**。缓解措施：`tests/gallery-view.test.mjs`
增加一个测试，同时读取 `luci.aurora` 和 `gallery.js`，断言两边的文件名集合完全相同。

## 7. 风险与未决项

**R1 —— 已确认：列表接口不返回 layout / typography / toolbar。**
2026-08-04 实测 `GET https://themes.eamonxg.fun/api/v1/themes/aurora/configs?sort=hot&page=1`，
每条只有：

```
{id, name, author, downloads, assets_status, created_at, palette{light{bg,surface,text,brand}, dark{…}}}
```

由此确定的降级方案（**已并入 §3.2 / §4，不是待办**）：

- **社区卡片预览一律画顶栏**——和现状一致，不是回退；正确的导航形态在抽屉里画。
- **社区卡片的清单只能给一块粗粒度标记**，唯一可用信号是 `assets_status`：非 `none` 时
  显示「含自定义内容」，否则不显示。Logo / 背景图 / 图标 / 字体 / 圆角 / 工具栏的逐项
  明细**只在抽屉里出现**。
- **内置预设卡片不受影响**——数据全在本地 `presets.json` + uci，导航和「仅配色」照常画。
- 分享面板的清单不受影响——数据全部来自本机 uci，是完整的。

代价要说清楚：本次改动之后，**「一整套」这件事在卡片层面只能表达到「有没有自定义内容」
这个粒度**，完整的故事在抽屉里。这是当前 hub API 的硬限制，不是设计取舍。

**R1-后续（需要单独放行，不在本次范围）**：若要让卡片也能表达整套，需要 `openwrt-cloud`
的列表接口在每行补上 `nav_type` 和一个紧凑的 includes 摘要（资产 kind 列表 + 字体 + 圆角）。
hub 的 D1 里存着完整 payload，是可行的，但属于另一个仓库 + 另一次 Worker 部署。

**R2 — 颜色兜底是静默的。** `safeHex` 对非 hex 值退回硬编码默认色，卡片会画成 Aurora 默认
蓝而不是报错。这是既有行为，本次不改，但记录在案：客户端的 token 名与 hub 服务端抽取
`palette` 的逻辑是跨仓库的隐式契约，走偏了没有任何信号。

**R3 — 新增词条需要翻译。** 本次会引入若干新 msgid（导航标签、清单标签、分享面板文案）。
`po/zh_Hans` 等 14 个语言目录需要补（`po/` 下另有 `templates/`，不是语言目录）。
新词条统一走 `scripts/translations.json` + `node scripts/gen-pot.mjs && node scripts/merge-po.mjs`。
另注意术语一致：快捷方式在 zh_Hans 全线用「快捷方式」（与主题设置页一致），
zh_Hant 用「捷徑」。另注意：线上截图里「Hot / New / My Shares」显示为
英文**不是**设计缺陷——`po/zh_Hans/aurora-config.po` 里这些词条早已翻译，是测试机上
`luci-i18n-aurora-config-zh-cn` 没装或没重新编译。**验证本次改动时先确认 i18n 包已更新**，
否则会把翻译缺失误判成设计问题。

**R4 — rpcd 只放行了 `remove_icon` 一处。** 原则不变：rpcd 后端至今未在真实 OpenWrt 上
跑过（发版硬门槛），不该在这次 UI 改动里增加它的表面积——**不新增方法、不改任何既有
流程与错误码**。

唯一的例外经人工明确放行：`remove_icon` 删掉一张图片后，只清了 `struct_login_bg`，
其余指向同一文件的槽位仍留着一个已不存在的文件名。这是清单会「承诺一个发不出去的
Logo」的根因，光在 JS 侧绕开只是把症状挪走。放行的修改覆盖：`logo_svg`、`favicon_png`、
`favicon_ico`、`pwa_icon_192`、`pwa_icon_512`、`pwa_apple_touch`，每个 `toolbar_item`
的 `icon`（匿名段，按 `build_share_payload` 的方式从 `uci show` 还原 id），以及
`struct_login_bg`/`struct_login_bg_lqip`。保留原有的 `..` 防护，整次删除只 commit 一次
且仅在真的改动过时 commit，风格仍是 BusyBox ash（无数组、无 `[[ ]]`、函数外无 `local`）。
`tests/rpcd-upload-validation.test.mjs` 钉住上述每一条。

## 8. 明确不做

- 不给分享加「选择要包含哪些内容」的勾选框。配置对用户是一整套，界面只负责让人**看清**
  发了什么，不让人逐项挑。
- 不在预览里画真实的 Logo / 背景图（需要 hub 返回资产 URL）。
- 不改 hub API，不改 `openwrt-cloud`。
- 不改应用/回滚/发布的任何后端流程与错误文案映射。
