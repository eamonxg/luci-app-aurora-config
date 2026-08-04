# 主题商店首屏去阻塞：load() 不再等跨太平洋往返

日期：2026-08-05
状态：待用户审阅
前置：Phase 1 浏览器直连（docs/plans/2026-08-04-phase1-hub-direct.md，已实现）
影响文件：`htdocs/luci-static/resources/view/aurora/gallery.js`、
`htdocs/luci-static/resources/utils/hub-api.js`、
`root/usr/libexec/rpcd/luci.aurora`（删 `hub_list`/`hub_get` 两个 handler 及其声明）、
`root/usr/share/rpcd/acl.d/luci-app-aurora.json`（删对应两条 read 权限）、
`tests/gallery-view.test.mjs`、`tests/hub-api-module.test.mjs`、
`tests/rpcd-hub.test.mjs`、`tests/hub-rpcd-removed.test.mjs`（新建）

## 1. 问题

主题商店页面打开慢。初始假设是「ubus 通讯太多」，实测推翻了这个归因。

### 1.1 实测数据（真机 192.168.8.1，qualcommax/ipq60xx，aarch64 Cortex-A53 + mbedtls）

| 测项 | 耗时 | 结论 |
|---|---|---|
| `ubus call luci.aurora get_font_presets`（纯本地） | 0.09 s ×5 | ubus + fork 2782 行 shell 的**全部**开销 |
| `ubus call luci.aurora hub_me`（全链路） | 0.84 / 0.85 / 0.90 / **5.07** / 0.92 s | |
| 路由器裸 `wget` → hub（10 次） | 0.74–0.82 s，标准差极小 | 路由器 CPU/TLS 库不是瓶颈 |
| 开发机 `curl` → hub，首次 | connect=0.008 **tls=0.546** ttfb=0.771 total=0.79 | 与路由器**一模一样** |
| 开发机 `curl` → hub，**复用连接** | **0.192 / 0.198 s** | 正好 1 个 RTT |
| `ping themes.eamonxg.fun` | **205 ms**（165–267） | |
| `cf-ray` 后缀 | `SJC`（San Jose） | 流量落美西 |
| `ping workers.dev` | 172 ms | 整个出口的 CF 路由都指向美西，非本 Worker 特有 |

三条推论，每条都和初始假设不同：

1. **ubus 不慢。** 90 ms，占 `hub_me` 全链路的 10%。
2. **路由器不慢。** 它的 wget 0.78 s 与开发机首次 curl 0.79 s 无差异。慢的不是设备。
3. **慢的是「每次都重做 TLS 握手」× 205 ms 的跨太平洋 RTT。**
   0.79 s = TCP 8 ms + TLS 握手 546 ms（≈2.5 RTT）+ 应用 1 RTT。
   复用连接后只要 192 ms。

`/api/v1/ping`（不碰数据库）与 `/api/v1/themes/aurora/configs`（查 D1）耗时完全一致，
说明 Worker 执行与 D1 查询均不构成可测成本。

### 1.2 根因：`load()` 在等网络，而缓存在 `render()` 里

`gallery.js:1035` 的 `load()`：

```js
load() {
  return Promise.all([
    L.resolveDefault(hubApi.callHubList("hot", 1), null),   // 浏览器直连  0.80s
    L.resolveDefault(hubApi.callHubMe(), null),             // ubus→wget→CF 0.94s
    L.resolveDefault(fetch(L.resource("aurora/presets.json"))...),  // 本地
    uci.load("aurora"),                                     // 本地
  ]).then(...)
}
```

而 `listCache` 那份 localStorage 缓存，直到 `gallery.js:2529` 才被读：

```js
render(loadData) {
  ...
  const cached = hubApi.listCache.getStale();   // ← 第 2529 行
  if (cached && ...) state.online.hot = cached.items;
```

