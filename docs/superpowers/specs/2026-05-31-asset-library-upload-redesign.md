# Asset Library 上传体验重新设计

**日期：** 2026-05-31  
**文件：** `htdocs/luci-static/resources/view/aurora/theme.js`

---

## 背景与问题

当前 Asset Library 上传流程存在两个主要问题：

1. **上传步骤过多**：用户需要经过"选类型弹窗 → 文件选择器 → 上传"三步，其中"选类型"弹窗（Logo/Icon vs 登录背景）是多余的摩擦点。
2. **视觉脱节**：上传按钮（`form.Button`）和资产表格（`form.DummyValue`）是两个独立的 LuCI form option，渲染为互不关联的两行，视觉上不协调。

---

## 设计目标

- 零弹窗完成上传（拖放或点击直接上传）
- 上传区与文件表格视觉统一，合为一个组件
- 表格列：**Preview · Filename · Actions**（去掉 Usage 列）
- 上传进度可见（进度条）
- 上传完成后表格即时插行，随即刷页面（确保 Site Branding 下拉框感知新文件）
- 最大化使用 LuCI JS 原生 API（`E()`、`ui.createHandlerFn`、`ui.showModal`、`L.resolveDefault`）

---

## 最终设计

### 组件结构

将原来的两个 option 合并为一个 `form.DummyValue`：

```
assetSubsection
  └─ form.DummyValue "_asset_library"
       render() 输出：
         ┌─────────────────────────────────┐
         │  拖放区（dragover/drop/click）    │
         │  ─────────────────────────────  │
         │  进度条（XHR upload.onprogress） │
         │  ─────────────────────────────  │
         │  表格：Preview | Filename | Act  │
         └─────────────────────────────────┘
```

删除原有的 `uploadSo`（`form.Button` + `"_upload_asset"`）。

### 拖放区

- 用 `E("div", { dragover, dragleave, drop, click })` 构建
- `click` 触发隐藏的 `E("input", { type:"file", accept:"image/*,.svg" })`
- `drop` 事件取 `event.dataTransfer.files[0]`
- 两者统一进入同一个 `uploadFile(file)` 函数

### 上传函数 `uploadFile(file)`

1. 用 `XMLHttpRequest` POST 到 `/cgi-bin/cgi-upload`（需要 XHR 以支持 `upload.onprogress`）
2. 进度条实时更新（`upload.onprogress`）
3. 上传完成后调用 `L.resolveDefault(callUploadIcon(file.name), {})`
4. 成功：
   - 文件名以 `login-bg.` 开头 → `localStorage.setItem("aurora.pending_bg", file.name)`
   - 在表格末尾即时插入新行（Preview + Filename + Delete 按钮）
   - 随后执行 `window.location.reload()`（**必须刷新**：页面下方 Site Branding 的 `logo_svg` / `struct_login_bg` 下拉框在初始化时加载文件列表，不刷新无法感知新文件）
5. 失败：`ui.addNotification` 显示错误，不刷页面

### 表格列

| 列 | 宽度 | 内容 |
|---|---|---|
| Preview | 56px | `E("img", { src:"/luci-static/aurora/images/"+filename, style:"width:40px;height:40px;object-fit:contain" })`，`onerror` fallback 为灰色占位 `<div>` |
| Filename | 自适应 | `E("td", { style:"font-family:monospace" }, filename)` |
| Actions | 80px | Delete 按钮，点击触发 `ui.showModal` 确认后调用 `callRemoveIcon`，成功后移除对应 `<tr>` |

空状态（无文件）：保留原有 `E("em", {}, _("No assets uploaded yet."))` 提示。

### 类型推断（替代原弹窗）

不再弹窗让用户手动选类型。上传成功后：
- 文件名匹配 `/^login-bg\./i` → 设置 `localStorage("aurora.pending_bg", filename)`
- 其余文件不做额外处理

`getAssetType()` 函数保留（供其他地方使用），但不在表格中展示。

### Delete 交互

与现有实现保持一致：
- `ui.createHandlerFn` + `ui.showModal` 确认弹窗
- 确认后 `callRemoveIcon(filename)` → 成功则执行 `window.location.reload()`（与原有行为一致，确保 Site Branding 下拉框移除已删文件的选项）

---

## 不在范围内

- 多文件同时上传
- 上传后自动预览登录背景效果
- 文件重命名
- 排序 / 过滤

---

## 受影响的代码范围

仅修改 `theme.js` 中 `assetSection` 相关代码（约 lines 1224–1404）：

- **删除** `uploadSo`（`form.Button`，约 lines 1236–1320）
- **重写** `assetTableSo`（`form.DummyValue`，约 lines 1322–1404）为合并后的拖放+表格组件
- RPC 声明（`callUploadIcon`、`callListIcons`、`callRemoveIcon`）和辅助函数（`isImageFile`、`getAssetType`）不变
