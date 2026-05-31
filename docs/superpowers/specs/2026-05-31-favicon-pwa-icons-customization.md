# Favicon & PWA Icon Customization

**日期：** 2026-05-31
**涉及仓库：** `luci-theme-aurora`、`luci-app-aurora-config`

---

## 背景

当前主题的 favicon、PWA 图标均为静态硬编码文件，用户无法通过配置界面自定义。本次改动分两个方向：

1. **打平 `pwa/` 目录结构**，删除未被引用的冗余文件
2. **将 favicon 和 PWA 图标纳入 Site Branding 配置**，通过 UCI 字段控制，保存时生成 `app.webmanifest`

---

## 变更范围总览

### luci-theme-aurora

| 操作 | 文件 |
|---|---|
| 删除目录 | `htdocs/luci-static/aurora/images/pwa/`（含全部子文件）|
| 删除文件 | `images/favicon-16x16.png`、`images/favicon-32x32.png`、`images/logo_32.png` |
| 新增文件 | `images/app-icon-192x192.png`（原 `pwa/` 内容打平）|
| 新增文件 | `images/app-icon-512x512.png` |
| 新增文件 | `images/apple-touch-icon.png` |
| 新增文件 | `images/app.webmanifest` |
| 修改 | `ucode/template/themes/aurora/header.ut` |
| 修改 | `ucode/template/themes/aurora/sysauth.ut` |
| 同步 | `.dev/public/aurora/images/` 与 `htdocs/` 保持一致 |

### luci-app-aurora-config

| 操作 | 文件 |
|---|---|
| 修改 | `root/usr/libexec/rpcd/luci.aurora` |
| 修改 | `root/usr/share/rpcd/acl.d/luci-app-aurora.json` |
| 修改 | `root/usr/share/aurora/*.template`（5 个）|
| 修改 | `root/etc/uci-defaults/80_aurora` |
| 修改 | `htdocs/luci-static/resources/view/aurora/theme.js` |

---

## luci-theme-aurora 详细改动

### 目录结构打平

删除 `pwa/` 子目录，所有文件移至 `images/` 根目录：

```
images/pwa/app-icon-192x192.png  →  images/app-icon-192x192.png
images/pwa/app-icon-512x512.png  →  images/app-icon-512x512.png
images/pwa/apple-touch-icon.png  →  images/apple-touch-icon.png
images/pwa/app.webmanifest       →  images/app.webmanifest
```

删除未被任何模板引用的文件：
- `favicon-16x16.png`（header.ut 无引用）
- `favicon-32x32.png`（header.ut 无引用）
- `logo_32.png`（header.ut 无引用）

保留 `software.svg`（template 中 toolbar_item 有引用，disabled 状态）。

### header.ut 改动

**新增 UCI token 读取（在现有 `logo_svg` 行附近）：**

```ucode
const logo_svg = tokens.logo_svg || 'logo.svg';
const favicon_png = tokens.favicon_png || '';
const favicon_ico = tokens.favicon_ico || 'favicon.ico';
const pwa_apple_touch = tokens.pwa_apple_touch || 'apple-touch-icon.png';
```

**favicon `<link>` 标签替换（原 lines 129-132）：**

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

逻辑说明：
- `logo_svg` 为 SVG 时输出 SVG favicon link；为 PNG 等格式时跳过，浏览器降级到 PNG/ICO
- `favicon_png` 为空时跳过，不输出 PNG favicon link
- ICO 始终输出（旧浏览器兜底）
- apple-touch-icon 和 manifest 路径更新为打平后路径

### sysauth.ut 改动

`apple-touch-icon` link 路径打平（`pwa/` → 根目录），与 header.ut 保持一致。

---

## luci-app-aurora-config 详细改动

### 新 UCI 字段

| 字段 | 类型 | 默认值 | 用途 |
|---|---|---|---|
| `logo_svg` | string | `logo.svg` | 主 Logo / SVG favicon（现有，行为扩展）|
| `favicon_png` | string | `''` | PNG favicon（可选）|
| `favicon_ico` | string | `favicon.ico` | ICO legacy favicon |
| `pwa_apple_touch` | string | `apple-touch-icon.png` | iOS 主屏图标 |
| `pwa_icon_192` | string | `app-icon-192x192.png` | PWA manifest 192×192 图标 |
| `pwa_icon_512` | string | `app-icon-512x512.png` | PWA manifest 512×512 图标 |

