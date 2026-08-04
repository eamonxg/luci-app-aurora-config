# 创作者身份：署名、备份与恢复

2026-08-04

## 背景

主题商店的分享链路已经完整（发布、更新、删除、我的分享），但**身份**这一层是空的。
现状是三件本地文件加一次性的自由文本：

| 东西 | 位置 | 作用 |
| --- | --- | --- |
| `device.key` | `/etc/aurora/device.key`（0600，64 hex） | 唯一凭证。hub 只存 `sha256(key)` 对应 `devices` 表一行，改/删作品全靠它 |
| `device.hash` | `/etc/aurora/device.hash` | 匿名，只做下载去重，无权限 |
| `hub_shares` | `/etc/aurora/hub_shares` | 纯本地的 id 清单，"我的分享"完全靠它列出来 |
| `author` | `configs.author` 列 | 发布时自由填的文本，存在每一条作品上 |

由此来的四个问题：

1. **署名不可信。** 昵称是发布参数（`gallery.js:1706` 的输入框 → `hub_share` →
   `configs.author`），任何人都能填 `Eamon` 发布，同一台设备也能每次填不同名字。
   "怎么知道是你分享的"目前没有答案。
2. **刷机不保配置 → 身份彻底消失。** `device.key` 和 `hub_shares` 都在 `/etc/aurora/`
   下，全新刷机后两者皆无。作品还挂在商店里，但原作者永远改不了、删不掉，也认不出
   是自己的 —— hub 端没有账号概念，救不回来。
3. **就算保留配置升级也已经半残。** `root/etc/sysupgrade.conf.d/aurora-device:1-2` 只
   保了 `device.key`/`device.hash`，**没保 `hub_shares`**：权限还在，但"我的分享"会空掉。
4. **UI 零提示。** 从发布面板（`gallery.js:1767`）到"我的分享"整条链路，没有一句话告诉
   用户身份是设备本地的、刷机会丢。

## 范围

**做：**

- hub（`openwrt-cloud/hub`）：`devices` 表认领为创作者档案，新增 `POST /api/v1/me`，
  发布/更新接口停收 `author`，列表/详情的 `author` 改由 JOIN 产出。
- rpcd（`root/usr/libexec/rpcd/luci.aurora`）：新增档案读取、昵称设置、密钥导出/导入；
  `hub_my_shares` 并入档案接口。
- 前端（`gallery.js`、`utils/hub-api.js`）：署名从发布参数改为账号属性；备份/导入交互；
  三处提示。
- ACL（`root/usr/share/rpcd/acl.d/luci-app-aurora.json`）：新方法按读写归位。

**不做：**

- **任何存量兼容逻辑。** `configs.author` 列连同它的读写路径一并删除，线上存量按可弃处理。
- 注册流程、邮箱、密码找回、头像、简介、创作者主页。
- 改名的 tombstone（旧名保留不释放）。
- 签名验证 / 端到端加密。

## 设计

### 1. 身份模型：`devices` 就是创作者

参照 GitHub / npm / Telegram 的骨架 —— **内部不可变 ID 做外键，用户可改的唯一 handle
做展示**。hub 已经有前一半（`devices.id` + `configs.device_id` 外键），缺的只是后一半。
所以不新建 `creators` 表，只给 `devices` 加两列：

```sql
-- migrations/0002_creator_identity.sql
ALTER TABLE devices ADD COLUMN nickname    TEXT;  -- 展示用，存原样大小写
ALTER TABLE devices ADD COLUMN nickname_lc TEXT;  -- 归一化，判重用
CREATE UNIQUE INDEX idx_devices_nick
  ON devices(nickname_lc) WHERE nickname_lc IS NOT NULL;

ALTER TABLE configs DROP COLUMN author;           -- 署名不再是作品属性
```

两条不能省的规则：

- **外键指内部 ID，不指昵称。** 署名靠 JOIN 产出，改名一次全站生效；别人抢注旧名也顶替
  不了任何历史作品 —— 这一条同时消灭了"改名要不要保留旧名"的难题，所以改名后旧名直接
  释放，不做 tombstone。
- **唯一性按 `nickname_lc` 判定**，展示存原样。否则 `Eamon` 和 `eamon` 会是两个人。

昵称规则：全网唯一，可随时改名，1–40 字符（沿用现有 `author` 的长度上限）。归一化链路
必须是 **`cleanText()` → `trim()` → `toLowerCase()`**：现有的 `cleanText`
（`src/validate.js:112`）只去控制字符并做 NFC，**不 trim** —— 少这一步的话 `"Eamon "`
会绕过唯一索引，变成第二个 Eamon。存 `nickname` 时也存 trim 后的原样大小写。
未设昵称的账号照常能发布，展示为 `Anonymous`。