LuCI 的 `load()` 不 resolve 就不进 `render()`。**缓存写了，但首屏根本吃不到** ——
每次打开页面都硬等一次跨太平洋往返，缓存只是在网络回来后又被覆盖一遍。

首屏耗时 = `Promise.all` 的最大值 = `hub_me` 的 0.94 s，尾部可达 5.07 s。

### 1.3 「把 hub_me 也搬到浏览器」为什么解决不了问题

这是最直觉的方案，但算一下收益：

```
现在:  Promise.all([ list(浏览器 0.80s) , me(路由器 0.94s) ])          = 0.94s
搬后:  Promise.all([ list(浏览器 0.80s) , me(浏览器 H2 复用 ~0.80s) ]) = 0.80s
```

**只快 0.14 秒。** 浏览器对同一 origin 用一条 HTTP/2 连接多路复用，两个请求本来就并行；
路由器那 0.94 s 也是并行掉的。而代价是必须把 `device_token`
（`/etc/aurora/device.key`，0600，`hub_share`/`hub_update`/`hub_delete` 的写凭证）
下发到浏览器。

**结论：本期不做。** 收益与信任模型代价严重不成比例。

## 2. 设计

既然每次网络往返必然 200 ms、首连必然 800 ms，客户端缓存就是唯一解，
且必须做到首屏完全不等网络。

一句话原则：**`load()` 里不许有任何跨太平洋的东西。**

```
现在:  load() ──等 Promise.all(list 0.80s, me 0.94s)──→ render()   首屏 0.94s（尾部 5s）
                                                          └ 第 2529 行才读缓存（已经晚了）

改后:  load() ──等 uci.load + presets.json (~90ms)──→ render()      首屏 ~0.1s
                                                       ├ 立刻用 listCache / meCache 画
                                                       ├ 挂 DOM
                                                       └ 异步 fetchSort("hot") + refreshMyShares()
                                                          回来再 reconcile
```

### 2.1 `gallery.js:1035` `load()` — 砍成两项

```js
load() {
  return Promise.all([
    L.resolveDefault(
      fetch(L.resource("aurora/presets.json")).then((res) => (res.ok ? res.json() : null)),
      null,
    ),
    uci.load("aurora"),
  ]).then(([presetsRes]) => ({
    presets: (presetsRes && presetsRes.presets) || null,
    hubApplied: uci.get("aurora", "theme", "hub_applied") || "",
    keySaved: uci.get("aurora", "theme", "hub_key_saved") === "1",
    activePreset: uci.get("aurora", "theme", "active_preset") || "default",
    navType: uci.get("aurora", "theme", "nav_type") || "mega-menu",
  }));
}
```

`listRes` / `meRes` 从 `loadData` 中消失，`render()` 不再从参数拿它们。

### 2.2 `gallery.js:2533-2546` render 收尾 — 先画后取

```js
renderBanner();
applyMe(hubApi.meCache.getStale());   // 缓存或 null（空态），不等网络
selectTab("all");
renderContent();                       // ← 取代 applyResult(loadData.listRes, "hot")

[styleEl, headEl, contentEl, drawerMask, drawerEl].forEach((child) =>
  rootEl.appendChild(child),
);

// 网络在 DOM 挂载之后才发起
fetchSort("hot");        // 已有函数（:2520），内部 applyResult → renderContent
refreshMyShares();       // 已有函数（:1506）

return rootEl;
```

`renderContent()` 在 append 之前调用是安全的：`contentEl` 早已创建，
现有代码的 `applyResult(loadData.listRes, "hot")` 同样在 append 之前触发 `renderContent`。

### 2.3 `hub-api.js` — 新增 `meCache`，并先厘清 `listCache` 的死面

写这一节时发现既有 `listCache`（`hub-api.js:38-78`）有一半是死的：