### luci.aurora RPC 新增方法：`write_pwa_manifest`

**无参数**，从 UCI 读取 `pwa_icon_192`、`pwa_icon_512`，写入 `images/app.webmanifest`。

Metadata（`name`、`short_name`、`theme_color`、`background_color`、`display`）维持硬编码，不通过 UCI 控制。

生成的 manifest 结构：
```json
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
      "src": "/luci-static/aurora/images/<pwa_icon_192>",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/luci-static/aurora/images/<pwa_icon_512>",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

写入路径：`/www/luci-static/aurora/images/app.webmanifest`

### ACL 更新

`acl.d/luci-app-aurora.json` 新增：
- `write.ubus.luci.aurora`：添加 `"write_pwa_manifest"`

无需新增文件路径权限（打平后所有文件均在 `images/` 根目录，现有 `images/*` 通配符已覆盖）。

### *.template 更新（5 个文件统一）

**删除：**
```
option logo_png 'logo_32.png'
```

**新增：**
```
option favicon_png ''
option favicon_ico 'favicon.ico'
option pwa_apple_touch 'apple-touch-icon.png'
option pwa_icon_192 'app-icon-192x192.png'
option pwa_icon_512 'app-icon-512x512.png'
```

### 80_aurora 迁移脚本

在 `main()` 中新增迁移逻辑，清理现有安装的旧字段：

```sh
uci -q delete aurora.theme.logo_png && uci -q commit aurora
```

### theme.js UI 改动

**Tab 重命名：** `"Login & Branding"` → `"Branding"`

**Site Branding section 描述更新：** 移除 "Upload your SVG file" 的 SVG 限制说明。

**Logo Icon（现有 `logo_svg` 选项）改动：**
- 过滤从 `icon.endsWith(".svg")` → `isImageFile(icon)`（支持全格式）
- 标签从 `"Logo Icon"` → `"Logo / Favicon"`
- 描述补充：用作浏览器 SVG favicon 及登录页 logo

**新增 Favicon (PNG) 选项，UCI: `favicon_png`：**
- `form.ListValue`，从 `list_icons` 加载，仅显示 `.png` 文件
- `rmempty = true`（可选，不选则不输出 PNG favicon link）
- 标签：`"Favicon (PNG)"`

**新增 Favicon (ICO) 选项，UCI: `favicon_ico`：**
- `form.ListValue`，从 `list_icons` 加载，仅显示 `.ico` 文件
- 默认值：`'favicon.ico'`
- 标签：`"Favicon (ICO / Legacy)"`

**新增 PWA / Mobile Icons 子区域（在 Login Background 之后）：**

三个 `form.ListValue`，均从 `list_icons` 加载，筛选条件：`isImageFile(icon) && !icon.endsWith(".svg")`：

| 标签 | UCI 字段 | 默认值 |
|---|---|---|
| `"Apple Touch Icon"` | `pwa_apple_touch` | `apple-touch-icon.png` |
| `"App Icon 192×192"` | `pwa_icon_192` | `app-icon-192x192.png` |
| `"App Icon 512×512"` | `pwa_icon_512` | `app-icon-512x512.png` |

**保存流程扩展：**

`handleSave` / `handleSaveApply` 在 UCI commit 后追加调用 `callWritePwaManifest()`，与 `prepareAuroraFonts` 同模式：

```js
const callWritePwaManifest = rpc.declare({
  object: "luci.aurora",
  method: "write_pwa_manifest",
});
```

---

## 不在范围内

- PWA metadata（`name`、`theme_color` 等）的 UCI 化
- favicon-16x16 / favicon-32x32 的模板引用（直接删除，不新增引用）
- 多文件批量上传
- 图标预览缩略图（PWA 选项使用标准下拉，与 login bg 一致）
