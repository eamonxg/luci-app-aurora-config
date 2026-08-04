# 主题商店首屏去阻塞 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `gallery.js` 的 `load()` 里两个跨太平洋请求挪到 `render()` 之后，首屏改由 localStorage 缓存驱动，把 0.94s（尾部 5.07s）的白屏降到 ~0.1s。

**Architecture:** LuCI 的 `load()` 不 resolve 就不进 `render()`，所以 `load()` 只保留本地来源（`presets.json` + `uci.load`，~90ms）。`render()` 先用 `listCache` / 新增的 `meCache` 画出画面并挂载 DOM，之后才发起 `fetchSort("hot")` 与 `refreshMyShares()`，结果回来无条件覆盖。信任模型不变——`hub_me` 仍走 ubus，`device_token` 不下发浏览器。

**Tech Stack:** LuCI 客户端 JS（`view.extend` / `baseclass.extend`）、`node --test` 源码与行为断言、POSIX shell（rpcd）、真机 OpenWrt 验证。

**Spec:** `docs/specs/2026-08-05-store-first-paint.md`

## Global Constraints

- 【铁律】commit message / PR / 任何入库文本不得含 session id、`claude.ai` 链接、内部工单号。`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` 可保留。每次 commit 后 `git log -1 --format=%B | grep -iE 'session|claude\.ai'` 必须为空。
- 【铁律】commit 后**不自动 push**。带 **GATE** 标记的步骤必须先获用户明确同意。
- **不改 `PKG_VERSION` / `PKG_RELEASE`**（当前 `1.1.5` / `20260805`）。本轮不是发版；先例见 commit `81dc76e`（纯文档 commit 未 bump）。
- 测试用 `npm test`，**不是** `node --test tests/`——后者不展开 glob，直接失败。基线 224 条全绿。
- 仓库为 `/Users/eamon/Developer/github/luci-theme/luci-app-aurora-config`，分支 `master`。workspace 根目录不是 git 仓库。
- 真机地址 **192.168.8.1**（不是 .6.1）。
- 本轮不新增任何 CSS，不动 `.dev/`，不动 po/pot（无新增用户可见字符串）。
- 不动 `HUB_BASE`、不动任何 `rpc.declare` 的 method/params、不动 hub Worker 侧代码。
- `hub_http_get()`（`luci.aurora:417`）**不得删除**——`hub_apply_worker`（`:1087`）仍依赖它。

## 关键前提（实测，勿再假设）

| 事实 | 数字 | 含义 |
|---|---|---|
| ubus + fork 2782 行 shell | 0.09 s | **不是瓶颈**，别去优化它 |
| 路由器 wget → hub | 0.78 s | 与开发机 curl 0.79s 一致，**设备不是瓶颈** |
| 复用连接后的请求 | 0.19 s | 等于 1 个 RTT |
| ping hub | 205 ms，落 `SJC` | 跨太平洋物理延迟，代码改不掉 |

**唯一可优化项：不要让首屏等这些往返。**

## 相对 spec 的一处修正

Spec §2.2 写的 render 收尾里有一句显式 `renderContent()`。实际 `selectTab(key)`（`gallery.js:2452` 附近）末行已经调用 `renderContent()`，再写一次是冗余重绘。本计划按 `selectTab("all")` 单独承担首帧渲染实现。

---

### Task 1: `hub-api.js` 新增 `meCache`，并删掉 `listCache` 的死面

**Files:**
- Modify: `htdocs/luci-static/resources/utils/hub-api.js:5-6`（常量）、`:37-78`（`listCache`）
- Test: `tests/hub-api-module.test.mjs:37-44`（替换「keeps the list cache TTL logic」一测）

**Interfaces:**
- Produces: `hubApi.meCache.set(value)` / `hubApi.meCache.getStale()` / `hubApi.meCache.clear()`，localStorage key `aurora.hub.me`，信封 `{timestamp, value}`。Task 2/3 依赖这三个方法名。
- Produces: `hubApi.listCache` 保持 `set`/`getStale`/`clear` 三个方法，**不再有 `get()`**。既有调用点 `gallery.js:2502`（`.set`）、`:2510`、`:2529`（`.getStale`）签名不变。

**背景（实施者必读）：** `listCache.get()` 全仓库无调用点，而 `CACHE_TTL` 和 `clear()` 又只在 `get()` 内部使用——因此那个 5 分钟 TTL 从未生效过，列表缓存实际永不过期。这不是缺陷：`fetchSort("hot")` 每次渲染都会覆盖，缓存的职责只是「首帧的种子」。本任务把这个意外变成明写的决定，并让 `meCache` 不去照抄那半份死代码。

- [ ] **Step 1: 写失败测试**

把 `tests/hub-api-module.test.mjs:37-44` 那个 `test("hub-api module keeps the list cache TTL logic", ...)` **整块删除**，在同一位置插入下列内容：

