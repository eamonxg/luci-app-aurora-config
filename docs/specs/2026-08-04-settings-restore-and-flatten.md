# 设置页回滚工作台、拍平配色、导航三选卡

日期：2026-08-04
状态：已定稿（用户逐项确认）
影响范围：`htdocs/luci-static/resources/view/aurora/theme.js`、`tests/`、`po/`
关联：`docs/specs/2026-08-04-aurora-config-redesign.md`（前一版设计，其"设置 UI = 工作台"一节被本文推翻）、`docs/specs/2026-08-04-feed-and-update-check.md`（同期，头部版本区的另一半）

## 背景

`13aab18` 把设置页改成工作台：左侧五组 `<details>` 手风琴 + 右侧 340px 常驻预览列 + 粘性保存条。真机上不成立——Aurora 的页面容器是居中的 `--content-width-centered: 80rem`，两列布局从这 1280px 里切走 340px，控制面板被压到 ~920px，而预览画布本身只占一小块，右下留出大片空白。两列在无限宽的桌面里成立，在居中卡片里不成立。

用户裁定：回到 `5d04f40`（master 分叉点）的 UI 设计，在其基础上做局部优化。

## 决策

| 决策 | 结论 |
|---|---|
| 页面结构 | 回到 `form.Map` + `s.tab()` 标准写法；三个 tab：配色 / 布局与排版 / 品牌与快捷 |
| 工作台层 | 全部删除：手风琴、右侧预览列、⋯ 溢出菜单、粘性保存条、页脚版本徽标 |
| 版本徽标 | 回到头部（**不放页脚**——用户明确否决："设计上不好看，而且不够醒目"） |
| 预设下拉 | 不恢复。内置预设由商店的"内置"分组承接，恢复即两个入口做同一件事 |
| 头部"主题商店"按钮 | 不保留。tabmenu 里已有「主题设置 / 主题商店」入口，按钮是第二个重复入口 |
| 导出 / 导入 / 恢复默认 | 维持 `5d04f40` 的平铺三按钮，**不**收进 ⋯ 菜单（溢出菜单是工作台那版的产物，已被否决） |
| 配色 tab 嵌套 | 方案乙：源色 3 组平铺展开，3 个派生组收进单个「派生色」折叠块 |
| 导航样式 | `form.ListValue` 保留，`widget = "radio"` + 装饰 `renderWidget`，渲染成三张 CSS 线框卡 |

## 现状：配色 tab 的五层嵌套

摸到一个颜色输入框要穿过五层盒子，每层自带边框、标题和说明：

```
cbi-map
└ 分区卡 (s = NamedSection)
  └ tab 面板「配色」
    └ SectionValue _colors            ← 只为承载亮/暗子 tab
      └ 子 tab 亮色/暗色
        └ SectionValue _light_base_colors  ← 标题 "Source Color Tokens" + 说明
          └ details.aurora-token-group     ← 带边框圆角盒
            └ cbi-value 行（页面底色 / 卡片表面 …）
```

## 规格

### 1. 移除工作台层

| 删除对象 | 位置 |
|---|---|
| `WB_CSS` 常量 | `theme.js:1451-1489` |
| `buildWorkbench()` | `theme.js:2793-2934` |
| `"require utils.theme-preview as themePreview"` | `theme.js:9` |
| `versionFooter` 的页脚形态 | `theme.js:1888-1920` |
| `viewCtx.refreshPreview` 赋值与 `this.refreshPreview?.()` 调用 | `handleSave` / `handleSaveApply` |

`htdocs/luci-static/resources/utils/theme-preview.js` **保留**——`gallery.js` 在用，只是 `theme.js` 不再 require。

`handleReset` 恢复为 `5d04f40` 的实现：

```js
handleReset: function (ev) {
  this.colorEditor?.cleanupPreview();
  return this.super("handleReset", [ev]).then(() => {
    this.colorEditor?.schedule("light");
    this.colorEditor?.schedule("dark");
  });
}
```

工作台版改成 `window.location.reload()` 是因为 map 重渲染会在包装层之外重建 section DOM；包装层没了，这个理由随之消失。

`form.Map` 恢复标题：`new form.Map("aurora", _("Aurora Theme Settings"))`。

### 2. 头部（`m.description = headerBar`）

```
主题 [v1.1.13]  配置 [v1.1.3]        [导出配置] [导入配置] [恢复默认]
```

- 左侧版本徽标沿用 `5d04f40` 的 `class="label success"` 绿色胶囊
- `buildPresetToolbarNode()` 里的 `storeLink` 删除
- 右侧三个按钮的行为、确认框文案、`callResetDefaults` 调用一律不动
- 版本区右侧还会挂一枚"有新版"胶囊，由 `2026-08-04-feed-and-update-check.md` 定义；本文只保证布局留出位置，两份 spec 可独立落地

### 3. 配色 tab 拍平（方案乙）

目标层级：

