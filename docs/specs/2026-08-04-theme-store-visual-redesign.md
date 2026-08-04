# 配置广场视觉重设计（方案 A：安静货架）

2026-08-04

## 背景

配置广场（`htdocs/luci-static/resources/view/aurora/gallery.js`）功能已经完整：内置预设、
社区列表、详情抽屉、发布面板、我的分享都在。问题出在视觉和信息密度上。

用户在真机截图上指出的，加上对照代码确认的：

1. **页头吃掉半屏。** `h2` 标题 → `cbi-map-descr` 说明 → 搜索行 → 标签行 → 分区标题，
   五层堆叠之后才是第一张卡。
2. **卡片太窄。** 网格是 `minmax(225px,1fr)`，宽屏排到 5 列，缩略图小到五个内置预设看着
   几乎一样。
3. **每张卡三行元信息。** 名字行 + tiles 行（"仅颜色"）+ 底行（色点 + 作者 + "离线可用"），
   铺得平，没有主次。
4. **详情面板用了 `cbi-value`。** LuCI 的表单行布局把标签右对齐，标签和值之间隔着一大片
   空白，是第二张截图里最难读的部分。
5. **颜色 8 个 hex 堆成两行没有分组**，看不出哪四个是浅色、哪四个是深色。
6. **快捷方式只报数字。** 详情里写 `Toolbar 4`，不说是哪四个。`payload.toolbar[]` 里
   `{title, url, enabled, icon?}` 一直都在，只是没画。

另外确认了两件**不是设计问题**的事，本 spec 不处理：

- 截图里"Hot / New / My Shares / Spacing / Content Width / Sans Font / Mono Font /
  Beyond the preview"显示为英文，是设备上装的 `luci-i18n-aurora-config` 比代码旧。
  `po/zh_Hans/aurora-config.po` 里这些 msgid 全部已翻译。重装 i18n 包即可。
- 快捷方式的 `icon` 存的是作者路由器上 `/www/luci-static/aurora/images/` 里的文件名，
  而 hub 只接收 6 种资产（`root/usr/libexec/rpcd/luci.aurora:676`：logo_svg、favicon_png、
  favicon_ico、pwa_icon_192、pwa_icon_512、login_bg），**不含快捷方式图标的字节**。
  别人应用这套配置后，快捷方式图标指向一个本地不存在的文件。这是既有缺陷，要修得给 hub 加
  资产类型和审核流程，属于另一个独立议题。

## 范围

**做：** `gallery.js` 里的 `STORE_CSS`、卡片 DOM 结构、详情抽屉正文结构，以及详情里新增的
快捷方式清单。

**不做：**
- `utils/theme-preview.js` 的 mini 预览画法不动（斜切双联保留，几何不改）。
- openwrt-cloud（hub）**零改动**，见下节。
- 发布面板、我的分享表格、apply/restore/share 的流程与错误文案，全部不动。
- 上面那两条"不是设计问题"的事。

## 后端接口：不需要适配

核对过 `/Users/eamon/github/luci-theme/openwrt-cloud/hub/src/`：

| 需求 | 数据来源 | 结论 |
|---|---|---|
| 详情列出快捷方式的标题和目标 | `GET /configs/:id` 返回完整 `payload`（`configs.js:330`），`payload.toolbar[]` 为 `{title, url, enabled, icon?}`（`validate.js:213`） | 够用 |
| 卡片显示快捷方式条数 | 列表行 `preview.toolbar[]` 为 `{title, enabled, icon?}` | 够用 |
| 卡片显示目标 url | `preview.toolbar` **故意不带 url**（`configs.js:176-178`：url 上限 200 字符会撑大列表体积，外链确认是详情路径的活） | 卡片本来也不该显示 |

## 与既有决定的一次明确反转

`tests/gallery-view.test.mjs:219`（"the header uses LuCI's own controls, not a bespoke
pill set"）当初禁掉了自制胶囊控件，要求标签行保持 `aurora-store-filters` 的下划线样式。

本次**反转标签那一半**，理由：下划线标签在深色下选中态对比太弱（截图里"全部"下面那道线几乎
看不出来），而分段控件的选中态是一块有底色的实心块，在任意主题色下都成立；顺带能挂计数。

**不反转的部分照旧保留**，测试里这几条继续断言：
- 搜索框仍然是 `class: "cbi-input-text"` 的标准 LuCI 输入框，**不加放大镜图标**、不做自制搜索胶囊。
- 源码里不出现 emoji 字形。
- 源码里不出现 `.innerHTML`。

## 设计

### 1. 页头：两层，不是五层

```
配置广场                          [搜索框]  [分享我的配置]
✓ 正在使用 默认                              [恢复上一个配置]
[全部][内置 5][热门][最新][我的分享 2]
```

