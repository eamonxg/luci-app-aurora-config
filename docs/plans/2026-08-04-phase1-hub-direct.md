# Phase 1：Worker CORS + 商店列表/详情浏览器直连 实施计划

> **执行状态（2026-08-04）**：Task 1–3 完成（openwrt-cloud `feat/hub-cors` 本地 commit `0014d45`，vitest 336 全绿）；Task 4 已执行：feat/hub-cors 合入 main 并推送，deploy-hub workflow success，线上 OPTIONS 204 + access-control-allow-origin:* 复验通过；Task 5–6 完成（config 仓库 commit `ba89ad8`，node --test 全绿）；Task 7 前端文件已推真机 192.168.8.1 并清缓存，CORS 上线后浏览器直连即生效；Phase 2/3 前端亦已部署真机。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商店的列表与详情请求从"路由器 wget 中转"改为浏览器直连 hub，冷加载从十几秒降到 ~1s；为此先给 themes-hub Worker 加 CORS。

**Architecture:** Worker 入口统一加 CORS（OPTIONS 预检短路 + 所有 API 响应带 `Access-Control-Allow-Origin: *`）；`hub-api.js` 的 `callHubList`/`callHubGet` 换成 `fetch` 直连，但返回包络与 rpcd 完全一致，因此 `gallery.js` 与 rpcd 在本期**零改动**（rpcd 的 hub_list/hub_get 留作回滚路径，Phase 4 再删）。

**Tech Stack:** Cloudflare Worker（vitest + `cloudflare:test` 的 `SELF.fetch` 集成测试）；LuCI 客户端 JS（`node --test` 源码断言测试）。

## Global Constraints

- 涉及两个仓库：`~/Developer/github/openwrt-cloud`（hub Worker，GitHub `eamonxg/openwrt-cloud`，若本地不存在先 clone）与 `~/Developer/github/luci-theme/luci-app-aurora-config`（当前分支 `wip/theme-store`，直接在此分支工作）。
- HUB_BASE 固定为 `https://themes.eamonxg.fun`（与 rpcd 脚本 `readonly HUB_BASE` 一致）。
- 前端返回包络必须与 rpcd 完全一致：成功 `{ result: 0, data: <hub 原始响应> }`；网络/超时/5xx `{ result: 1, error: "hub_unreachable" }`；id 非法或 404 `{ result: 1, error: "invalid_id" }`。
- CORS 头固定值：`Access-Control-Allow-Origin: *`、`Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`、`Access-Control-Allow-Headers: Content-Type`、`Access-Control-Max-Age: 86400`。静态站（`env.SITE`）不加。
- 【铁律】commit message 不得含 session id / claude.ai 链接；`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 可保留；每次 commit 后 `git log -1 --format=%B | grep -iE 'session|claude\.ai'` 必须为空。
- 【铁律】commit 后不自动 push。带 **GATE** 标记的步骤必须先获用户明确同意。
- 不改 `PKG_VERSION`/`PKG_RELEASE`（发版仪式时按 aurora-ship 流程再问 patch/minor）。
- gallery.js、rpcd `luci.aurora`、menu.d、ACL 本期一律不动。

---

### Task 1: openwrt-cloud 本地准备与测试基线

**Files:**
- 无代码改动；建立本地仓库与基线。

**Interfaces:**
- Produces: 本地可跑 `npx vitest run` 全绿的 `~/Developer/github/openwrt-cloud/hub`。

- [ ] **Step 1: clone（已存在则跳过）**

```bash
[ -d ~/Developer/github/openwrt-cloud ] || git clone git@github.com:eamonxg/openwrt-cloud.git ~/Developer/github/openwrt-cloud
cd ~/Developer/github/openwrt-cloud && git checkout main && git pull && git checkout -b feat/hub-cors
```

- [ ] **Step 2: 安装依赖并跑基线**

```bash
cd ~/Developer/github/openwrt-cloud/hub && npm ci && npx vitest run
```
Expected: 全绿。若基线即红，停下报告，不得继续。

### Task 2: Worker CORS 失败测试

**Files:**
- Create: `hub/test/integration/cors.test.js`

**Interfaces:**
- Consumes: `cloudflare:test` 的 `SELF`（现有 harness，同 `ping.test.js`）。
- Produces: 对 Task 3 实现的验收断言。

- [ ] **Step 1: 写失败测试**

```js
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "http://192.168.1.1";

