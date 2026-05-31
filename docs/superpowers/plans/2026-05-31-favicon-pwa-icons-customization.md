# Favicon & PWA Icon Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打平 `pwa/` 目录结构、删除未引用资源，并在 Site Branding 配置界面中支持自定义 SVG/PNG/ICO favicon 和三个 PWA 移动端图标。

**Architecture:** luci-theme-aurora 侧做文件结构调整和模板改动，luci-app-aurora-config 侧添加 `write_pwa_manifest` RPC、更新 ACL、清理 template 文件，并在 theme.js 中新增 6 个 `form.ListValue` 配置项及保存后写 manifest 的钩子。

**Tech Stack:** ucode (server-side templating)、OpenWrt UCI、LuCI CBI JS（`form.ListValue`、`rpc.declare`）、sh POSIX shell RPC 脚本。

---

## 文件变更地图

### luci-theme-aurora

| 操作 | 路径 |
|---|---|
| 删除目录 | `.dev/public/aurora/images/pwa/` |
| 删除目录 | `htdocs/luci-static/aurora/images/pwa/` |
| 删除文件 | `htdocs/.../images/favicon-16x16.png` |
| 删除文件 | `htdocs/.../images/favicon-32x32.png` |
| 删除文件 | `htdocs/.../images/logo_32.png` |
| 新增文件（打平） | `htdocs/.../images/app-icon-192x192.png` |
| 新增文件（打平） | `htdocs/.../images/app-icon-512x512.png` |
| 新增文件（打平） | `htdocs/.../images/apple-touch-icon.png` |
| 新增文件（打平） | `htdocs/.../images/app.webmanifest` |
| 修改 | `ucode/template/themes/aurora/header.ut` |

### luci-app-aurora-config

| 操作 | 路径 |
|---|---|
| 修改 | `root/usr/libexec/rpcd/luci.aurora` |
| 修改 | `root/usr/share/rpcd/acl.d/luci-app-aurora.json` |
| 修改 × 5 | `root/usr/share/aurora/*.template` |
| 修改 | `root/etc/uci-defaults/80_aurora` |
| 修改 | `htdocs/luci-static/resources/view/aurora/theme.js` |

---

## Task 1: luci-theme-aurora — 打平 pwa/ 目录并删除未引用资源

**Files:**
- Modify (delete): `htdocs/luci-static/aurora/images/pwa/*`
- Modify (delete): `.dev/public/aurora/images/pwa/*`
- Delete: `htdocs/luci-static/aurora/images/favicon-16x16.png`
- Delete: `htdocs/luci-static/aurora/images/favicon-32x32.png`
- Delete: `htdocs/luci-static/aurora/images/logo_32.png`

- [ ] **Step 1: 将 pwa/ 文件移至 images/ 根目录（htdocs 和 .dev/public 各一份）**

```bash
IMG=htdocs/luci-static/aurora/images
DEV=.dev/public/aurora/images

# htdocs
cp "$IMG/pwa/app-icon-192x192.png" "$IMG/app-icon-192x192.png"
cp "$IMG/pwa/app-icon-512x512.png" "$IMG/app-icon-512x512.png"
cp "$IMG/pwa/apple-touch-icon.png" "$IMG/apple-touch-icon.png"
cp "$IMG/pwa/app.webmanifest"      "$IMG/app.webmanifest"

# .dev/public
cp "$DEV/pwa/app-icon-192x192.png" "$DEV/app-icon-192x192.png"
cp "$DEV/pwa/app-icon-512x512.png" "$DEV/app-icon-512x512.png"
cp "$DEV/pwa/apple-touch-icon.png" "$DEV/apple-touch-icon.png"
cp "$DEV/pwa/app.webmanifest"      "$DEV/app.webmanifest"
```

- [ ] **Step 2: 删除 pwa/ 子目录和未引用文件**

```bash
IMG=htdocs/luci-static/aurora/images
DEV=.dev/public/aurora/images

rm -rf "$IMG/pwa" "$DEV/pwa"
rm -f  "$IMG/favicon-16x16.png" "$DEV/favicon-16x16.png"
rm -f  "$IMG/favicon-32x32.png" "$DEV/favicon-32x32.png"
rm -f  "$IMG/logo_32.png"       "$DEV/logo_32.png"
```