- `h2` 与搜索框、分享按钮同一行（`.aurora-store-head`，`align-items:flex-end`）。
- 删掉 `cbi-map-descr` 那句"Browse configurations shared by the community…"。分区标题的
  副标题已经说清楚了，见 §3。
- 已应用横幅（`bannerEl`）从独立的大块变成一条 `--brand-subtle` 底色的细状态条，紧贴页头，
  高度约 34px。仅在 `hubApplied` 非空时出现，逻辑不变。

### 2. 标签：分段控件

`.aurora-store-filters` 从"下划线按钮行"改成"胶囊分段控件"：

- 容器：`--surface-sunken` 底 + `--hairline` 描边 + `border-radius:10px` + `padding:3px`。
- 按钮：`border-radius:7px`，静默态 `--text-muted` 无底色。
- 选中态（`.active`）：`--surface` 底 + `--text` 前景 + `font-weight:600` + `--app-shadow-sm`。
- 内置和我的分享带计数，计数是 `font-size:11px;opacity:.6` 的小字，跟在标签后面。
  内置计数取 `builtinItems.length`；我的分享沿用现有的 `renderMySharesTab()`，
  只是把 `"My Shares" + " " + n` 换成两个节点（标签 + `<span class="n">`）。

### 3. 分区标题带副标题

```
内置   随主题附带，离线可用
社区   由其他人分享
```

`h3` 降到 14px，后面跟一句 12px `--text-subtle` 的副标题。它替代了被删掉的
`cbi-map-descr`，把说明放在真正相关的位置。

新 msgid：`Ships with the theme, works offline`、`Shared by other people`。

### 4. 卡片：两行，不是三行

- 网格 `minmax(225px,1fr)` → `minmax(252px,1fr)`，`gap` 14px → 16px。
- 预览比例 `16/9` → `16/10`（更接近真实浏览器窗口，且给缩略图多一点高度）。
- **色点条移到预览右下角**，做成半透明浮层（`--surface` 82% + `backdrop-filter:blur(6px)`
  + `--hairline` 描边 + 全圆角）。卡片正文因此少一整行。
- **tiles 在卡片上收成小图标**：名字右侧最多 3 个 19×19 的方块，只放 glyph，`title` 属性带
  完整文字。

  这需要拆 `buildTilesFor`：现在它一步到位返回构造好的 tiles。改成
  **`tileEntriesFor(item)` 返回 `[{kind, glyph, label, title}]`**，其中 `kind` 是
  `"font" | "radius" | "logo" | "loginBg" | "siteIcon" | "appIcon" | "toolbar" | "colorsOnly"`，
  然后：
  - 卡片：取前 3 条，只画 glyph + `title`
  - 详情"随附内容"：滤掉 `font` / `radius` / `toolbar` 三种（它们在"布局与排版"和
    "快捷方式"两节里已经说过），其余画成完整 tiles

  一个来源两个消费者，卡片和抽屉不可能对同一份配置说出两回事——这是现有代码里
  `buildTilesFor` 上方注释就已经立下的规矩，拆的时候必须守住。
  `buildLegacyCardTiles`（老 hub 无 preview 时的粗粒度退化）和 `buildBuiltinTiles`
  原样保留。
- 正文剩两行：
  - 第一行：名字 + 小图标组（`margin-left:auto`）
  - 第二行：作者 + 右对齐的"N 次应用" / "离线可用"
- 悬停：`translateY(-3px)` + `--app-shadow-md` + 描边转向 `--brand` 40% 混色。
  快捷应用按钮移到预览**左下角**（原来在右下，会和色点条打架）。

### 5. 「正在使用」= 对号，没有字

替换现有的 `.aurora-store-badge.current`（一枚写着"Current"的绿色药丸）：

- **卡片**：`.aurora-store-card.on` 描边直接变 `--brand`；预览左上角压一枚 20px 实心
  `--brand` 圆片，里面是白色 `✓`，外圈 `box-shadow: 0 0 0 2px` 半透明 `--surface`
  （预览底色是任意的，必须自带底才在所有配置上都看得见）。
- 快捷应用按钮文案在这张卡上变成"重新应用"。
- **详情标题**：名字后跟一个裸 `✓`，`--brand` 色，13px，不占宽度，`title="正在使用"`。
- **详情底部**：主按钮变成 `disabled` 的"✓ 正在使用"（`opacity:.45;cursor:default`）。

`.aurora-store-badge.builtin` 保留原样——那是分类，不是状态。

新 msgid：`In use`（用作 title 属性和底部按钮）、`Re-apply`。
`Current` 这个 msgid 停用。

### 6. 详情抽屉：抛弃 cbi-value

抽屉宽度 440px → 460px。正文自上而下：

**标题区** — 名字（+ 内置徽章 / 对号）、副行"作者 · N 次应用"、描述。

**分节标题** — 统一成 11.5px / `font-weight:700` / `letter-spacing:.09em` / 大写 /
`--text-subtle` 的小标题，取代现在一串 `h4`。