```js
// 两份缓存共享一个语义:只作首帧种子,不设 TTL。fetchSort / refreshMyShares
// 每次渲染都会覆盖它们,所以"过期"没有意义 —— 而一份永远可用的旧数据,正是
// 首屏不必等待 205ms 跨太平洋往返的前提。
test("hub-api: caches are first-paint seeds, not TTL'd stores", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes("CACHE_TTL"), "CACHE_TTL had no live reader; it should be gone");
  assert.ok(
    !/^\s+get\(\)\s*\{/m.test(src),
    "listCache.get() had no caller; it should be gone",
  );
  assert.match(src, /localStorage\.getItem\(/);
  assert.match(src, /localStorage\.setItem\(/);
  assert.match(src, /localStorage\.removeItem\(/);
});

test("hub-api exposes meCache alongside listCache", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("meCache"), "missing meCache");
  assert.ok(src.includes("aurora.hub.list"), "missing list cache key");
  assert.ok(src.includes("aurora.hub.me"), "missing me cache key");
});
```

再在文件**末尾**追加行为测试（不是模式匹配——`load()` harness 文件里已有，见 `hub-api-module.test.mjs` 的 `async function load()`）：

```js
// localStorage 在 node 里不存在。模块只在方法体内引用它,因此调用前把桩挂到
// globalThis 即可 —— 与 hubAssetUrl 那两个测试一样,真的把代码跑起来。
function withLocalStorage(fn) {
  const store = new Map();
  const had = "localStorage" in globalThis;
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    return fn(store);
  } finally {
    if (had) globalThis.localStorage = prev;
    else delete globalThis.localStorage;
  }
}

test("meCache round-trips the creator profile and clear() empties it", async () => {
  const m = await load();
  withLocalStorage(() => {
    assert.equal(m.meCache.getStale(), null);
    m.meCache.set({ id: "abc12345", nickname: "eamon", configs: [{ id: "x" }] });
    assert.deepEqual(m.meCache.getStale(), {
      id: "abc12345",
      nickname: "eamon",
      configs: [{ id: "x" }],
    });
    m.meCache.clear();
    assert.equal(m.meCache.getStale(), null);
  });
});

test("meCache.getStale never expires -- it is a first-paint seed", async () => {
  const m = await load();
  withLocalStorage((store) => {
    // 一条 1970 年的信封仍必须返回。过期没有意义:refreshMyShares 每次渲染
    // 都会覆盖它,而扔掉它只会换来一次 0.9s 的白屏。
    store.set(
      "aurora.hub.me",
      JSON.stringify({ timestamp: 0, value: { id: "old", nickname: null, configs: [] } }),
    );
    assert.deepEqual(m.meCache.getStale(), {
      id: "old",
      nickname: null,
      configs: [],
    });
  });
});

test("both caches survive corrupt localStorage", async () => {
  const m = await load();
  withLocalStorage((store) => {
    store.set("aurora.hub.me", "{not json");
    store.set("aurora.hub.list", "{not json");
    assert.equal(m.meCache.getStale(), null);
    assert.equal(m.listCache.getStale(), null);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test 2>&1 | tail -20
```
Expected: FAIL。至少两条——`CACHE_TTL had no live reader; it should be gone`（`CACHE_TTL` 尚在）与 `missing meCache`。

- [ ] **Step 3: 实现**

`hub-api.js:5-6` 两行常量替换为：

```js
const CACHE_KEY = "aurora.hub.list";
const ME_CACHE_KEY = "aurora.hub.me";
```

（`CACHE_TTL` 整行删除。）

`hub-api.js:35`（`ASSET_PATH_RE` 那行）之后、`return baseclass.extend({` 之前，插入工厂：

```js
// 两份 localStorage 缓存的共同实现。它们只作首帧的种子:render 先用缓存画出
// 画面,随后 fetchSort / refreshMyShares 的结果无条件覆盖 —— 所以刻意不设
// TTL。到 hub 的每次往返都是 205ms 起步、首连约 800ms(TLS 握手不可复用),
// 一份"旧但立刻可用"的数据比一次准确的白屏有用得多。
//
// 信封保留 timestamp:它没有读者,但是在真机上翻 localStorage 时唯一能看出
// 这帧画面有多旧的东西,而且保持了与旧版本写入的条目同形,无需迁移。
const makeCache = (key, label) => ({
  getStale() {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;
      return JSON.parse(cached).value ?? null;
    } catch (e) {
      return null;
    }
  },

  set(value) {
    try {
      localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), value }));
    } catch (e) {
      console.error("Failed to cache hub " + label + " data:", e);
    }
  },

  clear() {
    localStorage.removeItem(key);
  },
});
```

把 `hub-api.js:38-78` 整个 `listCache: { ... },` 对象字面量替换为两行：

```js
  listCache: makeCache(CACHE_KEY, "list"),

  meCache: makeCache(ME_CACHE_KEY, "me"),
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test 2>&1 | tail -12
```
Expected: PASS，总数从 224 变为 228（删 1 条、加 5 条）。

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/utils/hub-api.js tests/hub-api-module.test.mjs
git commit -q -F - <<'EOF'
refactor(hub-api): share one cache implementation, add meCache