| 成员 | 调用点 | |
|---|---|---|
| `set` | `gallery.js:2502` | 活 |
| `getStale` | `gallery.js:2510`、`:2529` | 活 |
| `get` | **无** | 死 |
| `clear` | 仅 `get()` 内部（`hub-api.js:45`） | 随 `get` 一起死 |
| `CACHE_TTL`（5 min） | 仅 `get()` 内部（`hub-api.js:44`） | 随 `get` 一起死 |

**因此列表缓存实际上永不过期。** 这不是缺陷——`fetchSort("hot")` 每次渲染都会跑并覆盖，
缓存的职责只是「首帧的种子」，永久有效正是想要的语义。但它目前是个意外，不是决定。
本期把它变成决定：**缓存只作首帧种子，不设 TTL。**

于是 `meCache` 只有三个成员，不照抄死的那半：

- `set(value)` — 存 `{id, nickname, configs}`
- `getStale()` — 无条件返回，无 TTL 判断
- `clear()` — 供导入 key 路径调用（见 §3）

key 用 `aurora.hub.me`。localStorage 按 origin 隔离，origin 即路由器地址，
因此不同路由器天然互不串数据。

顺带删除 `listCache.get()` 与 `CACHE_TTL`（`hub-api.js:6, 39-52`）：
在同一个文件里新写一份没有 `get()` 的缓存、却留着另一份死的 `get()`，
是自相矛盾。`listCache.clear()` 保留——失去 `get()` 这个唯一调用方后它虽暂无调用点，
但与 `meCache.clear()` 对称，且是缓存的合理公开操作。

### 2.4 `gallery.js:1506` `refreshMyShares()` — 唯一的缓存写入点

所有写路径（发布 `:2091`、更新 `:1542`、删除 `:1574`、导入 key `:1791`、
改名 `:2073`/`:2157`）都汇到这一个函数，缓存只有一个挂载点：

```js
const refreshMyShares = () =>
  L.resolveDefault(hubApi.callHubMe(), null).then((res) => {
    if (res && res.result === 0) {
      hubApi.meCache.set(res.data);
      applyMe(res.data);
    }
    // 失败：保留现有画面，不再 applyMe(null)
  });
```

## 3. 三个必须处理的边界

| 情况 | 现在的行为 | 改后 |
|---|---|---|
| **网络失败** | `applyMe(null)` 把「我的作品」**清空**，看起来像作品没了 | 不动画面，保留缓存渲染。list 侧 `applyResult`（:2510）已有 stale 分支，行为不变 |
| **导入创作者 key 后** | 直接 `refreshMyShares()` | 换账号了，旧缓存是上一个账号的作品 —— `callHubImportKey` 成功后先 `meCache.clear()` 再 `refreshMyShares()`（`gallery.js:1798`）。否则「导入成功但 hub_me 随后失败」会留着旧账号的列表，是误导 |
| **首次安装，无任何缓存** | 白屏 0.94 s | `applyMe(null)` → 空态；online 列表为空 —— 但 5 个内置预设是本地 `presets.json`，**照样立刻出画面**，不是白屏 |

## 4. 死代码清理（Phase 1 计划预留的 Phase 4）

`docs/plans/2026-08-04-phase1-hub-direct.md` 原文：*「rpcd 的 hub_list/hub_get
留作回滚路径，Phase 4 再删」*。直连已稳定运行，本期兑现：

- `root/usr/libexec/rpcd/luci.aurora:2444-2454` — `hub_list` handler
- `root/usr/libexec/rpcd/luci.aurora:2456-2467` — `hub_get` handler
- `root/usr/libexec/rpcd/luci.aurora:1974-1981` — `list` 方法声明中对应两条
- `root/usr/share/rpcd/acl.d/luci-app-aurora.json` — read 段的 `"hub_list"`、`"hub_get"`

**`hub_http_get()`（:417）不能删** —— `hub_apply_worker`（:1087）仍用它拉取待应用的
payload。删 handler 不等于删这个工具函数。

