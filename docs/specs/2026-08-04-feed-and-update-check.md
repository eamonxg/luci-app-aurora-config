# 更新源接入与新版检测

日期：2026-08-04
状态：已定稿（用户逐项确认）
影响范围：`htdocs/luci-static/resources/view/aurora/theme.js`、`root/usr/libexec/rpcd/luci.aurora`、`root/usr/share/aurora/feed/`、`Makefile`、`po/`
外部依赖：`eamonxg/openwrt-cloud` 的 `feed/site/_headers`（给 `/manifest.json` 加 CORS 并部署）
关联：`docs/specs/2026-08-04-settings-restore-and-flatten.md`（同期，头部布局的另一半）

## 背景

设置页头部有版本徽标，但只是两个静态数字——用户既不知道自己是不是最新，也没有升级去路。而 `5d04f40` 的提交标题正是 *remove in-app version management*：页内升级已经被砍过一次，不该重来。

同时，升级的前提是机器上加了 feed 源，而**不是所有用户都加过**。README 的安装路径是 `wget -qO- https://openwrt.eamonxg.fun/install.sh | sh`，从 GitHub Release 直接装 ipk/apk 的用户就没有源。

用户定的方向：页面帮用户把源加上，加完之后升级完全交给 OpenWrt 自带的软件包页；页面只负责"告诉你有新版"。

## 决策

| 决策 | 结论 |
|---|---|
| 升级动作 | **页内不做**。写源 + 刷新索引到此为止，升级永远是软件包页的事 |
| 加源实现 | 照搬 `openwrt-cloud/feed/site/install.sh` 的第 1–3 步（探测包管理器 → 导入密钥 + 写源 → `update`） |
| 签名公钥 | **随本插件发布**，不从网上拉。信任锚定在用户已装的这个包，路由器零出网 |
| 渠道 | **添加**时固定用站点默认渠道 `snapshots`，界面不给选（要换渠道的人本来就会用命令行）；**比对**时读机器上实际配置的渠道——用 `CHANNEL=releases install.sh` 加过源的用户，要拿 releases 的版本跟他比 |
| 渠道文案 | 不出现"稳定版""推荐"。feed 站点自己标注了 *tags promise tags, not fewer bugs* |
| 版本检测 | 浏览器直连 `manifest.json`，**路由器完全不参与** |
| 新增 rpcd 往返 | 进页面 0 次（字段并进现有 `get_init_data`）；只有用户按下"添加"才调 1 次 `add_feed` |
| 软件包页链接 | 从 `ui.menu.load()` 的真实菜单树里找节点，不硬编码路径 |
| 通知条关闭态 | 存 localStorage，不写 uci（写 uci 会凭空产生一条待保存变更） |

## 请求预算

这是本设计的硬约束——低性能路由器上，后端通信是最贵的一环。

**进页面**

| 请求 | 次数 | 说明 |
|---|---|---|
| `uci.load("aurora")` | 1 | LuCI 标准，已有 |
| `get_init_data` | 1 | 已有。**只扩字段不加次数** |
| 新增 rpcd | 0 | — |
| `manifest.json` | 0 或 1 | 浏览器 → CDN，不经路由器。仅在"源已配置"时发；sessionStorage 缓存，切 tab 不重发 |

**用户按下"添加更新源"**

| 请求 | 次数 |
|---|---|
| `add_feed` | 1 |

路由器出网只剩 `apk/opkg update` 那一次，且由用户主动触发。版本比对逻辑（解析 `rYYYYMMDD`、按渠道取数、判断是否变琥珀）全在 JS，rpcd 不参与。

## 规格

### 1. 包内携带的 feed 资产

新增目录 `root/usr/share/aurora/feed/`：

| 文件 | 用途 |
|---|---|
| `eamonxg.pub` | usign 公钥（opkg），源自 `openwrt-cloud/feed/keys/eamonxg.pub` |
| `eamonxg.pem` | EC prime256v1 公钥（apk），源自 `openwrt-cloud/feed/keys/eamonxg.pem` |

**Makefile 不需要改动**：本包走 `luci.mk`，`root/` 目录整树自动打包——现有的 `root/usr/share/aurora/*.template`、`font-presets.conf` 都没有显式安装规则，新增子目录同理。

HOST（`openwrt.eamonxg.fun`）、usign 指纹、默认渠道（`snapshots`）作为常量写在 rpcd 脚本里。