listCache.get() had no callers, and CACHE_TTL plus clear() were only
reachable through it -- so the five-minute expiry never once ran and the
list cache has always been permanent. That is the right semantics, it just
happened by accident: fetchSort overwrites the cache on every render, so a
cached list is a first-paint seed, not a store that can go bad.

Make it deliberate. One makeCache factory, three live methods, no TTL, and
a second instance for the creator profile that hub_me will start seeding.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format=%B | grep -iE 'session|claude\.ai' && echo "!!! 铁律 10 违规" || echo "✓ clean"
```

---

### Task 2: `refreshMyShares()` 写入缓存，且失败时不再清空界面

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:1506-1509`
- Test: `tests/gallery-view.test.mjs`（末尾追加）

**Interfaces:**
- Consumes: Task 1 的 `hubApi.meCache.set(value)`。
- Produces: `refreshMyShares()` 仍返回 Promise（`gallery.js:1798`、`:2113`、`:2161` 都在 `.then()` 里用它），签名不变。

**背景：** 现在失败时执行 `applyMe(null)`，而 `applyMe` 会 `renderMyShares([])`（`gallery.js:1857` 把 `myShares` 置空）——用户断网时会看到自己已发布的作品从界面上消失，像是作品没了。Task 3 让首屏由缓存驱动后，这个缺陷会变成「画面闪一下就被清空」，所以必须先修。

- [ ] **Step 1: 写失败测试**

追加到 `tests/gallery-view.test.mjs` 末尾：

```js
test("gallery: hub_me seeds the cache, and a failed one must not wipe my shares", async () => {
  const src = await readFile(SRC, "utf8");
  const start = src.indexOf("const refreshMyShares");
  assert.ok(start > 0, "refreshMyShares not found");
  const fn = src.slice(start, src.indexOf("const applyMe", start));
  assert.ok(fn.includes("meCache.set"), "refreshMyShares must seed meCache on success");
  // 断网时把用户已发布的作品从界面抹掉,看起来像作品没了。保留上一帧才诚实
  // —— 我们只是没拿到新数据。
  assert.ok(
    !fn.includes("res.data : null"),
    "refreshMyShares must not applyMe(null) on failure",
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test 2>&1 | grep -A4 "seeds the cache"
```
Expected: FAIL，`refreshMyShares must seed meCache on success`。

- [ ] **Step 3: 实现**

把 `gallery.js:1506-1509` 这四行：

```js
    const refreshMyShares = () =>
      L.resolveDefault(hubApi.callHubMe(), null).then((res) => {
        applyMe(res && res.result === 0 ? res.data : null);
      });
```

替换为：

```js
    // hub_me 是本页唯一还走 ubus 的网络调用 —— device_token 是 0600 的写凭证
    // (hub_share/hub_update/hub_delete 都靠它认证),不下发到浏览器。整条链路
    // 实测约 0.9s,其中 ubus 只占 0.09s,其余全是路由器到 hub 那次不可复用的
    // TLS 握手加 205ms 跨太平洋 RTT。所以结果要落缓存:下次打开页面由缓存先
    // 画,这一次往返就不再挡在首屏前面。
    //
    // 失败时刻意什么都不做。原先是 applyMe(null),而 applyMe 会把 myShares
    // 置空 —— 断网的用户会眼看着自己已发布的作品从界面上消失。保留上一帧才
    // 是诚实的:我们只是没拿到新数据,不是作品没了。
    const refreshMyShares = () =>
      L.resolveDefault(hubApi.callHubMe(), null).then((res) => {
        if (res && res.result === 0) {
          hubApi.meCache.set(res.data);
          applyMe(res.data);
        }
      });
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test 2>&1 | tail -10
```
Expected: PASS，总数 229。

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -q -F - <<'EOF'
fix(store): a failed hub_me no longer wipes the user's published list

refreshMyShares called applyMe(null) on failure, and applyMe empties
myShares -- so losing the network made your own published configurations
disappear from the page, which reads as "they are gone" rather than "we
could not reach the store". Keep the last frame instead.

Successful responses now seed meCache, which the next page load will paint
from before any request goes out.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format=%B | grep -iE 'session|claude\.ai' && echo "!!! 铁律 10 违规" || echo "✓ clean"
```

---

### Task 3: `load()` 去阻塞，`render()` 先画后取，导入 key 清缓存

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:1035-1064`（`load()`）
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:2533-2548`（render 收尾）
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js:1797-1798`（导入 key 成功分支）
- Test: `tests/gallery-view.test.mjs`（末尾追加）

**Interfaces:**
- Consumes: Task 1 的 `hubApi.meCache.getStale()` / `.clear()`；Task 2 的 `refreshMyShares()`。
- Consumes: 既有 `fetchSort(sort)`（`gallery.js:2520`，返回 Promise，内部 `applyResult` → `renderContent`）、`selectTab(key)`（末行已调用 `renderContent()`）、`applyMe(data)`（`:1511`，接受 `null`）。
- Produces: `loadData` 不再含 `listRes` / `meRes` 两个字段；其余五个字段（`presets` / `hubApplied` / `keySaved` / `activePreset` / `navType`）不变，`render()` 中所有既有读取点无需改动。

