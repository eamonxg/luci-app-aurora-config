import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

const SRC = srcPath("utils/hub-api.js");

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
  assert.ok(
    !/rpc\.declare\(\{\s*object: "luci\.aurora",\s*method: "hub_list"/.test(src),
    "hub_list still declared over ubus",
  );
  assert.ok(
    !/rpc\.declare\(\{\s*object: "luci\.aurora",\s*method: "hub_get"/.test(src),
    "hub_get still declared over ubus",
  );
});

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

test("hub-api module exposes the apply/status/restore declares (Task 6)", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubApply"), "missing callHubApply");
  assert.match(src, /method:\s*"hub_apply"/);
  assert.match(src, /params:\s*\["id"\]/);
  assert.ok(src.includes("callGetHubStatus"), "missing callGetHubStatus");
  assert.match(src, /method:\s*"get_hub_status"/);
  assert.match(src, /params:\s*\["job_id"\]/);
  assert.ok(src.includes("callHubRestore"), "missing callHubRestore");
  assert.match(src, /method:\s*"hub_restore_backup"/);
});

test("hub-api module exposes the publish/my-shares/delete declares (Task 8)", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubShareBegin"), "missing callHubShareBegin");
  assert.ok(src.includes("callHubShareCommit"), "missing callHubShareCommit");
  assert.ok(src.includes("callHubMe"), "missing callHubMe");
  assert.match(src, /method:\s*"hub_me"/);
  assert.ok(src.includes("callHubDelete"), "missing callHubDelete");
  assert.match(src, /method:\s*"hub_delete"/);
  // 单请求的老路必须彻底消失:它把整张登录背景 base64 塞进一个 1.6MB 的
  // body,而 uclient-fetch 走 TLS 推不动 —— 留着它就是留着那个 bug。
  assert.ok(!/method:\s*"hub_share"/.test(src), "hub_share must not be re-declared");
  assert.ok(!/method:\s*"hub_update"/.test(src), "hub_update must not be re-declared");
});

// hubAssetUrl is pure, so these tests actually run it rather than
// pattern-matching the source. Same harness as feed-check-module.test.mjs:
// strip LuCI's "require" directives and hand the body stub globals.
async function load() {
  const src = await readFile(SRC, "utf8");
  const body = src
    .replace(/^"use strict";$/m, "")
    .replace(/^"require [^"]+";$/gm, "");
  return new Function("baseclass", "rpc", body)(
    { extend: (obj) => obj },
    { declare: () => () => Promise.resolve(null) },
  );
}

test("hubAssetUrl makes the hub's relative asset path absolute", async () => {
  const m = await load();
  assert.equal(
    m.hubAssetUrl("/assets/6zcxcg07/logo_svg"),
    "https://themes.eamonxg.fun/assets/6zcxcg07/logo_svg",
  );
  assert.equal(
    m.hubAssetUrl("/assets/abc12345/favicon_png"),
    "https://themes.eamonxg.fun/assets/abc12345/favicon_png",
  );
});

test("hubAssetUrl rejects anything that is not a hub asset path", async () => {
  const m = await load();
  // The path is hub-supplied and therefore untrusted: everything that is not
  // the one shape the hub can legitimately produce yields "", and the caller
  // draws its plain-colour fallback instead.
  assert.equal(m.hubAssetUrl(""), "");
  assert.equal(m.hubAssetUrl(null), "");
  assert.equal(m.hubAssetUrl(undefined), "");
  assert.equal(m.hubAssetUrl("assets/abc/logo_svg"), "");
  assert.equal(m.hubAssetUrl("/assets/abc/../../etc/passwd"), "");
  assert.equal(m.hubAssetUrl("/assets/abc/logo_svg?x=1"), "");
  assert.equal(m.hubAssetUrl("//evil.example/assets/abc/logo_svg"), "");
  assert.equal(m.hubAssetUrl("https://evil.example/assets/abc/logo_svg"), "");
  assert.equal(m.hubAssetUrl("javascript:alert(1)"), "");
  assert.equal(m.hubAssetUrl({ toString: () => "/assets/abc/logo_svg" }), "");
});

test("hub-api: publishing drops the author parameter, nickname gets its own call", async () => {
  const src = await readFile(SRC, "utf8");
  // 署名是账号属性,由 hub 从 device_token 解析 —— 不是每次发布可以挑的字段。
  assert.match(
    src,
    /method:\s*"hub_share_begin",\s*\n\s*params:\s*\["name", "description", "target_id"\]/,
  );
  assert.ok(src.includes("callHubSetNickname"), "missing callHubSetNickname");
  assert.match(src, /method:\s*"hub_set_nickname"/);
  assert.match(src, /params:\s*\["nickname"\]/);
});

test("hub-api exposes the creator key export/import declares", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubExportKey"), "missing callHubExportKey");
  assert.match(src, /method:\s*"hub_export_key"/);
  assert.ok(src.includes("callHubImportKey"), "missing callHubImportKey");
  assert.match(src, /method:\s*"hub_import_key"/);
  assert.match(src, /params:\s*\["key"\]/);
});

test("hub-api exposes callHubMe and drops callHubMyShares", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubMe"), "missing callHubMe");
  assert.ok(!src.includes("callHubMyShares"), "callHubMyShares must be gone");
  assert.match(src, /method:\s*"hub_me"/);
});

// localStorage 在 node 里不存在。模块只在方法体内引用它,因此调用前把桩挂到
// globalThis 即可 —— 与上面 hubAssetUrl 那两个测试一样,真的把代码跑起来,
// 而不是对源码做模式匹配。
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

test("the two caches are independent -- clearing one keeps the other", async () => {
  const m = await load();
  withLocalStorage(() => {
    m.listCache.set({ items: [{ id: "a" }] });
    m.meCache.set({ id: "me", nickname: null, configs: [] });
    m.meCache.clear();
    assert.equal(m.meCache.getStale(), null);
    assert.deepEqual(m.listCache.getStale(), { items: [{ id: "a" }] });
  });
});

// 三段式发布:两端走 ubus(device_token 留在路由器),中间那段字节由浏览器
// 直接 PUT 到 hub —— uclient-fetch 走 TLS 推不动 1.2MB。
test("hub-api declares the three-step publish", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /method: "hub_share_begin"/);
  assert.match(src, /params: \["name", "description", "target_id"\]/);
  assert.match(src, /method: "hub_share_commit"/);
  assert.match(src, /params: \["draft_id"\]/);
});

test("publishCurrentConfig uploads asset bytes from the browser", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /publishCurrentConfig/);
  assert.match(src, /XMLHttpRequest/, "needs upload progress events");
  assert.match(src, /upload\.onprogress/);
  assert.match(src, /"Bearer " \+/, "asset PUT authenticates with the ticket");
  assert.match(src, /HUB_BASE \+ entry\.url/);
  // 票据是浏览器唯一拿到的凭证。断言只针对代码 —— 注释里解释"为什么浏览器
  // 拿不到 device_token"正是该留下的东西,把它一起禁掉会逼人删掉理由。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/device_token/.test(code),
    "the device token must never appear in browser code",
  );
});

// 调用方要据此决定发布成功那句话提不提审核 —— 这个数它已经在手里(begun.assets),
// 为一句文案再往 hub 跑一趟是白跑。
test("publishCurrentConfig reports how many assets it uploaded", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(
    src,
    /result:\s*0,\s*id:\s*done\.id,\s*assets:\s*entries\.length/,
    "the caller cannot word the review notice without knowing whether anything was uploaded",
  );
});
