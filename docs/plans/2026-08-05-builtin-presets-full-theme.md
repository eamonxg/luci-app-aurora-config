# 内置预设从"只换颜色"升级为"整套主题"

日期：2026-08-05
状态：完成（含真机验证）

## 背景

`luci-app-aurora-config` 现在有 5 个内置预设（default / monochrome / sage-green /
amber-sand / sky-blue）。`root/usr/share/aurora/*.template` 里除了 `default.template`
以外，全部只有 62 行 `light_*` / `dark_*` 颜色，`apply_theme_preset` 的
`load_preset_snapshot()` 也只认 `option (light|dark)_` 这一种行。结果就是：5 个内置预设
之间只有配色不同，主题真正能配的那些东西（导航形态、圆角、间距、内容宽度、字体）
一个都没体现。

主题商店里社区配置走的是 hub payload，本来就带 `layout` / `typography` / `toolbar`，
所以"一份配置 = 一整套外观"的概念在这个包里早就存在——内置预设只是没用上它。

## 验收清单

1. 5 个内置预设各自是一套完整外观：导航形态、圆角、间距、内容宽度、无衬线字体、
   等宽字体、工具栏开关都随预设走，并且互相尽量拉开差距。
2. `apply_theme_preset` 真的把这些结构项写进 UCI（不是只写颜色）。
3. 预设点名的网络字体会被下载，不是静默退回 Lato。
4. 主题商店的内置卡片 / 抽屉如实展示每个预设带了什么，删掉"仅颜色 / 布局不变"
   那套已经不成立的说明文案。
5. `node --test tests/*.test.mjs` 全绿；受影响的既有断言一并更新。
6. po/pot 同步；README / docs 里描述内置预设的地方一并改。

## 不做的事（明确划界）

- **不重写 `toolbar_item` 段**。工具栏条目是用户自己编的数据，预设里带一份就意味着
  应用预设会把用户的快捷方式删掉——而内置预设这条路径没有 hub apply 的
  `pre-hub-backup.conf` 备份兜底。预设只带 `toolbar_enabled` 这个开关，
  一键可逆、零数据损失。
- **不动 `default.template` 的取值**。它同时是 `uci-defaults` 的出厂配置，改它等于
  改全新安装的默认外观，不在这次范围内。
- **不改 `scripts/aurora-presets.json`**。那是 `sync-tokens.mjs` 从
  `@eamonxg/luci-theme-tokens` 拷下来的产物，下次 sync 会被覆盖。结构项的唯一来源是
  模板文件本身。
- **间距只走三档，且 0.3rem 不上侧边栏**。`struct_spacing` 一次性缩放所有组件的
  内边距和间隙，能用的档位很窄：0.2 / 0.25 / 0.3rem。0.3rem 需要有地方舒展，而侧边栏
  外壳没有——它第一列已经吃掉了横向留白、页面本身跑全宽，那里放 0.3rem 读起来不像
  "更宽松的主题"，像布局散架了。所以 0.3rem 只配中置布局 + 更宽的内容列
  （Sage Green：mega-menu + 92rem）。`tests/builtin-presets.test.mjs` 里
  "spacing stays on its three stops" 守着这条。

## 五套预设

| | Default | Monochrome | Sage Green | Amber Sand | Sky Blue |
|---|---|---|---|---|---|
| 性格 | 官方基线 | 极简工作站 | 柔和自然 | 温暖纸感 | 清爽原生 |
| nav_type | mega-menu | dropdown | mega-menu | sidebar | sidebar |
| radius | 0.5rem | 0rem | 0.875rem | 0.375rem | 0.75rem |
| spacing | 0.25rem | 0.2rem | 0.3rem | 0.25rem | 0.25rem |
| content width | 80rem | 88rem | 92rem | 96rem | 80rem |
| sans | Lato | Geist Sans | Nunito | Space Grotesk | System UI |
| mono | 系统等宽 | JetBrains Mono | Maple Mono | Fira Code | 系统等宽 |
| toolbar | 开 | 关 | 开 | 开 | 开 |
| 需要联网取字体 | 否 | 是 | 是 | 是 | 否 |

取值都落在设置页滑块的合法档位上（radius step 0.125、spacing step 0.05、width step 1），
也都在 `validate_and_apply_hub_payload` 给 hub 配置定的范围内，两条路径判同一套边界。

Default 和 Sky Blue 不需要下载任何字体，离线路由器上也是完整效果。

## 实现步骤

### 1. 模板（`root/usr/share/aurora/*.template`）