**指纹已确定**：`82d72f5ededb6163`。opkg 的公钥文件名必须等于 keynum——base64 解码后第 3–10 字节的十六进制。此值由 `openwrt-cloud/feed/scripts/usign-fpr.sh keys/eamonxg.pub` 实算得出，不要求设备上有 `usign -F`。公钥若轮换，此常量必须同步更新。

### 2. rpcd 改动（`root/usr/libexec/rpcd/luci.aurora`）

**a. `detect_package_manager`（:231）改按数据库文件判断**

```sh
[ -f /lib/apk/db/installed ] && echo apk && return
[ -f /usr/lib/opkg/status ] && echo opkg && return
echo unknown
```

现状用 `command -v opkg` 探测。用户实测确认自己的 snapshot 机器上两个二进制并不并存，因此**这不是在修一个正在发作的症状**；改的理由是让 rpcd 和 `install.sh` 对同一台机器给出同一个答案——`install.sh` 已经按数据库文件判断，两边口径一致，加源路径和版本显示路径才不会打架。

**b. `parse_installed_packages` 的 apk 分支去掉进程创建**

opkg 分支已经是直接 awk `/usr/lib/opkg/status`；apk 分支跑的是 `apk list -I`，每次进页面 spawn 一次 apk 解析整个已装数据库，是这次调用里最贵的一步。改为 awk 直读 `/lib/apk/db/installed` 的 `P:` / `V:` 记录。

**待实机验证**：该文件的记录格式，在 snapshot 机器上确认后再定稿，不凭记忆写死。

**c. `get_init_data` 扩字段（不新增方法）**

返回体追加：

```json
"feed": { "pm": "apk|opkg|unknown", "configured": true, "channel": "snapshots" }
```

`configured` 的判定：apk 看 `/etc/apk/repositories.d/customfeeds.list` 是否含 `https://<HOST>/`；opkg 看 `/etc/opkg/customfeeds.conf` 是否含 `src/gz eamonxg `。`channel` 从命中的那行里解析。

**d. 新增 `add_feed`（唯一新增方法）**

参数：无（渠道固定 `snapshots`）。步骤严格对齐 `install.sh`：

1. 探测包管理器；`unknown` 直接返回错误
2. apk：`mkdir -p /etc/apk/keys /etc/apk/repositories.d`；拷贝 `eamonxg.pem` 到 `/etc/apk/keys/`；用固定串 `https://<HOST>/` 删掉自己的旧行；追加 `https://<HOST>/snapshots/apk/packages.adb`
3. opkg：`mkdir -p /etc/opkg/keys`；拷贝 `eamonxg.pub` 到 `/etc/opkg/keys/<指纹>`；用固定串 `src/gz eamonxg ` 删掉自己的旧行；追加 `src/gz eamonxg https://<HOST>/snapshots/opkg`
4. 执行一次 `apk update` / `opkg update`

**先删自己的行再追加**，保证重复执行与换渠道都干净，且不碰其他 feed 的行。

返回 `{ result, error, index_refreshed }`——写源成功但 `update` 失败要能分辨，这是两种不同的收场（见 §3）。

ACL：沿用既有的 `luci-app-aurora`。

### 3. 前端交互（`theme.js`）

**a. 通知条**（tabmenu 之下、设置卡片之上，样式对齐 LuCI 自带的「未设置密码!」横幅）

出现条件：`feed.pm !== "unknown"` 且 `feed.configured === false` 且 localStorage 未标记关闭。

```
升级 Aurora 需要先添加更新源，之后就能在「系统 → 软件包」里升级。   [添加更新源]  ×
```

一行字 + 一个主按钮 + 一个 ×。× 写 localStorage，此后不再出现；入口降级为版本区旁一条低调的「添加更新源」文字链，随时可回头。

**b. 确认框**（三句话，无渠道选择）

```
添加 Aurora 更新源

之后就能在「系统 → 软件包」里升级 Aurora，和升级其他 OpenWrt 软件一样。
来自 openwrt.eamonxg.fun，签名公钥随本插件发布。

                                              [取消]  [添加]
```

不列文件路径——那是机制。

**c. 执行与收场**