- [ ] **Step 3: 验证目录结构**

运行：
```bash
ls htdocs/luci-static/aurora/images/
```

期望输出（无 `pwa/` 子目录，无 `favicon-16x16.png`/`favicon-32x32.png`/`logo_32.png`）：
```
app-icon-192x192.png  app.webmanifest  apple-touch-icon.png  app-icon-512x512.png
favicon.ico  logo.svg  network.svg  overview.svg  software.svg  system.svg
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor: flatten pwa/ directory and remove unused image assets"
```

---

## Task 2: luci-theme-aurora — 更新 header.ut

**Files:**
- Modify: `ucode/template/themes/aurora/header.ut` (lines 22, 129–132)

- [ ] **Step 1: 在 `logo_svg` 声明行之后追加三个新 token**

定位 `header.ut` line 22：
```ucode
const logo_svg = tokens.logo_svg || 'logo.svg';
```

替换为：
```ucode
const logo_svg = tokens.logo_svg || 'logo.svg';
const favicon_png = tokens.favicon_png || '';
const favicon_ico = tokens.favicon_ico || 'favicon.ico';
const pwa_apple_touch = tokens.pwa_apple_touch || 'apple-touch-icon.png';
```

- [ ] **Step 2: 替换 favicon / apple-touch-icon / manifest 四行链接（原 lines 129–132）**

将：
```html
<link rel="icon" href="{{ media }}/images/{{ logo_svg }}?v={{ icon_cache_version }}" sizes="any" type="image/svg+xml">
<link rel="icon" href="{{ media }}/images/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="{{ media }}/images/pwa/apple-touch-icon.png?v={{ icon_cache_version }}">
<link rel="manifest" href="{{ media }}/images/pwa/app.webmanifest">
```

替换为：
```html
{% if (logo_svg =~ /\.svg$/i): %}
<link rel="icon" href="{{ media }}/images/{{ logo_svg }}?v={{ icon_cache_version }}" sizes="any" type="image/svg+xml">
{% endif %}
{% if (favicon_png): %}
<link rel="icon" href="{{ media }}/images/{{ favicon_png }}?v={{ icon_cache_version }}" type="image/png">
{% endif %}
<link rel="icon" href="{{ media }}/images/{{ favicon_ico }}" sizes="32x32">
<link rel="apple-touch-icon" href="{{ media }}/images/{{ pwa_apple_touch }}?v={{ icon_cache_version }}">
<link rel="manifest" href="{{ media }}/images/app.webmanifest">
```

- [ ] **Step 3: 验证模板语法无误**

```bash
grep -n "favicon\|apple-touch\|manifest\|logo_svg\|favicon_png\|favicon_ico\|pwa_apple" \
  ucode/template/themes/aurora/header.ut
```

期望：可看到 4 个新 token 声明行 + 5 行 favicon link 输出（含 2 个 `{% if %}` 块）。

- [ ] **Step 4: 提交**

```bash
git add ucode/template/themes/aurora/header.ut
git commit -m "feat: dynamic favicon chain and flatten pwa paths in header.ut"
```

---

## Task 3: luci-app-aurora-config — 清理 5 个 .template 文件

**Files:**
- Modify: `root/usr/share/aurora/classic.template`
- Modify: `root/usr/share/aurora/sage-green.template`
- Modify: `root/usr/share/aurora/amber-sand.template`
- Modify: `root/usr/share/aurora/monochrome.template`
- Modify: `root/usr/share/aurora/sky-blue.template`

每个 template 在 `option logo_svg 'logo.svg'` 附近做相同操作。

- [ ] **Step 1: 删除 `option logo_png 'logo_32.png'` 并插入新默认值（5 个文件统一）**

对每个 template，将：
```
	option icon_cache_version '0'
	option logo_svg 'logo.svg'
	option logo_png 'logo_32.png'
```

替换为：
```
	option icon_cache_version '0'
	option logo_svg 'logo.svg'
	option favicon_png ''
	option favicon_ico 'favicon.ico'
	option pwa_apple_touch 'apple-touch-icon.png'
	option pwa_icon_192 'app-icon-192x192.png'
	option pwa_icon_512 'app-icon-512x512.png'
```