- [ ] **Step 1: 写失败测试**

追加到 `tests/gallery-view.test.mjs` 末尾：

```js
// 本设计的核心不变量,值得被钉住:LuCI 在 load() resolve 前不会进 render(),
// 所以 load() 里任何一次到 hub 的往返都等于首屏白屏 0.8s 起步。
test("gallery load() waits on nothing but local sources", async () => {
  const src = await readFile(SRC, "utf8");
  const body = src.slice(src.indexOf("  load() {"), src.indexOf("  render(loadData) {"));
  assert.ok(body.length > 0, "load() body not found");
  assert.ok(!body.includes("callHubList"), "callHubList must not block first paint");
  assert.ok(!body.includes("callHubMe"), "callHubMe must not block first paint");
  assert.ok(body.includes("presets.json"), "load() still reads the bundled presets");
  assert.ok(body.includes('uci.load("aurora")'), "load() still reads uci");
});

test("gallery paints from cache first, then goes to the network", async () => {
  const src = await readFile(SRC, "utf8");
  const tail = src.slice(src.lastIndexOf("renderBanner();"));
  assert.ok(tail.includes("meCache.getStale"), "my shares must paint from cache");
  assert.ok(tail.includes("appendChild"), "the tail should mount the DOM");
  // 顺序要求:两个请求都在 DOM 挂载之后
  assert.ok(
    tail.indexOf('fetchSort("hot")') > tail.indexOf("appendChild"),
    "the list fetch must come after the first paint is mounted",
  );
  assert.ok(
    tail.indexOf("refreshMyShares()") > tail.indexOf("appendChild"),
    "hub_me must come after the first paint is mounted",
  );
  // loadData 不再携带这两份网络结果
  assert.ok(!tail.includes("loadData.listRes"), "listRes is gone from loadData");
  assert.ok(!tail.includes("loadData.meRes"), "meRes is gone from loadData");
});

test("gallery: importing a creator key drops the previous account's cached profile", async () => {
  const src = await readFile(SRC, "utf8");
  const i = src.indexOf("callHubImportKey");
  assert.ok(i > 0, "callHubImportKey not found");
  const block = src.slice(i, i + 1200);
  assert.ok(
    block.includes("meCache.clear()"),
    "a new key means a different account -- the cached profile is someone else's",
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test 2>&1 | grep -cE "^not ok|✖" 
npm test 2>&1 | grep -A3 "waits on nothing but local"
```
Expected: FAIL，`callHubList must not block first paint`。

- [ ] **Step 3a: 改 `load()`**

把 `gallery.js:1035-1064` 整个 `load()` 方法替换为（**注意保留原有的三段注释**，它们解释的是 uci 字段的语义，与本次改动无关）：

```js
  load() {
    // 刻意只留本地来源。presets.json 随包安装,uci.load 走本机 ubus(实测
    // ~90ms)。到 hub 的两个调用移到 render() 之后 —— LuCI 在 load() resolve
    // 前不会进 render(),把一次 205ms RTT / 首连 800ms 的往返放在这里,等于
    // 让首屏白等它。见 docs/specs/2026-08-05-store-first-paint.md。
    return Promise.all([
      L.resolveDefault(
        fetch(L.resource("aurora/presets.json")).then((res) =>
          res.ok ? res.json() : null,
        ),
        null,
      ),
      uci.load("aurora"),
    ]).then(([presetsRes]) => ({
      presets: (presetsRes && presetsRes.presets) || null,
      hubApplied: uci.get("aurora", "theme", "hub_applied") || "",
      // Set by rpcd whenever the key leaves the router (export or import).
      // Lives in uci rather than localStorage so it follows a keep-settings
      // upgrade, survives a browser change, and resets to zero on the clean
      // reflash that is exactly when the reminder should come back.
      keySaved: uci.get("aurora", "theme", "hub_key_saved") === "1",
      activePreset: uci.get("aurora", "theme", "active_preset") || "default",
      // This router's own navigation shape. It used to stand in for the
      // built-in presets' too, back when a preset changed only colours; now
      // every preview draws the configuration's own nav_type and this is read
      // by the publish panel alone -- the preview and manifest of what YOUR
      // configuration would look like in the store.
      navType: uci.get("aurora", "theme", "nav_type") || "mega-menu",
    }));
  },
```

- [ ] **Step 3b: 改 render 收尾**

把 `gallery.js:2533-2548`（从 `renderBanner();` 到 `return rootEl;`）替换为：

```js
    renderBanner();
    // 缓存或 null。null 走空态,不是错误态 —— 一台刚装好的路由器本来就没有
    // 已发布的作品,和"拿不到数据"是两回事。
    applyMe(hubApi.meCache.getStale());
    selectTab("all"); // 末行已 renderContent(),首帧在此成型

    [
      styleEl,
      headEl,
      contentEl,
      drawerMask,
      drawerEl,
    ].forEach((child) => rootEl.appendChild(child));

    // 网络在 DOM 挂载之后才发起。此刻画面已经成型:内置预设来自随包的
    // presets.json,在线列表与创作者档案来自上面两处缓存。两个请求回来后
    // 各自 reconcile,失败则保留当前这帧。
    fetchSort("hot");
    refreshMyShares();

    return rootEl;
  },
```