| 状态 | 呈现 |
|---|---|
| 进行中 | 通知条转灰，一行「正在添加更新源…」。无日志回显 |
| 成功 | 转绿「更新源已添加」+ 「去软件包页面 →」，数秒后自动收起 |
| 源已写入但索引刷新失败 | 「更新源已写入，但索引刷新失败——稍后在软件包页点一次刷新列表即可」+ [重试] |
| 缺少 HTTPS 支持 | 「本机还不能访问 HTTPS，先安装 `libustream-ssl-mbedtls` 与 `ca-bundle` 再试」。判断来自 `install.sh` 里的同款分支——OpenWrt 默认的 uclient-fetch 没有 TLS 就用不了 |

**d. 版本检测**

仅当 `feed.configured === true` 才发起。浏览器 `fetch('https://openwrt.eamonxg.fun/manifest.json')`，取 `feed.channel` 对应渠道下 `luci-theme-aurora` 与 `luci-app-aurora-config` 的版本，与已装版本比对。

判定规则：**只有两边都能解析出 `rYYYYMMDD` 戳时才判定"有新版本"**。`install.sh` 写明 opkg 与 apk 的版本方案不可比较、脚本从不排序；本设计沿用该纪律。解析不出就不显示任何更新信息。

结果缓存进 sessionStorage，切 tab、来回切子 tab 都不重发。拉取失败（离线、CORS 未部署、feed 不可达）一律静默降级——不弹错误、不留提示，那行字直接不出现。

**e. 版本区呈现**（只有两种样子）

```
无新版：  主题 [v1.1.13]  配置 [v1.1.3]
有新版：  主题 [v1.1.13]  配置 [v1.1.3]  [有新版 v1.1.4 →]
```

无新版时不显示"已是最新"之类的字——没消息就是好消息。琥珀胶囊是全页唯一的颜色变化。

`feed.pm === "unknown"`（手动装的包、认不出包管理器）时：通知条不出、检测不发、胶囊不显示，只剩两个徽标。

**f. 软件包页链接**

不硬编码路径。主题支持 23.05 及以后，各版本的软件包页地址不一致。做法：从 `ui.menu.load()` 取 `admin/system` 的子节点，挑名字落在 `opkg` / `package-manager` / `packages` 中的第一个，用它自身的路径拼 URL；一个都没有就不渲染链接，琥珀胶囊退化成纯文字。

Aurora 主题的 `header.ut` 把 `#topmenu` 留空、由 LuCI 客户端 JS 填充，说明 `ui.menu.load()` 在这一页本来就跑过，命中缓存、零额外请求。

这一并解决三件事：版本差异（从真实菜单读，不靠记忆）、ACL（`menu.load()` 只返回当前用户有权访问的节点，没权限就没链接而不是点进去吃 403）、精简固件（不带软件包管理界面的镜像自动不渲染）。

**待实机验证**：候选名字表，在 23.05 与 snapshot 两台机器上实测确认后定稿。

### 4. feed 侧（`eamonxg/openwrt-cloud`）

`feed/site/_headers` 目前没有给 `/manifest.json` 配 CORS，浏览器直连会被拦。需要追加：

```
/manifest.json
  Access-Control-Allow-Origin: *
```

与之前给 themes hub 加 CORS 是同一件事、同一套路。**未部署前前端静默降级**（正是 §3d 的失败路径），因此两边可以独立发布，不构成阻塞。

### 5. i18n

新增字符串：通知条一句、确认框三句、四种收场文案、「有新版 %s」、「去软件包页面」、「添加更新源」。改完重生成 pot 并翻译 14 个语言。

## 验收

1. 未加源的机器进设置页：出现通知条；DevTools 网络面板里**没有** `manifest.json` 请求
2. 点添加 → 确认 → 成功后通知条转绿；`/etc/apk/repositories.d/customfeeds.list`（或 opkg 对应文件）多出且仅多出一行；重复点一次不产生第二行
3. 加源后 `apk update` / `opkg update` 能正常拉到索引，`apk list | grep aurora` 能看到 feed 里的包
4. 已加源的机器进设置页：`manifest.json` 恰好请求一次；来回切 tab 不再请求
5. 构造一个已装版本旧于 manifest 的场景，琥珀胶囊出现且链接落到本机真实的软件包页
6. 断网进页面：无报错、无提示，只剩两个版本徽标
7. 进页面的 rpcd 调用次数与改动前一致

## 遗留的实机验证项

| 项 | 在哪验 |
|---|---|
| `/lib/apk/db/installed` 的记录格式 | snapshot 机器 |
| 软件包页菜单节点名 | 23.05 与 snapshot 各一台 |

usign 指纹已在本地实算确定为 `82d72f5ededb6163`，无需上机验证。
