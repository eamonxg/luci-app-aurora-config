# 让分享的配置带上自定义字体

## 背景

主题商店分享的配置，若使用了本机上传的自定义字体，接收方应用后字体不生效。

真机复现（JDCloud RE-CS-02，2026-08-06）：

```
uci struct_font_sans = "OPPO Sans Regular", "Lato", ui-sans-serif, system-ui, sans-serif
本机 custom 字体只有 = Inter (sans-inter.meta)
aurora-font.css      = 只有 Lato + Inter 两个 @font-face，无 OPPO Sans Regular
```

根因：分享端把引用了自定义字体的 CSS font-stack 原样发出，但**字体文件本身从不上传**
（`luci.aurora:818` 注释 "v1 never ships font assets"）。接收端写入这个 stack，
字体族在本机不存在，浏览器静默回退到 stack 末尾的 Lato。

云端其实早已为字体建好整条通道，缺口只在路由器两端：

| 环节 | 状态 | 位置 |
|---|---|---|
| schema 白名单 + 8 MiB 限额 | 已就位 | `validate.js:19,22-30` |
| magic byte `isWoff2` | 已就位 | `assets.js:72-73` |
| Content-Type `font/woff2` | 已就位 | `assets.js:82-83` |
| 上传票据通道（kind-agnostic） | 已就位 | `drafts.js:153-204` |
| 审核 body 25 MB（为 8 MB 字体预留） | 已就位 | `admin.js:12-16` |
| 审核台 woff2 passthrough | 已就位 | `admin/index.html:907-909` |
| **分享端列出字体资产** | **缺** | `luci.aurora:935` 循环只有 6 种图片 |
| **接收端落地字体资产** | **缺** | `luci.aurora:663` 只认 5 种图片 kind |
| 网页详情页展示字体 | 缺（纯展示） | `site/config.html:377` |

## 决策（已确认）

1. 字体随配置分享，走已有的 asset 通道
2. 尺寸上限**维持 8 MiB 不变**。曾短暂改到 16 MiB 又改回：R2 免费额度 10 GB，
   8 MiB 一份约能放 1280 份配置，翻倍不值得。连带把当时拆出来的
   `MAX_FONT_UPLOAD` 也收掉了——和 `MAX_UPLOAD` 值相同就只是个空壳抽象。
   云端因此零功能改动，只留一句注释记下 `ADMIN_APPROVE_BODY_BYTES`（25 MB）
   才是字体上限的真实天花板
3. 加版权说明（分享时**和**详情抽屉，两处方向相反）与存储说明（详情抽屉）

## 关键杠杆点

接收端只要把下载到的 woff2 按 `upload_font` 的形状摆好——
`$FONT_CUSTOM_PATH/` 下 `.woff2` + `.meta`(`family|stack`) + `.face` 三件套
（`luci.aurora:2382-2399`）——下游渲染链路**一行都不用改**：

- `write_combined_font_css:1438` 的 custom 扫描自动收录
- `write_font_preload:1488` 的 stack 匹配自动命中
- `migrate_font_cache:1778` 的 custom 保留判断自动放行（不会被误删）

## 任务清单

### A. 尺寸上限 —— 最终不改
- [x] A1–A4 全部回退到 8 MiB（见「决策」第 2 条）。唯一留下的是 `admin.js`
      的一句注释。附带收获：过程中确认了路由器端 `MAX_UPLOAD` 是图片和字体
      共用的，将来真要给字体单独放宽，必须拆常量而不是直接改它 —— 否则图片
      也会跟着放宽，然后在 hub 的 2 MiB 那关被拒

### B. 分享端（luci.aurora）
- [x] B1 assets 循环加 font_sans/font_mono
- [x] B2 `.files` 第二列改为相对 `/luci-static/aurora/` 的路径，
      `hub_share_begin` 去掉写死的 `images/` 前缀
- [x] B3 只分享 custom 字体，名册预设不上传
- [x] B4（计划外）抽出 `shared_custom_font_base()`：发布面板的清单和真正的
      打包本来会各判一次「哪份字体会被发出去」，两处迟早漂移成「清单里写着、
      实际没发」。现在两者问同一个函数