前端侧另有一处，理由见 §2.3：`hub-api.js` 的 `listCache.get()` 与 `CACHE_TTL`
（`:6, :39-52`）无调用点，一并删除。

### 4.1 测试同步（不做会红）

基线 `npm test` 224 全绿，其中**六条测试正断言着上述死代码存在**，删代码必然弄红：

| 测试 | 现在断言 |
|---|---|
| `rpcd-hub.test.mjs:70` | `hub_list`/`hub_get` 在 `list` 分支注册 |
| `rpcd-hub.test.mjs:75` | 两个 handler 存在 |
| `rpcd-hub.test.mjs:80` | `hub_list` 白名单 sort、守 page |
| `rpcd-hub.test.mjs:85` | `hub_list` 透传 hub JSON + 统一错误壳 |
| `rpcd-hub.test.mjs:97` | `hub_get` 校验 id 防注入 |
| `rpcd-hub.test.mjs:105` | ACL read 段授予两者 |
| `hub-api-module.test.mjs:39` | `CACHE_TTL = 300000` |

按仓库既有范式处理（先例：`tests/version-removed.test.mjs`）——不是删掉了事，
而是**反转成「已删」断言**，并配一条「仍在」断言守住不该误删的东西：

- 新建 `tests/hub-rpcd-removed.test.mjs`：
  - `hub_list`/`hub_get` 的 handler、`list` 声明、ACL 条目均已消失
  - **`hub_http_get(` 仍在**（`hub_apply_worker` 依赖，见 §4）
  - `hub_apply`/`hub_me`/`hub_share` 等仍在 ACL
- `hub-api-module.test.mjs`：`CACHE_TTL` 断言改为「已删」；新增 `meCache` 的
  `set`/`getStale`/`clear` 存在、且**不含** `get(` 的断言
- `gallery-view.test.mjs`：新增断言 —— `load()` 中不再出现 `callHubList`/`callHubMe`
  （这是本设计的核心不变量，值得被测试钉住）

## 5. 效果与验证

| | 现在 | 改后 |
|---|---|---|
| 首屏（有缓存） | 0.94 s，尾部 5.07 s | **~0.1 s** |
| 首屏（首次安装） | 0.94 s 白屏 | **~0.1 s**，出内置预设 |
| 列表数据新鲜度 | 阻塞式最新 | 先旧后新，~0.9 s 内 reconcile |
| ubus 调用次数 | 不变 | 不变（本期不动信任模型） |

验证（真机 192.168.8.1，铁律 5：build 通过 ≠ 完成）：

1. Chrome Network/Performance 面板量 `load()` 结束到首个 paint 的间隔
2. 断网打开页面 → 应显示缓存内容 + 离线提示，**不得清空「我的作品」**
3. 导入另一份创作者 key → 旧账号作品不得残留
4. 全新安装（清 localStorage + 清 uci）→ 应立刻出 5 个内置预设，不白屏
5. `npm test` 全绿（基线 224 条；注意是 `npm test`，不是 `node --test tests/`——
   后者不展开 glob，会直接失败）

## 6. 不在本期范围（openwrt-cloud 侧，另开一轮）

205 ms RTT 落在 SJC，`workers.dev` 同样 172 ms —— 是整个网络出口的 CF anycast
路由问题，不是本仓库能改的。附带发现两条：

- **zone 未开 HTTP/3** —— 响应无 `Alt-Svc` 头。开启后浏览器走 QUIC，重访 0-RTT 恢复，
  可砍掉 546 ms 握手的大部分。CF Dashboard 开关，非代码。
- **list 接口无 `cache-control`** —— 每次都打 D1。加了能省 D1，但省不掉 RTT，收益小。
- 205 ms 本身：免费计划无解，需 Argo Smart Routing。
- `hub_me` 那次 **5.07 s** 尖刺未定位（traceroute 中间跳全星号），需单独观测。