注意 `state.online.hot` 的缓存播种（`gallery.js:2529-2531` 的 `const cached = hubApi.listCache.getStale();`）在 `renderBanner()` 之前，**保持原样不动**。

- [ ] **Step 3c: 导入 key 时清缓存**

`gallery.js:1797-1798`，把：

```js
          ui.hideModal();
          refreshMyShares().then(() => {
```

替换为：

```js
          ui.hideModal();
          // 换账号了 —— 缓存里那份档案属于上一个 key。先清掉再刷新,否则
          // "导入成功、随后 hub_me 失败"会把上一个账号的作品留在界面上,
          // 而 Task 2 之后失败路径不再自行清空。
          hubApi.meCache.clear();
          applyMe(null);
          refreshMyShares().then(() => {
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test 2>&1 | tail -10
```
Expected: PASS，总数 232。

- [ ] **Step 5: 提交**

```bash
git add htdocs/luci-static/resources/view/aurora/gallery.js tests/gallery-view.test.mjs
git commit -q -F - <<'EOF'
perf(store): paint the first frame from cache instead of awaiting the hub

load() awaited callHubList and callHubMe, and LuCI does not enter render()
until load() resolves -- so every visit blocked on a round trip to the hub
before drawing anything. Measured on the device: 0.94s typical, 5.07s at
the tail. Meanwhile listCache was only read at line 2529, inside render,
which the wait had already delayed. The cache was written but never seeded
a first paint.

load() now waits only on presets.json and uci (~90ms). render() paints from
listCache and meCache, mounts, and only then issues both requests. Nothing
about the trust model changes: hub_me still goes over ubus, and the
device_token stays on the router.

Importing a creator key clears meCache first -- the cached profile belongs
to the key being replaced.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format=%B | grep -iE 'session|claude\.ai' && echo "!!! 铁律 10 违规" || echo "✓ clean"
```

---

### Task 4: 删除 rpcd 的 `hub_list` / `hub_get` 与其 ACL（Phase 1 预留的 Phase 4）

**Files:**
- Modify: `root/usr/libexec/rpcd/luci.aurora:1974-1981`（`list` 分支声明）
- Modify: `root/usr/libexec/rpcd/luci.aurora:2444-2468`（两个 handler）
- Modify: `root/usr/share/rpcd/acl.d/luci-app-aurora.json`（read.ubus 两条）
- Modify: `tests/rpcd-hub.test.mjs:70-110`（删除六条正向断言）
- Create: `tests/hub-rpcd-removed.test.mjs`

**Interfaces:**
- Consumes: 无（纯删除）。
- Produces: 无新接口。

**背景：** `docs/plans/2026-08-04-phase1-hub-direct.md` 原文——*「rpcd 的 hub_list/hub_get 留作回滚路径，Phase 4 再删」*。浏览器直连已稳定，本任务兑现。前端早已不调用它们（`hub-api.js` 的 `callHubList`/`callHubGet` 走 `hubFetch`）。

**⚠️ `hub_http_get()`（`luci.aurora:417`）必须保留**——`hub_apply_worker`（`:1087`）用它拉取待应用的 payload。删 handler ≠ 删这个工具函数。

- [ ] **Step 1: 写失败测试**

新建 `tests/hub-rpcd-removed.test.mjs`（范式对照既有的 `tests/version-removed.test.mjs`：成对写「已删」与「仍在」）：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const rpcd = readFileSync(
  path.join(repoRoot, "root/usr/libexec/rpcd/luci.aurora"),
  "utf8",
);
const acl = readFileSync(
  path.join(repoRoot, "root/usr/share/rpcd/acl.d/luci-app-aurora.json"),
  "utf8",
);
const hubApi = readFileSync(
  path.join(repoRoot, "htdocs/luci-static/resources/utils/hub-api.js"),
  "utf8",
);

// Phase 1 把列表与详情改成浏览器直连时,rpcd 的两个 handler 被留作回滚路径。
// 直连已稳定运行,这里兑现当时写下的 Phase 4。
test("rpcd script: the hub_list and hub_get handlers are gone", () => {
  assert.ok(!rpcd.includes('"hub_list")'), "hub_list handler should be gone");
  assert.ok(!rpcd.includes('"hub_get")'), "hub_get handler should be gone");
  assert.ok(
    !rpcd.includes('json_add_object "hub_list"'),
    "hub_list should not be declared in the list branch",
  );
  assert.ok(
    !rpcd.includes('json_add_object "hub_get"'),
    "hub_get should not be declared in the list branch",
  );
  // 只有 hub_list 构造带 sort/page 的浏览 URL,可以拿它当判据。
  assert.ok(
    !rpcd.includes("/api/v1/themes/aurora/configs?sort="),
    "the browse URL should only be built in the browser now",
  );
});