- [ ] **Step 2: 验证 5 个文件都已修改，无残留 logo_png**

```bash
grep -r "logo_png" root/usr/share/aurora/
```

期望：无任何输出。

```bash
grep -r "pwa_icon_192" root/usr/share/aurora/
```

期望：5 个文件各出现一行。

- [ ] **Step 3: 提交**

```bash
git add root/usr/share/aurora/
git commit -m "feat: add favicon/pwa UCI defaults to templates, remove legacy logo_png"
```

---

## Task 4: luci-app-aurora-config — 80_aurora 迁移脚本

**Files:**
- Modify: `root/etc/uci-defaults/80_aurora`

- [ ] **Step 1: 在 `main()` 末尾、`cleanup_legacy_font_options` 调用之后添加迁移**

定位 `main()` 函数体末尾（在 `cleanup_legacy_font_options` 之后）：

将：
```sh
    cleanup_legacy_font_options
}
```

替换为：
```sh
    cleanup_legacy_font_options

    # Remove legacy logo_png option
    if uci -q get aurora.theme.logo_png >/dev/null 2>&1; then
        uci -q delete aurora.theme.logo_png
        uci -q commit aurora
    fi
}
```

- [ ] **Step 2: 验证语法**

```bash
sh -n root/etc/uci-defaults/80_aurora && echo "OK"
```

期望输出：`OK`

- [ ] **Step 3: 提交**

```bash
git add root/etc/uci-defaults/80_aurora
git commit -m "feat: migrate existing aurora config, remove legacy logo_png option"
```

---

## Task 5: luci-app-aurora-config — 新增 write_pwa_manifest RPC

**Files:**
- Modify: `root/usr/libexec/rpcd/luci.aurora`

- [ ] **Step 1: 在 `list` 段添加方法声明**

定位 `"list"` 段中 `json_add_object "remove_login_bg"; json_close_object` 附近，在其后添加：

```sh
	json_add_object "write_pwa_manifest"; json_close_object
```

- [ ] **Step 2: 在 `call` 段添加实现**

在 `"remove_icon"` case 之后、下一个 case 之前插入：

```sh
	"write_pwa_manifest")
		icon_192=$(uci -q get aurora.theme.pwa_icon_192)
		icon_512=$(uci -q get aurora.theme.pwa_icon_512)
		[ -z "$icon_192" ] && icon_192="app-icon-192x192.png"
		[ -z "$icon_512" ] && icon_512="app-icon-512x512.png"

		manifest_file="$ICON_PATH/app.webmanifest"
		tmp_file="${manifest_file}.tmp"

		cat > "$tmp_file" <<MANIFEST
{
  "name": "LuCI Aurora",
  "short_name": "Aurora",
  "start_url": "/cgi-bin/luci",
  "scope": "/",
  "display": "standalone",
  "background_color": "#f8fafc",
  "theme_color": "#f8fafc",
  "icons": [
    {
      "src": "/luci-static/aurora/images/${icon_192}",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/luci-static/aurora/images/${icon_512}",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
MANIFEST

		if mv "$tmp_file" "$manifest_file" 2>/dev/null; then
			chmod 0644 "$manifest_file"
			echo '{ "result": 0 }'
		else
			rm -f "$tmp_file"
			echo '{ "result": 1, "error": "Failed to write manifest" }'
		fi
		;;
```

- [ ] **Step 3: 验证脚本语法**

```bash
sh -n root/usr/libexec/rpcd/luci.aurora && echo "OK"
```

期望输出：`OK`

- [ ] **Step 4: 验证 list 段包含新方法**

```bash
grep "write_pwa_manifest" root/usr/libexec/rpcd/luci.aurora
```

期望：出现 2 行（list 段 + call 段）。

- [ ] **Step 5: 提交**

```bash
git add root/usr/libexec/rpcd/luci.aurora
git commit -m "feat: add write_pwa_manifest RPC to generate manifest from UCI"
```

---

## Task 6: luci-app-aurora-config — 更新 ACL

**Files:**
- Modify: `root/usr/share/rpcd/acl.d/luci-app-aurora.json`

- [ ] **Step 1: 将 `write_pwa_manifest` 加入 write.ubus**

定位 `"write"` → `"ubus"` → `"luci.aurora"` 数组，在 `"upload_icon"` 之后添加：