### C. 接收端（luci.aurora）
- [x] C1/C2/C3 新增 `apply_hub_font_asset()`，在 assets 循环里对 font kind
      单独分流。字体落成与 `upload_font` 完全同形的三件套 —— 杠杆点成立，
      `write_combined_font_css` / `write_font_preload` / `migrate_font_cache`
      一行未改就自动认它（真机 preload.txt 已验证）
- [x] C4 覆盖前备份，冲突即覆盖（family/stack 相同，视觉无差）
- [x] C5 新增 `restore_pre_hub_fonts()`：覆盖的复制回来，**新引入的直接删掉**
      （`.new` 标记）。少了后者，回滚会留下几 MB 别人的字体永远占着 overlay
- [x] C6（计划外）本地复验 woff2 magic：字节来自网络，不复验等于把校验外包给
      服务器

### D. 说明文案（含 14 语言 po）
- [x] D1 分享面板版权声明（仅在真的要发字体时出现）
- [x] D2 详情抽屉存储说明：体积 + 存放位置 + 升级不保留
- [x] D3 详情抽屉此前**根本没有**字体下载提示（那句只在内置预设抽屉里）。
      现在两句各判各的，已带文件的槽位不再算进「待下载」
- [x] D4 8 条字符串 × 14 语言全部翻译到位。另有 14 条**既有**未翻译条目
      属上一批 store 功能，不在本次范围
- [ ] D5 po2lmo 真机看翻译（未做）

### E. 展示层
- [x] E1 **无需改动**——`site/config.html:377` 的 `IMAGE_ASSET_KINDS` 是
      「能画预览图的 kind」而不是白名单，字体走 else 分支已按「只列名不预览」
      处理好了。原计划把它当缺口是看错了

## 已考证的事实（供文案写实）

- 字体落 `/www/luci-static/aurora/fonts/custom/`，属根文件系统 →
  写入实际落 **overlay 分区**，与 opkg 软件包、`/etc/config` 共用可写 flash
- 上传中转 `/tmp`（tmpfs，吃 RAM），传完即删，非持久占用
- 拉丁字体子集无压力（实测 Lato 23 KB、Inter 111 KB）；
  中文全字集 woff2 通常几 MB 到十几 MB，是真正的风险
- 8 MB flash 设备 overlay 常仅剩 1–3 MB，16 MB 的多在 5–10 MB（量级估计）
- overlay 写满 → 装不了包、uci 保存失败、sysupgrade 可能出问题
- `sysupgrade.conf.d/aurora-device` 只保留 device.key/hash，
  **字体升级后丢失**；但 `/etc/config/aurora` 默认保留，
  `migrate_font_cache:1774-1786` 会检测到并重置为默认，不留坏状态

## 验证

- [x] V1 真机（192.168.8.1）单机闭环，证据如下
- [x] V2 hub 单测 383 passed；本仓库 321 passed
- [x] V3 尺寸上限维持 8 MiB，原有边界单测未动
- [x] V4 回归：mono 槽位用的是名册预设，全程正确地**不**出现在
      `shared_fonts` 和 assets 里

### V1 真机证据

分享端 —— 把 sans 指向本机上传的 Inter：

```
hub_local_state → "shared_fonts": [{ "slot":"sans","family":"Inter","size":111268 }]
build_share_payload → assets 含 { "kind":"font_sans","sha256":"e06f6b1b…","size":111268 }
.files → login_bg  images/hub-login-bg-08c6284def5e.jpg
         font_sans fonts/custom/sans-inter.woff2
```

接收端 —— 删掉本机 Inter 三件套、uci 仍指着它（**bug 现场复现**：
`grep -c Inter aurora-font.css` = 0，页面回退 Lato），再跑新代码：

```
apply_hub_font_asset sans <sha> http://127.0.0.1/hubtest.woff2 → APPLY_OK
custom/ → sans-inter.woff2 (111268) + .meta + .face
.meta   → Inter|"Inter", "Lato", ui-sans-serif, system-ui, sans-serif
CSS     → @font-face font-family:"Inter" src:url(custom/sans-inter.woff2?v=…)
preload → /luci-static/aurora/fonts/custom/sans-inter.woff2?v=…
```