**颜色** — 两行，每行前面一个 34px 宽的"浅色 / 深色"标签，后面四枚色片。色片是
`色块 + hex`，等宽字体，`--surface-sunken` 底。取代现在无分组的两行。

**布局与排版** — 合并现在的"Layout"和"Typography"两节，用一个左对齐的两列网格
（`display:grid; grid-template-columns:auto 1fr`），标签左、值右对齐。**不再用
`cbi-value` / `cbi-value-title` / `cbi-value-field`。**

实现上：删掉 `buildDetailRow(label, value)`（它是 `cbi-value` 的唯一来源），换成
**`buildKvList(rows)`**，接收 `[[label, value]]` 一次性画出整张 `<dl>`。
`openBuiltinDrawer` 里那行"导航 · 本预设不改动"也走同一个构造器。
行：导航、间距、圆角（"圆角 · 0.5rem"，档位名 + 原值）、内容宽度、无衬线字体、等宽字体。
内置预设这一节的标题改成"布局（本预设不改动）"。

新 msgid：`Layout & Typography`、`Layout (unchanged by this preset)`。

**★ 快捷方式** — 本次新增的信息。标题"快捷方式 N"，下面一个列表：

```
[▫]  OpenWrt 官网          openwrt.org        ↗
[▫]  我的 NAS              192.168.1.8:5000   ↗
[▫]  Docker                /cgi-bin/luci/admin/docker
[▫]  实时状态（已关闭）     /cgi-bin/luci/admin/status
```

- 图标槽是**中性占位方块**，不试图画作者的真图标——图标字节根本没被分享（见"背景"末尾），
  画一个假的更误导。
- 第三列是目标：`http(s)://` 开头的**去掉 scheme 只显示 host + path**，其余原样显示路径。
  等宽字体、`--text-subtle`、`max-width:44%`、溢出省略号。
- 外链行尾一个 `↗`。列表下方一句小字："标 ↗ 的会打开外部网站，应用前会再确认一次。"
- `enabled === "0"` 的行整行 `opacity:.45`，标题后缀"（已关闭）"。
- 只在 `payload.toolbar.length` 非零时出现。

新 msgid：`Shortcuts %d`、`(disabled)`、
`Links marked ↗ open sites outside your router. You'll be asked to confirm before applying.`

**随附内容** — 现有的 tiles，去掉已经在"布局与排版"里说过的字体和圆角两枚，也去掉
快捷方式那枚（已单独成节）。剩标志、登录背景、站点图标、应用图标。标题从
"Beyond the preview"改为"随附内容"（新 msgid `Bundled content`，旧 msgid 停用）。

**底部小字** — "应用前会自动备份当前设置，之后可以一键恢复。"照旧。

### 7. 安全约束（不变，重申）

新增的快捷方式清单处理的全是 hub 来的不可信自由文本：

- 标题、url 只能经 `document.createTextNode` 或 `E()` 的 textContent-safe 子节点进入 DOM。
- 源码里继续不出现 `.innerHTML`。
- 不为 `icon` 字段构造任何 `<img src>` 或路径——那个文件在本机不存在，且名字来自 hub。
- 显示 url 时只做字符串截断，不解析成 `URL` 对象后取属性（避免把畸形输入喂给解析器），
  用正则剥掉 `^https?://` 前缀即可。

## 需要改的测试

`tests/gallery-view.test.mjs`：

- `"the header uses LuCI's own controls, not a bespoke pill set"`（:219）——按上面"明确反转"
  一节重写：删掉 `aurora-store-tabs` / `aurora-store-filters` 的断言，保留
  `cbi-input-text`、无 emoji、无 `.innerHTML` 三条，新增断言分段控件存在。
- `"tiles list what the preview cannot draw"`（:190）——保留全部现有断言（那些构造器都还在），
  新增：详情必须列出快捷方式的标题和 url，不能只有条数。
- 新增一条：快捷方式清单里的标题和 url 走 `createTextNode`，且源码不为 toolbar 的 `icon`
  构造 img。
- 新增一条：`Current` 徽章类不再存在，取而代之的是对号标记。

`tests/theme-preview-module.test.mjs` 不受影响（预览画法不动）。

## 交付顺序

1. 改 `STORE_CSS` + 页头 / 标签 / 分区标题 / 卡片结构。
2. 「正在使用」改对号。
3. 重做详情抽屉正文（去 `cbi-value`、颜色分组、合并布局与排版）。
4. 加快捷方式清单。
5. 更新测试、跑 `npm test`。
6. 抽新 msgid：`npm run gen-pot`，补 `po/zh_Hans`，其余语种留空由后续翻译。

## 参考

- 视觉稿：本次会话产出的 `store-redesign.html`（A/B/C 三版，最终选 A）。
- 上一版 UX 重设计 spec：`docs/specs/2026-08-04-theme-store-ux-redesign.md`。