**短号**：直接用现成的 `devices.id`（`shortId()` 已在生成），不新增字段。卡片上**不印**
—— 昵称已唯一，印号是噪音；短号只在详情抽屉和"我的账号"里露出，供自证和消歧
（防 `Eam0n` 一类的相似字符钓鱼）。

**内置种子**：`gallery.js:139` 靠 `author === "Aurora"` 判定官方种子。新模型下发布种子的
账号必须占住 `Aurora` 这个昵称 —— 唯一性反而让这个判定第一次变得可信。

### 2. hub API

只加一个端点。进商店要的就是档案 + 我的作品，一次拿完：

```
POST /api/v1/me   body: {device_token, nickname?}
  → 200 {id:"a3f9", nickname:"Eamon"|null, configs:[…]}

  → 200 {id, nickname, configs:[], error:"nickname_taken"}     昵称被占
  → 200 {id, nickname, configs:[], error:"invalid_nickname"}   长度/控制字符不合法

  不带 nickname = 读档案 + 拉名下作品（刷机后恢复靠它）
  带   nickname = 设置或改名
```

**冲突为什么不是 409。** 这个端点唯一的调用方是路由器上的 rpcd，它经
`wget`/`uclient-fetch` 出网（`luci.aurora:336-345`）：那两个工具对任何 4xx 都是退出码
非零 + 输出为空，`hub_http_post` 只能返回 1。到了 LuCI 页面上，"这个名字已被占用"和
"hub 连不上"就成了同一件事 —— 而前者恰恰是署名功能最核心的那句反馈。所以认证通过、
JSON 合法的请求一律回 200，冲突写进 body。`device_token` 本身格式不对仍然是 400
（那是 bug，不是用户看得懂的结果）。

- 认证沿用 `deviceFromToken`。读档案用 `{register:false}`：只读不建，密钥未知时返回
  `id:null, nickname:null, configs:[]`，不算失败。带 `nickname` 时才 `{register:true}`。
- `configs[]` 复用列表接口的行形状，只是不过滤 `status`，让作者看得见自己被下架的东西。
- `POST /configs` 与 `PUT /configs/:id` **不再接受 `author`**，`validateMeta` 去掉该字段。
- 列表（`src/configs.js:174`）与详情（同文件 `:228`）的 SELECT 加
  `LEFT JOIN devices ON configs.device_id = devices.id`，返回 `author: devices.nickname ?? ""`
  并新增 `author_id: devices.id`。**响应字段名不变**，所以前端卡片渲染
  （`gallery.js:1405`、`:698`）几乎不用动。

### 3. rpcd

| 方法 | ACL | 作用 |
| --- | --- | --- |
| `hub_me` | read | 转发 `POST /api/v1/me`（不带 nickname），返回档案 + 作品列表 |
| `hub_set_nickname` | write | 转发 `POST /api/v1/me`（带 nickname） |
| `hub_export_key` | **write** | 返回 `device.key` 的 64 hex |
| `hub_import_key` | write | 校验 `/^[a-f0-9]{64}$/` 后写入 `device.key`（0600） |
| ~~`hub_my_shares`~~ | — | 删除，功能并入 `hub_me` |

`hub_export_key` 挂 write 而不是 read：泄露这串字符等同于把账号控制权交出去，读权限的
用户不该拿得到。

`hub_share` / `hub_update` 的 `author` 参数一并删除（`luci.aurora:2359-2530`，
`hub-api.js:118-133`）。发布时若账号还没有昵称，客户端先调 `hub_set_nickname`，成功后
再 `hub_share` —— 两步调用，但署名始终不是发布参数。

`/etc/aurora/hub_shares` 降级为无关紧要的本地记录，`hub_me` 不读它。由此
`luci.aurora:2427-2462` 那段"逐个 id 串行打 N 次 `hub_http_get`"连同解释"绝不能重写这个
文件"的整段注释一并删除 —— 每次打开商店 N 次串行 HTTP 变成一次请求。
`sysupgrade.conf.d/aurora-device` 漏掉 `hub_shares` 的缺陷也随之消失，该文件保持不变。

### 4. 前端交互

**署名字段收缩。** 发布面板（`gallery.js:1767`）的 `Nickname` 输入框只在账号**没有昵称**
时出现；已有昵称时改为一行"以 Eamon · #a3f9 的身份发布" + 一个改名入口。
`HUB_NICK_KEY`（`gallery.js:31`）这个 localStorage 键删除 —— 昵称的权威在 hub。

**备份物就是一个字符串。** 作品清单从 hub 查得到，所以备份物只剩那 64 个字符，不打包
JSON，也就不存在"备份之后新发的作品不在文件里"的时效问题。