// ⚠️ 陷阱:被删的 hub_get(旧 :2462)与仍在的 hub_apply_worker(:1103)使用
// 的是逐字相同的一行 —— hub_http_get "/api/v1/themes/aurora/configs/$id"。
// 所以「详情 URL 是否消失」不能作为删除判据,上面那条测试只认 case 标签
// '"hub_get")'。反过来,这行的存在正好证明 apply 路径没被误删。
//
// 删 handler 不等于删这个工具函数:apply 仍然必须由路由器自己去取 payload,
// 因为它随后要在本地校验并写进 uci —— 那条路径不经过浏览器。
test("rpcd script: hub_http_get survives, apply still needs it", () => {
  assert.match(rpcd, /hub_http_get\(\)\s*\{/);
  assert.match(rpcd, /hub_apply_worker\(\)\s*\{/);
  assert.match(
    rpcd,
    /hub_http_get "\/api\/v1\/themes\/aurora\/configs\/\$id"/,
    "the apply worker must still fetch the payload from the router",
  );
});

test("acl: hub_list and hub_get are no longer granted", () => {
  const readMethods = JSON.parse(acl)["luci-app-aurora"].read.ubus["luci.aurora"];
  assert.ok(!readMethods.includes("hub_list"), "hub_list should be gone from read");
  assert.ok(!readMethods.includes("hub_get"), "hub_get should be gone from read");
});

test("acl: the methods the page still calls are kept", () => {
  const acljson = JSON.parse(acl)["luci-app-aurora"];
  const read = acljson.read.ubus["luci.aurora"];
  const write = acljson.write.ubus["luci.aurora"];
  assert.ok(read.includes("hub_me"), "hub_me is still called on every page load");
  assert.ok(read.includes("get_hub_status"), "apply polling still needs get_hub_status");
  assert.ok(write.includes("hub_apply"));
  assert.ok(write.includes("hub_share"));
  assert.ok(write.includes("hub_update"));
  assert.ok(write.includes("hub_delete"));
  assert.ok(write.includes("hub_import_key"));
});

test("hub-api: browse and detail are browser-direct, so nothing regressed to ubus", () => {
  assert.match(hubApi, /fetch\(HUB_BASE \+ path/);
  assert.ok(!/method:\s*"hub_list"/.test(hubApi), "hub_list must not be re-declared");
  assert.ok(!/method:\s*"hub_get"/.test(hubApi), "hub_get must not be re-declared");
});
```

删除后 `grep -n 'hub_http_get "/api/v1' root/usr/libexec/rpcd/luci.aurora` 应只剩**一行**（原 `:1103`，apply worker 那行）；删除前是三行。这是最快的自检。

同时从 `tests/rpcd-hub.test.mjs` **删除**这六条已被反转的测试（第 70–110 行区间，逐个按名字定位）：
`"rpcd script: hub_list and hub_get registered in list branch"`、
`"rpcd script: hub_list and hub_get call handlers exist"`、
`"rpcd script: hub_list whitelists sort and guards page"`、
`"rpcd script: hub_list passes through hub JSON with a unified error shell"`、
`"rpcd script: hub_get guards id against injection before use"`、
`"acl: hub_list and hub_get granted under read.ubus"`。

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test 2>&1 | grep -A3 "handlers are gone"
```
Expected: FAIL，`hub_list handler should be gone`。

- [ ] **Step 3: 删除代码**

① `root/usr/libexec/rpcd/luci.aurora` 的 `list` 分支，删除这 8 行：

```sh
	json_add_object "hub_list"
		json_add_string "sort" "sort"
		json_add_string "page" "page"
	json_close_object
	json_add_object "hub_get"
		json_add_string "id" "id"
	json_close_object
```

（即 `json_add_object "write_pwa_manifest"; json_close_object` 与 `json_add_object "hub_apply"` 之间的全部内容。）

② 同文件，删除两个 handler——从 `	"hub_list")` 起到 `	"hub_get")` 分支的 `		;;` 止，即 `get_init_data` 分支的 `		;;` 与 `	"hub_apply")` 之间的全部内容：

```sh
	"hub_list")
		read -r input; json_load "$input" 2>/dev/null
		json_get_var sort "sort"; json_get_var page "page"; json_cleanup
		case "$sort" in hot|new) ;; *) sort=hot ;; esac
		case "$page" in ''|*[!0-9]*) page=1 ;; esac
		if body=$(hub_http_get "/api/v1/themes/aurora/configs?sort=$sort&page=$page"); then
			printf '{ "result": 0, "data": %s }\n' "$body"
		else
			echo '{ "result": 1, "error": "hub_unreachable" }'
		fi
		;;

	"hub_get")
		read -r input; json_load "$input" 2>/dev/null
		json_get_var id "id"; json_cleanup
		case "$id" in ''|*[!A-Za-z0-9]*)
			echo '{ "result": 1, "error": "invalid_id" }'; exit 0 ;;
		esac
		if body=$(hub_http_get "/api/v1/themes/aurora/configs/$id"); then
			printf '{ "result": 0, "data": %s }\n' "$body"
		else
			echo '{ "result": 1, "error": "hub_unreachable" }'
		fi
		;;

```

③ `root/usr/share/rpcd/acl.d/luci-app-aurora.json`，`read.ubus["luci.aurora"]` 数组中删除 `"hub_list",` 与 `"hub_get",` 两行，并确认剩余数组仍是合法 JSON（`get_hub_status` 前的逗号）。

- [ ] **Step 4: 跑测试与语法检查**

```bash
sh -n root/usr/libexec/rpcd/luci.aurora && echo "✓ shell 语法通过"
python3 -c "import json;json.load(open('root/usr/share/rpcd/acl.d/luci-app-aurora.json'));print('✓ ACL JSON 合法')"
npm test 2>&1 | tail -10
```
Expected: 三项全过；测试总数 231（删 6 条、加 5 条）。

- [ ] **Step 5: 提交**

```bash
git add root/usr/libexec/rpcd/luci.aurora root/usr/share/rpcd/acl.d/luci-app-aurora.json tests/
git commit -q -F - <<'EOF'
refactor(rpcd): drop the hub_list and hub_get rollback path

Phase 1 moved browse and detail to browser-direct fetch and kept the rpcd
handlers as a way back, to be removed in Phase 4. Direct fetch has been in
production since; this is Phase 4.

hub_http_get stays -- hub_apply_worker still fetches the payload from the
router itself, because it goes on to validate it locally and write uci, and
that path never touches the browser.

The six tests that asserted the removed code are inverted into
hub-rpcd-removed.test.mjs, paired with assertions that hub_http_get, the
apply worker, and every still-called ACL method survived.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format=%B | grep -iE 'session|claude\.ai' && echo "!!! 铁律 10 违规" || echo "✓ clean"
```

---

### Task 5: 真机验证（**GATE**）

**Files:** 无改动。

**Interfaces:** Consumes: Task 1–4 的全部产出。

> 铁律 5：build 通过 ≠ 完成。下列五项全部亲眼看过才算收工。
> 部署方式见 `deploy-router` skill；本任务只推 htdocs / root 两棵树，不装包。

- [ ] **Step 1: 推送到真机并重启 rpcd**

```bash
scp -r htdocs/luci-static/resources/utils/hub-api.js \
       root@192.168.8.1:/www/luci-static/resources/utils/
scp -r htdocs/luci-static/resources/view/aurora/gallery.js \
       root@192.168.8.1:/www/luci-static/resources/view/aurora/
scp root/usr/libexec/rpcd/luci.aurora root@192.168.8.1:/usr/libexec/rpcd/
scp root/usr/share/rpcd/acl.d/luci-app-aurora.json root@192.168.8.1:/usr/share/rpcd/acl.d/
ssh root@192.168.8.1 'chmod +x /usr/libexec/rpcd/luci.aurora; /etc/init.d/rpcd restart; sleep 2; ubus list luci.aurora'
```
Expected: `ubus list` 输出 `luci.aurora`（对象仍注册）。

- [ ] **Step 2: 确认 rpcd 不再暴露两个方法，其余仍在**

```bash
ssh root@192.168.8.1 'ubus -v list luci.aurora' | grep -E "hub_list|hub_get\b" && echo "!!! 仍在暴露" || echo "✓ 两个方法已消失"
ssh root@192.168.8.1 'ubus -v list luci.aurora' | grep -cE "hub_me|hub_apply|hub_share"
```
Expected: 第一行 `✓ 两个方法已消失`；第二行 ≥ 3。

- [ ] **Step 3: 浏览器验证首屏（核心指标）**

浏览器打开 `http://192.168.8.1/cgi-bin/luci/admin/aurora/gallery`，DevTools → Network，勾选 Disable cache 关闭 HTTP 缓存但**保留 localStorage**。

先正常加载一次（让缓存写入），然后刷新，记录：
- Performance 面板的 First Contentful Paint
- Network 面板里 `themes.eamonxg.fun/api/v1/...` 与 ubus `hub_me` 两条请求的**发起时刻**

**实测结果（2026-08-05，真机 192.168.8.1，Chrome headless + CDP）**

⚠️ **FCP 是错误指标，别再用它。** LuCI 的外壳（header / 菜单 / Loading…）先于
view 绘制，所以 FCP 新旧两版都是 ~300–370ms，量不到 `load()` 的等待。
正确指标是**商城内容进 DOM 的时刻**——用 `MutationObserver` 观察
`.aurora-store` / `.aurora-store-card`。（注入探针要观察 `document` 而不是
`document.documentElement`：`addScriptToEvaluateOnNewDocument` 执行时后者还不
存在，`.observe()` 会抛异常让探针静默失效。）

| | 旧版（改动前） | 新版 |
|---|---|---|
| 商城内容进 DOM | **1318 / 1810 / 2078 ms** | **445 / 426 / 456 ms** |
| 有 localStorage 缓存时 | — | 407 / 428 / 428 ms |
| hub 请求发起时刻 | 384–412 ms（**内容在等它**） | 425–454 ms（**晚于内容 ~1ms**） |

中位数 **1810ms → 445ms，约 4 倍**。新版 `store_root ≈ hub_req + 1ms`，即渲染
完立刻发请求 —— 核心不变量成立。剩下的 ~430ms 是 LuCI 自身加载 view 模块的
开销，已与 hub 无关，这也是有无缓存差别不大的原因。

- [ ] **Step 4: 断网降级**

```bash
ssh root@192.168.8.1 'echo "0.0.0.0 themes.eamonxg.fun" >> /etc/hosts; /etc/init.d/dnsmasq restart'
```
浏览器同时用 DevTools → Network → 勾 `Block request domain` 屏蔽 `themes.eamonxg.fun`，刷新页面。

Expected：
- 在线列表显示缓存内容 + 陈旧/失败提示
- **「我的分享」列表不得被清空**（Task 2 的核心）
- 5 个内置预设正常可见可应用

恢复：
```bash
ssh root@192.168.8.1 'sed -i "/themes.eamonxg.fun/d" /etc/hosts; /etc/init.d/dnsmasq restart'
```

- [ ] **Step 5: 导入 key 的缓存失效**

先 `hub_export_key` 导出当前 key 备份。用「导入创作者 key」导入**另一份** key（或一串合法格式但未注册的 64 位 hex），确认：

Expected：上一个账号的作品**不残留**在「我的分享」里。

完成后导回原 key，确认作品列表恢复。

- [ ] **Step 6: 全新安装路径**

DevTools Console 执行 `localStorage.clear()` 后刷新。

Expected：立即出现 5 个内置预设（不是白屏），在线区显示加载中/空态，随后填充。

**Step 4/5/6 实测结果（均通过）**

- **断网降级**：路由器 `/etc/hosts` 黑洞 hub（断 `hub_me`）+ CDP
  `Network.setBlockedURLs` 拦截浏览器直连，重载后 `My Shares 1` **仍在**，
  `meCache` 未被清空。Task 2 的核心行为成立。
- **导入 key**：走真实 UI 路径（My Shares → Import a key → 填 textarea →
  Import）。导入后 `meCache` 变为 `none`，标签从 `My Shares1` 变为
  `My Shares` —— 上一个账号的作品不残留。原 key 已备份并恢复，
  创作者身份 `PutProbe / 6ed2e31j` 完好。
- **全新安装**：冷启动 profile（无 localStorage）下 5 张内置预设卡在
  426–456ms 出现，不白屏。
- **rpcd 面**：`ubus -v list luci.aurora` 中 `hub_list`/`hub_get` 已消失，
  其余 10 个 hub 方法俱在，`hub_me` 调用正常返回。

自动化脚本踩过的三个坑，留给后来者：① OpenWrt 无 sftp-server，`scp` 必须加
`-O`；② LuCI 会话可用 `ubus call session create` + `grant` 自造，但
`session_retrieve` 要求 `values.token` 是字符串，只设 `username` 会 403；
③ 页面路由是 `admin/system/aurora/gallery`，不是 `admin/aurora/gallery`。

- [ ] **Step 7: GATE —— 汇报并征询是否 push**

把 Step 3 的实测 FCP、Step 4/5/6 的观察结果汇报给用户，**等待明确同意后**再：

```bash
git log --format='%h %s' -n5
git push origin master
```

---

## 自检（写计划时已执行）

**Spec 覆盖：**

| Spec 章节 | 对应 Task |
|---|---|
| §2.1 `load()` 砍成两项 | Task 3 Step 3a |
| §2.2 render 先画后取 | Task 3 Step 3b |
| §2.3 `meCache` + 删 `listCache` 死面 | Task 1 |
| §2.4 `refreshMyShares` 唯一缓存写入点 | Task 2 |
| §3 网络失败不清空 | Task 2 + Task 5 Step 4 |
| §3 导入 key 清缓存 | Task 3 Step 3c + Task 5 Step 5 |
| §3 首次安装无缓存 | Task 5 Step 6 |
| §4 rpcd/ACL 死代码 | Task 4 |
| §4 `hub_http_get` 保留 | Task 4 Step 1 的「仍在」断言 |
| §4.1 六条测试反转 | Task 4 Step 1 + Step 3 |
| §5 验证五项 | Task 5 Step 3–6 |
| §6 RTT / HTTP/3 | 明确不在本计划范围（openwrt-cloud 侧另开） |

**类型/命名一致性：** `meCache.set/getStale/clear`（Task 1 定义）在 Task 2（`.set`）、Task 3（`.getStale`、`.clear`）中用法一致；`makeCache(key, label)` 只在 Task 1 内部使用；`refreshMyShares()` 返回 Promise 的契约在 Task 2 保持，Task 3 的 `.then()` 调用点因此不受影响。

**测试计数轨迹：** 224（基线）→ 228（Task 1）→ 229（Task 2）→ 232（Task 3）→ 231（Task 4，删 6 加 5）。