```json
"write_pwa_manifest",
```

结果该数组变为：
```json
"luci.aurora": [
  "upload_icon",
  "write_pwa_manifest",
  "remove_icon",
  ...
]
```

- [ ] **Step 2: 验证 JSON 合法**

```bash
python3 -c "import json,sys; json.load(open('root/usr/share/rpcd/acl.d/luci-app-aurora.json')); print('OK')"
```

期望输出：`OK`

- [ ] **Step 3: 提交**

```bash
git add root/usr/share/rpcd/acl.d/luci-app-aurora.json
git commit -m "feat: grant write_pwa_manifest permission in aurora ACL"
```

---

## Task 7: luci-app-aurora-config — 更新 theme.js

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/theme.js`

### Step 7.1 — 声明 callWritePwaManifest RPC

- [ ] 在现有 RPC 声明块末尾（`callResetDefaults` 之后）添加：

```js
const callWritePwaManifest = rpc.declare({
  object: "luci.aurora",
  method: "write_pwa_manifest",
});
```

### Step 7.2 — 扩展 handleSave / handleSaveApply

- [ ] 将现有 `handleSave` 替换为：

```js
handleSave: function (ev) {
  const save = L.bind(function () {
    return this.super("handleSave", ev);
  }, this);
  const writePwa = () => L.resolveDefault(callWritePwaManifest(), {});

  if (typeof this.prepareAuroraFonts === "function") {
    return this.prepareAuroraFonts().then(save).then(writePwa);
  }
  return save().then(writePwa);
},
```

- [ ] 将现有 `handleSaveApply` 替换为：

```js
handleSaveApply: function (ev) {
  const saveApply = L.bind(function () {
    return this.super("handleSaveApply", ev);
  }, this);
  const writePwa = () => L.resolveDefault(callWritePwaManifest(), {});

  if (typeof this.prepareAuroraFonts === "function") {
    return this.prepareAuroraFonts().then(saveApply).then(writePwa);
  }
  return saveApply().then(writePwa);
},
```

### Step 7.3 — 重命名 Tab

- [ ] 定位：

```js
s.tab("icons_branding", _("Login & Branding"));
```

替换为：

```js
s.tab("icons_branding", _("Branding"));
```

### Step 7.4 — 扩展 Logo Icon 支持全格式

- [ ] 定位 `logoSection` 的 `logo_svg` 选项 load 函数中的过滤条件（约 line 1403）：

```js
if (icon.endsWith(".svg")) {
  this.value(icon, icon);
}
```

替换为：

```js
if (isImageFile(icon)) {
  this.value(icon, icon);
}
```

- [ ] 同一选项的标签和描述更新，定位：

```js
so = logoSubsection.option(form.ListValue, "logo_svg", _("Logo Icon"));
```

替换为：

```js
so = logoSubsection.option(form.ListValue, "logo_svg", _("Logo / Favicon"));
```

### Step 7.5 — 新增 Favicon (PNG) 选项

- [ ] 在 `logo_svg` 选项定义结束后（`so.load = function...` 整块之后），插入：

```js
so = logoSubsection.option(form.ListValue, "favicon_png", _("Favicon (PNG)"));
so.description = _("Optional PNG favicon for browsers that do not support SVG favicons.");
so.rmempty = true;
so.load = function (section_id) {
  return L.resolveDefault(callListIcons(), { icons: [] }).then(
    L.bind(function (response) {
      const icons = response?.icons || [];
      this.keylist = [];
      this.vallist = [];
      this.value("", _("(None)"));
      icons.forEach(L.bind(function (icon) {
        if (/\.png$/i.test(icon)) this.value(icon, icon);
      }, this));
      return form.ListValue.prototype.load.apply(this, [section_id]);
    }, this)
  );
};
```

### Step 7.6 — 新增 Favicon (ICO) 选项

- [ ] 在 `favicon_png` 选项之后插入：

```js
so = logoSubsection.option(form.ListValue, "favicon_ico", _("Favicon (ICO / Legacy)"));
so.description = _("ICO favicon served to legacy browsers as fallback.");
so.default = "favicon.ico";
so.rmempty = false;
so.load = function (section_id) {
  return L.resolveDefault(callListIcons(), { icons: [] }).then(
    L.bind(function (response) {
      const icons = response?.icons || [];
      this.keylist = [];
      this.vallist = [];
      icons.forEach(L.bind(function (icon) {
        if (/\.ico$/i.test(icon)) this.value(icon, icon);
      }, this));
      return form.ListValue.prototype.load.apply(this, [section_id]);
    }, this)
  );
};
```

### Step 7.7 — 新增 PWA / Mobile Icons 区域

- [ ] 在 `favicon_ico` 选项之后、`struct_login_bg` 选项之前，插入 PWA 区域标题行：

```js
logoSubsection.option(form.SectionValue, "_pwa_divider", form.NamedSection, "theme", "aurora",
  _("PWA / Mobile Icons"),
  _("Select icons used when the app is installed to a home screen. Only non-SVG image formats are supported by iOS and Android.")
);
```

- [ ] 紧接着插入三个 PWA 图标 ListValue，使用同一个 load 辅助（非 SVG 图片过滤）：

```js
const pwaIconSlots = [
  ["pwa_apple_touch", _("Apple Touch Icon"),  "apple-touch-icon.png"],
  ["pwa_icon_192",    _("App Icon 192×192"),  "app-icon-192x192.png"],
  ["pwa_icon_512",    _("App Icon 512×512"),  "app-icon-512x512.png"],
];