- 导出：下载 `aurora-creator-key.txt`，内容是一行 64 hex；旁边一个"显示密钥"（默认遮蔽，
  点击才显形）和"复制"。
- 导入：**只有一个文本框**。粘贴直接用，"选文件"按钮只是把文件内容读出来填进框里 ——
  一条解析路径，不写两套。校验规则与 hub 的 `TOKEN_PATTERN` 同为 `/^[a-f0-9]{64}$/`。

**导入的冲突处理。** 覆盖 key = 永久失去旧账号。导入前先用**当前** key 调一次 `hub_me`：

- 名下没作品 → 直接覆盖，不啰嗦。
- 名下有作品 → 二次确认，把话说死："当前账号 Eamon 名下的 3 件作品将永久失去控制权"，
  并把备份按钮放进确认框里。

导入后立即拉档案，UI 直接给结果："已恢复为 Eamon · #a3f9，找回 3 件作品"；密钥名下暂无
作品也不算失败，照常切换身份。

**三处提示，都不是弹窗：**

| 位置 | 时机 | 内容 |
| --- | --- | --- |
| 发布成功通知（`gallery.js:1743`） | 首次发布成功 | 从"已发布"改成带一句"你的创作者账号只存在这台路由器上" + 备份按钮。这是唯一时机对的时刻 —— 用户刚有了值得丢的东西 |
| "我的分享"顶部 | 常驻，未备份时 | 一条细提示：账号 `Eamon · #a3f9`，刷机会丢 → \[备份密钥\]\[导入密钥\]。备份过之后收成一行淡文字 |
| "我的分享"空态（`gallery.js:1558`） | 刷机后打开 | 现有文案扩展为"…或者**导入创作者密钥**找回以前的作品" |

"是否备份过"存 uci `aurora.theme.hub_key_saved`，不用 localStorage：它天然跟着"保留
配置"走，换浏览器不会误报，刷机不保配置时归零 —— 正好该重新提示。放在 `theme` section
下是因为 `hub_applied` 已经在那里（`gallery.js:1004`），新开一个 section 得先建它。

### 5. 安全

- `device.key` 现在是账号密码：拿到它的人能用你的名义发布、能删你所有作品。导出方法挂
  write ACL，UI 默认遮蔽，文案直说后果，不用"请妥善保管"这种没有信息量的话。
- `hub_import_key` 只接受 64 hex，写入前 `chmod 600`，不接受路径参数（不给任意文件读写
  留口子）。
- 昵称是不可信输入，展示一律走 `document.createTextNode`，与 `gallery.js` 现有约定一致
  （见文件头 16-26 行的注释）。

## 发布顺序

两个仓库，hub 必须先行：

1. `openwrt-cloud/hub`：迁移 + `/api/v1/me` + 停收 `author` + JOIN 出署名，测试通过后部署。
2. `luci-app-aurora-config`：rpcd 方法、ACL、前端交互、po 翻译，真机验证。

中间态：hub 部署后、路由器未升级前，旧客户端发布仍会带 `author` 字段。这不需要写任何代码
去容忍 —— `validateMeta`（`src/validate.js:309`）是挑字段而不是拒未知键，删掉 author 那三
行之后多余字段会被直接忽略，发布照常成功，署名显示为该账号的昵称（未设则 `Anonymous`）。

## 验收清单

- [ ] 新设备首次发布：面板要求填创作者名；重名时报"这个名字已被占用"，不重名则发布成功。
- [ ] 同一账号发第二件作品：面板不再要求填名，显示"以 X · #id 的身份发布"。
- [ ] 另一台设备填同一个昵称发布 → 被拒。
- [ ] 改名后，商店里该账号**所有**历史作品的署名同步变化。
- [ ] 详情抽屉显示 `昵称 · #短号`；卡片只显示昵称。
- [ ] 备份：下载的 `aurora-creator-key.txt` 内容与 `/etc/aurora/device.key` 逐字节一致。
- [ ] 恢复：`rm -rf /etc/aurora` 后重启 rpcd，"我的分享"为空且空态给出导入入口；导入备份
      的密钥后，作品列表与昵称完整回来，且能成功更新/删除其中一件。
- [ ] 冲突：名下有作品时导入他人密钥，弹出二次确认且确认框内可先备份当前密钥。
- [ ] 导入一个从未发布过的合法密钥：不报错，正常切换身份。
- [ ] 导入非法字符串：拒绝，`/etc/aurora/device.key` 未被改动。
- [ ] `hub_export_key` 在只读 ACL 的用户下不可调用。
- [ ] 打开商店只发一次 `hub_me` 请求（不再按 id 串行 N 次）。
- [ ] 真机（192.168.8.1）验证以上全部，中文界面无遗漏 msgid。