给 4 个非 default 模板补上结构块，键名和 `default.template` 完全一致：
`struct_font_sans` / `struct_font_mono` / `struct_spacing` /
`struct_content_width_centered` / `struct_radius_base` / `nav_type` / `toolbar_enabled`。

字体栈必须逐字抄 `font-presets.conf` 第 7 列——`get_font_preset_from_uci()` 是拿栈字符串
反查预设 id 的，差一个空格就认不出来，字体下载和设置页回显一起失效。

`gen-presets.mjs` 只替换颜色行、保留其余行，所以结构块写完不会被再生覆盖。

### 2. rpcd（`root/usr/libexec/rpcd/luci.aurora`）

- `load_preset_snapshot()` 增加第二遍 awk：按白名单收结构项，逐项做和
  `validate_and_apply_hub_payload` 同样的校验（枚举 / `^[0-9]+(\.[0-9]+)?rem$` + 范围 /
  字体栈字符集与长度），少一项就整体失败。
- `apply_theme_preset` 不用改写入逻辑——快照多了几行 `key=value`，同一个 `uci batch`
  循环就写进去了。
- 新增 `download_fonts_from_uci()`：先同步写 CSS（立刻生效，用已缓存的字体），再 fork
  一个后台进程按新的字体选择补下载 woff2。`apply_theme_preset` 提交成功后调用。
  没有它，预设点名的 Nunito / Geist 只会静默退回栈里的 Lato。

### 3. `scripts/gen-presets.mjs`

`htdocs/luci-static/resources/aurora/presets.json` 改成 hub preview 投影的形状：

```json
{ "presets": { "<id>": { "colors": {…}, "layout": {…}, "typography": {…}, "toolbar": [] } } }
```

颜色来自 `scripts/aurora-presets.json`（vendored），`layout` / `typography` 从模板里
解析——模板是结构项唯一的源，两边不可能漂。

### 4. 商店（`htdocs/luci-static/resources/view/aurora/gallery.js`）

内置条目改成 `{ id, label, preview }`，`preview` 就是上面那个投影。这样
`paletteOf` / `navOf` / `tileEntriesFor` / `buildCardGlyphs` 这些现成的取值器直接就能用在
内置预设上，卡片和抽屉不用再各写一套。

- 卡片缩略图用预设自己的 `nav_type`（而不是当前 UCI 的），glyph 行跟社区卡一样出。
- 抽屉里"Layout (unchanged by this preset)"整段换成和社区抽屉同一张
  `buildKvList`（导航 / 间距 / 圆角 / 内容宽度 / 两个字体）。
- 应用确认框和抽屉脚注改写：明说会一并改布局与排版，不再说"只改颜色"。

### 5. 测试 / 文案 / 文档

- `tests/gallery-view.test.mjs`：`opts: { nav: currentNav }`、`glyphs: null`
  两条断言随实现更新。
- 新增 `tests/builtin-presets.test.mjs`：模板结构项完整且取值合法（含滑块档位）、
  5 个预设互不相同、字体栈逐字来自名册、rpcd 键表与模板一致、presets.json 与模板一致。
- po/pot 同步，README 与 docs 中描述内置预设的段落更新。

## 验收结果

1. ✅ 5 套预设各带一整套外观，见上表；`tests/builtin-presets.test.mjs` 里
   "the five presets are five different looks" 守着"不能退回只换配色"。
2. ✅ 真机 192.168.8.1 依次应用 monochrome / sage-green / sky-blue，
   `uci show aurora.theme` 与登录页注入的 CSS 变量都跟着变：
   `--radius-base` 0rem → 1.125rem → 0.75rem，
   `--spacing` 0.2 → 0.3 → 0.25rem，
   `data-nav-type` dropdown → mega-menu → sidebar，
   `--font-sans` Geist Sans → Nunito → system-ui。
3. ✅ 应用 monochrome 后 `/www/luci-static/aurora/fonts/` 出现
   geist-sans 4 档 + jetbrains-mono 2 档 woff2，`aurora-font.css` 同步写好。
4. ✅ 应用前后 `toolbar_item` 段仍是 4 个 —— 用户的快捷方式没被预设动过。
5. ✅ `get_theme_preset` 分组返回 colors(62) / layout(5) / typography(2)，
   colors 里没有混进 struct_*。
6. ✅ `node --test tests/*.test.mjs` 223 passed / 0 failed；14 个 po `msgfmt --check` 全过。

验证结束后已把 `/etc/config/aurora` 从 `/tmp/aurora.pre-verify` 还原，
字体缓存也清回只剩 Lato，路由器配置与验证前一致。