负路径 —— sha256 不匹配：`REJECTED_AS_EXPECTED`，目录全空（.hubtmp 也没留）。

测试后真机已恢复原状（`struct_font_sans` 还是那份坏掉的
"OPPO Sans Regular"，即用户报告的现场，刻意没动）。

## F. 审核台不再往返字体字节（计划外，但必须做）

`ADMIN_APPROVE_BODY_BYTES` 是 25 MB，而一份资产拉满的配置是
6×2 MiB（图片）+ 2×8 MiB（字体）= 28 MiB，base64 后约 **37 MB**。
也就是说「能分享但永远批不了」这个缺陷**当前就存在**，不需要谁去抬字体上限。

- [x] F1 `assets.js` 新增 `APPROVE_FROM_R2_KINDS = {font_sans, font_mono}`：
      sanitize 不改变字节的 kind 没理由被下载、base64、再原样传回来
- [x] F2 approve 对这些 kind 从 `pending/` 直接读，并照样重跑 magic + size
      检查（字节在存储里躺过，不复验就是把校验外包给桶）
- [x] F3 线格式改成各自声明：passthrough 的 kind **必须**用
      `{passthrough:true}` 且不带 `data_b64`，其余 kind **必须**带
      `data_b64`。任一方漂移就 400 —— 防的是「某个 kind 将来加了真正的
      sanitizer 却还留在集合里」，那会静默地批准没人清洗过的字节
- [x] F4 `favicon_ico` 刻意不加入：2 MiB 不构成体积问题，且它的 passthrough
      是被迫的（canvas 产不出 ICO）而非设计如此，是最可能长出真 sanitizer 的
- [x] F5 补 6 个测试。**这条路径此前零覆盖** —— 所以我改了线格式，383 个测试
      依然全绿。并做了变异验证：把服务端自己的判断换成「前端说了算」，必须有
      测试变红

## 验证补充

- [x] D5 po2lmo：从 luci 源码编出 po2lmo → 编 zh_Hans → 推真机 →
      用 LuCI 自己的 `i18n.translate` 逐条查，9 条新字符串全部解析出中文
      （注意语言代码是 `zh-cn`，不是 po 目录名 `zh_Hans`）
- [x] E2E：**本地起完整 hub**（`wrangler dev` + 本地 D1/R2），路由器
      `HUB_BASE` 临时指过去，跑完 分享→直传→审核→应用→回滚 全程，
      **完全没碰生产商店**

### E2E 全程记录

```
hub_share_begin  → assets 含 font_sans，src=/luci-static/aurora/fonts/custom/sans-inter.woff2
凭 ticket 直传   → login_bg 866522B / font_sans 111268B，均 HTTP 200
hub_share_commit → id=m399c8az
admin approve    → body 仅 103 字节（字体的 111KB 不在其中），HTTP 200
                   {"kind":"font_sans","passthrough":true}
GET /assets/…    → HTTP 200, 111268B, content-type: font/woff2
应用前           → 删光本机 custom/，CSS 中 Inter 出现 0 次
hub_apply        → custom/ 三件套重建，uci struct_font_sans 指向 Inter，
                   CSS 有 @font-face，preload.txt 命中，active_source=hub:m399c8az
回滚             → 备份目录里是 sans-inter.new（本次新引入）→ 三件套被删净，
                   CSS 中 Inter 归 0，别人的字体没有留下来占 overlay
```

## 尚未做

- 部署到生产：hub 的 approve 线格式变了，`src/` 和 `site/` 同属一次
  `wrangler deploy`，所以前后端会一起更新，不存在中间不一致的窗口
- 真正在公开商店发布一条（本地 hub 已覆盖同样的链路，价值主要在验证生产配置）

注意：测试机 overlay 挂在 tmpfs（RAM overlay），重启全丢，
且其 df 数字不代表普通设备——见 memory `router-ram-overlay`。