```
分区卡 → tab「配色」→ 子 tab 亮/暗 → 分组标题 → 字段
```

改动：

1. `createColorSections()` 删除 `_${mode}_base_colors` 的 `form.SectionValue` 包裹。源色 option 经 `section.taboption(mode, ...)` 直接挂到子 tab 上——`addColorInputs()` 目前调用 `section.option(...)`，需要一个把 `option` 转发成 `taboption(mode, …)` 的适配对象，其余签名不变。
2. 派生色**保留一层包裹**，渲染成单个折叠块「派生色 · 由源色自动推导，留空即保持自动值」，内含既有的 3 个派生分组。默认收起。
3. `.aurora-token-group` 样式（`theme.js:1080-1147` 的 `ensureColorGroupStyles`）：
   - 去掉 `border`、`border-radius`、`[open]` 的 `background`
   - `summary` 保留加粗标题 + 说明，追加 `border-bottom: 1px solid var(--hairline)`
   - `.aurora-token-group-body` 去掉 `border-top`，左右 padding 归零
   - 折叠箭头与 `.navigation-group-toggle::after` 的复用不变
4. 源色 3 组默认 `open`，派生色折叠块默认收起。
5. `COLOR_FORMAT_HELP` 不再作为 section description——改用 LuCI 标准的 tab 描述槽：`colorSubsection.tab(mode, 标题, 描述)`，描述内容为「改动即时预览，保存后持久化。」+ `COLOR_FORMAT_HELP`。

   **不要挪进输入框 placeholder**：`renderColorField`（`theme.js:960-962`）已经占用了 `input.placeholder`——派生色填「自动」，源色填该 token 的预设值——那是比格式说明更有用的信息，不能覆盖。

不做：派生色折叠块上的"已覆盖 N 项"计数（评审中砍掉，不新增）。

**待验证**：`enhanceColorTokenGroups()`（`theme.js:1152`）按 `row.parentElement` 归组。拍平后行直接落在 tab 面板里，需确认同一 mode 下所有源色行的 `parentElement` 仍然唯一且不与派生色行混同；不成立则改用 `data-aurora-color-group` 值本身归组。

### 4. 导航三选卡

`nav_type` **仍是 `form.ListValue`**。不换成自定义 DOM 控件：`struct_content_width_centered` 上挂着 `depends("nav_type", "mega-menu")` / `depends("nav_type", "dropdown")` 和 `retain = true`，LuCI 的依赖联动走标准 widget 的 change 事件；换成裸 DOM 会让 `parse()` 在保存时把内容宽度整条删掉（`theme.js` 已有注释记录这个坑）。

做法：

```js
so.widget = "radio";
so.renderWidget = function (section_id, option_index, cfgvalue) {
  const node = form.ListValue.prototype.renderWidget.apply(this, arguments);
  // 往每个 radio 的 <label> 里注入 .aurora-nav-choice 线框
  return node;
};
```

- 三张卡：顶部大菜单 / 顶部下拉 / 侧边栏，线框纯 CSS（无图片、无网络请求），用主题变量上色，暗色模式自动跟随
- 选中态由 radio 的 `:checked` 驱动，不另存状态
- 窄屏三卡纵向堆叠
- 值语义、`change` 事件、`depends()` 全部不变——选中"侧边栏"时「内容最大宽度」照常隐藏

### 5. 测试

`tests/theme-workbench.test.mjs` 是给工作台写的，改写为 `tests/theme-settings-layout.test.mjs`，断言：

- 渲染结果中不存在任何 `aurora-wb-*` 类名
- 配色 tab 下不存在源色的 `SectionValue` 包裹
- 派生色渲染为单个折叠块
- `nav_type` 渲染出 3 个 radio，且每个带线框节点
- 选中 `sidebar` 时「内容最大宽度」隐藏，保存后该值仍在 uci 中（守住 `retain` 那个坑）

`tests/theme-color-editor-regressions.test.mjs` 中随工作台改过的一行同步回改。

### 6. i18n

新增字符串：三张导航卡的名称（若与既有 `Mega Menu` / `Dropdown` / `Sidebar` 复用则无新增）、「派生色」折叠块标题与说明、子 tab 短提示。删除字符串：工作台的 4 条（预览、亮色模式/暗色模式分段、画布说明）。改完重生成 `po/templates/aurora-config.pot` 并翻译 14 个语言。

## 不动的部分

颜色即时预览引擎、派生色覆盖与持久化、字体库、素材上传、快捷工具栏、导出/导入、`gallery.js` 商店页、`root/usr/libexec/rpcd/luci.aurora`。

## 验收

1. 页面在 1280px 居中容器里单列铺满，无右侧列、无粘性保存条
2. 配色 tab 从卡片到输入框不超过三层容器
3. 导航样式显示为三张线框卡；切到"侧边栏"时内容宽度隐藏，保存并应用后再进页面，切回"顶部大菜单"，内容宽度仍是原值
4. 亮色改动仍即时作用于当前页面
5. 全部测试通过