describe("CORS", () => {
  it("OPTIONS preflight on the list endpoint returns 204 with CORS headers", async () => {
    const res = await SELF.fetch("https://example.com/api/v1/themes/aurora/configs", {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, DELETE, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  it("GET /api/v1/ping carries allow-origin", async () => {
    const res = await SELF.fetch("https://example.com/api/v1/ping", {
      headers: { Origin: ORIGIN },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("API 404 error envelope carries allow-origin", async () => {
    const res = await SELF.fetch("https://example.com/api/v1/nope", {
      headers: { Origin: ORIGIN },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("asset route responses carry allow-origin", async () => {
    // 不存在的资产也应带 CORS（错误包络同样要能被浏览器读取）
    const res = await SELF.fetch("https://example.com/assets/zzzzzzzz/logo_svg", {
      headers: { Origin: ORIGIN },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("the static site is NOT given CORS headers", async () => {
    const res = await SELF.fetch("https://example.com/", { headers: { Origin: ORIGIN } });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Developer/github/openwrt-cloud/hub && npx vitest run test/integration/cors.test.js
```
Expected: FAIL（preflight 404、无 allow-origin 头）。

### Task 3: Worker CORS 实现

**Files:**
- Modify: `hub/src/http.js`（新增 `CORS_HEADERS` 与 `withCors`）
- Modify: `hub/src/worker.js`（`export default fetch` 的 4 个 return 点）

**Interfaces:**
- Produces: `withCors(response: Response): Response`、`CORS_HEADERS`（http.js 导出，Task 2 的测试驱动）。

- [ ] **Step 1: http.js 追加导出**

```js
// CORS：hub 的读接口是公开数据，写接口鉴权在 body 里的 device_token，
// 因此对 API 统一放开跨源；静态站不在此列（见 worker.js）。
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "access-control-max-age": "86400",
};

export function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
```

- [ ] **Step 2: worker.js 接线**

import 行加入 `CORS_HEADERS, withCors`（来自 `./http.js`），`export default` 改为：

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    let matched;
    try {
      matched = router.dispatch(request, env);
    } catch (err) {
      if (err instanceof URIError) {
        return withCors(errorResponse(400, "bad_request", "The request path is malformed."));
      }
      throw err;
    }
    if (matched) return withCors(await matched);

    if (url.pathname.startsWith("/api/")) {
      return withCors(errorResponse(404, "not_found", "The requested resource was not found."));
    }

    return env.SITE.fetch(request);
  },
};
```

注意保留原有的 URIError 注释块，不要连带删掉。

- [ ] **Step 3: 全量测试**

```bash
cd ~/Developer/github/openwrt-cloud/hub && npx vitest run
```
Expected: 全绿（含新 cors.test.js 与原有全部集成/单元测试）。

- [ ] **Step 4: Commit（openwrt-cloud）**

```bash
cd ~/Developer/github/openwrt-cloud
git add hub/src/http.js hub/src/worker.js hub/test/integration/cors.test.js
git commit -m "feat(hub): add CORS so LuCI frontends can call the API directly

Preflight OPTIONS short-circuits with 204; every API and asset response
gains access-control-allow-origin. The static site is left untouched.
Read endpoints are public data and write endpoints authenticate via the
device token in the body, so a wildcard origin does not widen access.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -iE 'session|claude\.ai' && echo "TRAILER LEAK" || echo clean
```

### Task 4: 部署与线上验证 【GATE：需用户确认】

**Files:** 无改动；发布动作。

- [ ] **Step 1: GATE — 询问用户**

问用户一句："hub CORS 已在本地测试通过，push `feat/hub-cors` 后如何部署——直接合入 main 触发 deploy-hub，还是开 PR？" 未获答复不得 push。

- [ ] **Step 2: push 并部署（按用户选择）**

```bash
cd ~/Developer/github/openwrt-cloud
# 用户选直接合入：
git checkout main && git merge --ff-only feat/hub-cors && git push origin main
# 用户选 PR：
git push -u origin feat/hub-cors && gh pr create --fill
```
部署 workflow 是 `.github/workflows/deploy-hub.yml`；push 前先读该文件确认触发条件（push main 的 hub/ 路径过滤或 workflow_dispatch），必要时 `gh workflow run deploy-hub.yml`。

- [ ] **Step 3: 线上验证**

```bash
gh run list -R eamonxg/openwrt-cloud --limit 3
curl -si -X OPTIONS -H "Origin: http://192.168.1.1" -H "Access-Control-Request-Method: POST" \
  "https://themes.eamonxg.fun/api/v1/themes/aurora/configs" | head -8
curl -si -H "Origin: http://192.168.1.1" \
  "https://themes.eamonxg.fun/api/v1/themes/aurora/configs?sort=hot&page=1" | grep -i "access-control\|^HTTP"
```
Expected: OPTIONS 204 + 四个 CORS 头；GET 200 + `access-control-allow-origin: *`。贴输出作为证据。

### Task 5: hub-api 源码断言测试更新（config 仓库）

**Files:**
- Modify: `tests/hub-api-module.test.mjs`

**Interfaces:**
- Produces: 对 Task 6 实现的验收断言（源码 regex 风格，与现有测试一致）。

- [ ] **Step 1: 更新测试**

将现有第一、二个 test（"exposes the shared surface" / "clones the version-api cache TTL logic"）中与 list/get 的 rpc 传输相关断言替换；保留缓存与其余 rpc 断言。替换后的前两个 test 全文：

```js
test("hub-api module exposes the shared surface", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /^"require baseclass";/m);
  assert.match(src, /^"require rpc";/m);
  assert.ok(src.includes("aurora.hub.list"), "missing cache key");
  assert.ok(src.includes("callHubList"), "missing callHubList");
  assert.ok(src.includes("callHubGet"), "missing callHubGet");
  assert.ok(src.includes("getStale"), "missing getStale");
  assert.match(src, /return baseclass\.extend\(/);
});

test("hub-api list/detail go straight to the hub from the browser", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const HUB_BASE = "https:\/\/themes\.eamonxg\.fun"/);
  assert.match(src, /fetch\(HUB_BASE \+ path/, "list/get must use fetch, not ubus");
  assert.match(src, /AbortController/, "missing fetch timeout");
  assert.match(src, /hub_unreachable/, "network failures must map to the rpcd envelope");
  assert.match(src, /invalid_id/, "bad ids must short-circuit without a request");
  assert.match(src, /result: 0, data/, "success must keep the rpcd envelope");
  // list/get 不得再走 rpc.declare
  assert.ok(!/rpc\.declare\(\{\s*object: "luci\.aurora",\s*method: "hub_list"/.test(src), "hub_list still declared over ubus");
  assert.ok(!/rpc\.declare\(\{\s*object: "luci\.aurora",\s*method: "hub_get"/.test(src), "hub_get still declared over ubus");
});

test("hub-api module keeps the list cache TTL logic", () => {
  return readFile(SRC, "utf8").then((src) => {
    assert.match(src, /CACHE_TTL\s*=\s*300000/);
    assert.match(src, /localStorage\.getItem\(CACHE_KEY\)/);
    assert.match(src, /localStorage\.setItem\(/);
    assert.match(src, /localStorage\.removeItem\(CACHE_KEY\)/);
  });
});
```

第三个 test（apply/status/restore declares）保持不变——这些仍走 rpc。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Developer/github/luci-theme/luci-app-aurora-config && node --test tests/hub-api-module.test.mjs
```
Expected: 新增 test FAIL（源码里还没有 HUB_BASE/fetch）。

### Task 6: hub-api.js 直连实现

**Files:**
- Modify: `htdocs/luci-static/resources/utils/hub-api.js`（仅 `callHubList`/`callHubGet` 及新增私有 helper；其余 rpc.declare 与 listCache 原样保留）

**Interfaces:**
- Consumes: Task 4 上线的 CORS。
- Produces: `callHubList(sort, page)` / `callHubGet(id)`，签名与返回包络与旧版完全一致（gallery.js 零改动）。

- [ ] **Step 1: 实现**

删除 `callHubList`、`callHubGet` 两个 `rpc.declare`，在 `return baseclass.extend({` 之前加入：

```js
const HUB_BASE = "https://themes.eamonxg.fun";
const HUB_TIMEOUT_MS = 15000;

// 浏览器直连 hub 的读路径。返回包络刻意与 rpcd 保持一致
// （{result:0,data} / {result:1,error}），gallery.js 无需感知传输方式的变化。
const hubFetch = (path) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HUB_TIMEOUT_MS);
  return fetch(HUB_BASE + path, {
    signal: controller.signal,
    headers: { Accept: "application/json" },
  })
    .then((res) => {
      if (res.status === 404) return { result: 1, error: "invalid_id" };
      if (!res.ok) return { result: 1, error: "hub_unreachable" };
      return res.json().then((data) => ({ result: 0, data }));
    })
    .catch(() => ({ result: 1, error: "hub_unreachable" }))
    .finally(() => clearTimeout(timer));
};
```

`baseclass.extend({...})` 内以同名方法替代原 declare：

```js
  callHubList(sort, page) {
    const safeSort = sort === "new" ? "new" : "hot";
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    return hubFetch(
      "/api/v1/themes/aurora/configs?sort=" + safeSort + "&page=" + safePage,
    );
  },

  callHubGet(id) {
    if (!/^[A-Za-z0-9]+$/.test(String(id || ""))) {
      return Promise.resolve({ result: 1, error: "invalid_id" });
    }
    return hubFetch("/api/v1/themes/aurora/configs/" + id);
  },
```

- [ ] **Step 2: 全量测试**

```bash
cd ~/Developer/github/luci-theme/luci-app-aurora-config && node --test tests/*.test.mjs
```
Expected: 全绿。若 `gallery-view.test.mjs` / `version-removed.test.mjs` 因 hub_list/hub_get 的 ubus 断言而红，只修改这两处与传输方式绑定的断言（改法参照 Task 5 的风格），不得动其余断言。

- [ ] **Step 3: Commit（config 仓库，当前分支 wip/theme-store）**

```bash
cd ~/Developer/github/luci-theme/luci-app-aurora-config
git add htdocs/luci-static/resources/utils/hub-api.js tests/
git commit -m "perf: fetch the store list and detail straight from the hub

The router-side wget hop (browser -> ubus -> rpcd shell -> wget -> hub)
made the store take double-digit seconds to load on routes with poor
reachability to Cloudflare. callHubList/callHubGet now fetch the hub
directly from the browser with a 15s abort, keeping the exact rpcd
response envelope so gallery.js and the rpcd fallback stay untouched.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -iE 'session|claude\.ai' && echo "TRAILER LEAK" || echo clean
```

### Task 7: 真机验证 【GATE：涉及向路由器推文件，先知会用户】

**Files:** 无改动；验证动作（deploy-router 流程）。

- [ ] **Step 1: 推送前端文件到真机**

```bash
scp -O htdocs/luci-static/resources/utils/hub-api.js root@192.168.8.1:/www/luci-static/resources/utils/
ssh root@192.168.8.1 'rm -rf /tmp/luci-modulecache /tmp/luci-indexcache*'
```

- [ ] **Step 2: 浏览器验证并留证据**

硬刷新后打开 系统 → Aurora → 主题商店：
- 列表应在 ~1-2s 内出现（对照：改动前十几秒或 hub_unreachable）；
- DevTools Network 面板确认列表/详情请求直达 `themes.eamonxg.fun`（非 `/ubus/`），预检或简单请求均 200/204；
- 点开一个主题详情，加载应即时。
- 断网对照（可选）：断开路由器 WAN，商店列表仍应通过浏览器网络加载成功——这正是直连的收益。
让用户确认体感，贴 Network 截图或时序作为证据。

- [ ] **Step 3: 收尾**

在本计划文件中勾掉全部复选框，更新 spec 分期表中 Phase 1 状态；等待用户指示是否 push config 仓库。