pwaIconSlots.forEach(function ([key, label, defaultVal]) {
  so = logoSubsection.option(form.ListValue, key, label);
  so.default = defaultVal;
  so.rmempty = false;
  so.load = function (section_id) {
    return L.resolveDefault(callListIcons(), { icons: [] }).then(
      L.bind(function (response) {
        const icons = response?.icons || [];
        this.keylist = [];
        this.vallist = [];
        icons.forEach(L.bind(function (icon) {
          if (isImageFile(icon) && !/\.svg$/i.test(icon)) {
            this.value(icon, icon);
          }
        }, this));
        return form.ListValue.prototype.load.apply(this, [section_id]);
      }, this)
    );
  };
});
```

### Step 7.8 — 验证并提交

- [ ] 检查无语法错误（浏览器打开配置页不报 JS 错误，或用 node 快速检查）：

```bash
node --input-type=module --eval "
import { readFileSync } from 'fs';
readFileSync('htdocs/luci-static/resources/view/aurora/theme.js', 'utf8');
console.log('parse OK');
" 2>&1 || node -e "require('fs').readFileSync('htdocs/luci-static/resources/view/aurora/theme.js','utf8'); console.log('OK')"
```

期望：输出 `OK` 或 `parse OK`（只做读取检查，非完整 lint）。

- [ ] 确认关键字符串存在：

```bash
grep -c "callWritePwaManifest\|favicon_png\|favicon_ico\|pwa_apple_touch\|pwa_icon_192\|pwa_icon_512" \
  htdocs/luci-static/resources/view/aurora/theme.js
```

期望：`6`（每个关键词至少出现 1 次，`grep -c` 计行数，实际出现多次亦可）。

- [ ] 提交：

```bash
git add htdocs/luci-static/resources/view/aurora/theme.js
git commit -m "feat: add favicon PNG/ICO and PWA icon selectors in Branding tab"
```

---

## 自检结果

| Spec 需求 | 对应 Task |
|---|---|
| 删除 pwa/ 子目录并打平 | Task 1 |
| 删除 favicon-16x16/32x32/logo_32 | Task 1 |
| header.ut 动态 favicon chain | Task 2 |
| apple-touch-icon / manifest 路径打平 | Task 2 |
| template 删除 logo_png 并添加新默认值 | Task 3 |
| 80_aurora 迁移清理 logo_png | Task 4 |
| write_pwa_manifest RPC | Task 5 |
| ACL 权限更新 | Task 6 |
| Tab 改名 "Branding" | Task 7.3 |
| Logo / Favicon 全格式支持 | Task 7.4 |
| Favicon (PNG) 可选 | Task 7.5 |
| Favicon (ICO) 可选 | Task 7.6 |
| PWA 三个图标 ListValue | Task 7.7 |
| 保存时写 manifest | Task 7.1 + 7.2 |
| sysauth.ut | 无需改动（include header.ut，链接由 header.ut 输出）|
