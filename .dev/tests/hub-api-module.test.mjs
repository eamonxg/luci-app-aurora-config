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
const strip = (src) =>
  src.replace(/^"use strict";$/m, "").replace(/^"require [^"]+";$/gm, "");

// hub-api requires utils.notices; hand it the real module rather than a stub,
// so the refresh tests below exercise the sanitizer the router will run.
async function load(rpc) {
  const notices = new Function(
    "baseclass",
    strip(await readFile(srcPath("utils/notices.js"), "utf8")),
  )({ extend: (obj) => obj });
  return new Function("baseclass", "rpc", "notices", strip(await readFile(SRC, "utf8")))(
    { extend: (obj) => obj },
    rpc || { declare: () => () => Promise.resolve(null) },
    notices,
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

// ---------------------------------------------------------------------------
// Schema compat + notices

// fetch 同样只在方法体内被引用,所以和 localStorage 一样挂到 globalThis 上。
// respond 收到 URL,返回 { status, body } 或抛错(断网)。
async function withFetch(respond, fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const { status, body } = await respond(String(url));
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = prev;
  }
}

// withLocalStorage 在 fn 返回的那一刻就拆桩,等不了 promise。
async function withStorage(fn) {
  const store = new Map();
  const had = "localStorage" in globalThis;
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    return await fn(store);
  } finally {
    if (had) globalThis.localStorage = prev;
    else delete globalThis.localStorage;
  }
}

// refreshNotices 用到 L.resolveDefault;LuCI 里它是全局的。
async function withLuci(fn) {
  const had = "L" in globalThis;
  const prev = globalThis.L;
  globalThis.L = {
    resolveDefault: (promise, fallback) => Promise.resolve(promise).catch(() => fallback),
  };
  try {
    return await fn();
  } finally {
    if (had) globalThis.L = prev;
    else delete globalThis.L;
  }
}

// 记录每一次 ubus 调用;me 是 hub_me 的应答。
const recordingRpc = (me, init) => {
  const calls = [];
  return {
    calls,
    declare: (spec) => () => {
      calls.push(spec.method);
      return Promise.resolve(
        spec.method === "hub_me" ? me : spec.method === "get_init_data" ? init || null : null,
      );
    },
  };
};

const feedNotice = (over) => ({
  id: "n1",
  level: "warning",
  audience: "all",
  title: "Heads up",
  body: "Something changed.",
  url: "",
  i18n: {},
  at: "",
  ...over,
});

test("the client schema is one named constant, and the host string is not repeated", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /^const CLIENT_SCHEMA = 1;$/m);
  assert.equal((await load()).CLIENT_SCHEMA, 1);
  assert.equal(src.split("themes.eamonxg.fun").length - 1, 1, "HUB_BASE must stay the only copy");
  for (const rel of ["utils/notices.js", "preload/aurora-notices.js"])
    assert.ok(
      !(await readFile(srcPath(rel), "utf8")).includes("eamonxg"),
      `${rel} must reach the hub through hub-api`,
    );
});

test("callHubList tells the hub which schema this client reads", async () => {
  const m = await load();
  await withFetch(
    () => ({ status: 200, body: { items: [] } }),
    async (calls) => {
      await m.callHubList("new", 3);
      await m.callHubList("bogus", -1);
      assert.deepEqual(calls, [
        "https://themes.eamonxg.fun/api/v1/themes/aurora/configs?sort=new&page=3&schema=1",
        "https://themes.eamonxg.fun/api/v1/themes/aurora/configs?sort=hot&page=1&schema=1",
      ]);
    },
  );
});

test("callHubNotices reads the public feed straight from the browser", async () => {
  const m = await load();
  await withFetch(
    () => ({ status: 200, body: { notices: [feedNotice()] } }),
    async (calls) => {
      const res = await m.callHubNotices();
      assert.deepEqual(calls, ["https://themes.eamonxg.fun/api/v1/notices?theme=aurora&schema=1"]);
      assert.deepEqual(res, { result: 0, data: { notices: [feedNotice()] } });
    },
  );
});

test("a hub that has not deployed the feed yet means no notices, not an error", async () => {
  const m = await load();
  await withFetch(
    () => ({ status: 404, body: { error: "not_found" } }),
    async () => {
      assert.deepEqual(await m.callHubNotices(), { result: 0, data: { notices: [] } });
      // The same 404 still means "gone" everywhere else.
      assert.deepEqual(await m.callHubGet("abc123"), { result: 1, error: "invalid_id" });
    },
  );
  await withFetch(
    () => ({ status: 500, body: {} }),
    async () =>
      assert.deepEqual(await m.callHubNotices(), { result: 1, error: "hub_unreachable" }),
  );
  await withFetch(
    () => {
      throw new TypeError("network down");
    },
    async () =>
      assert.deepEqual(await m.callHubNotices(), { result: 1, error: "hub_unreachable" }),
  );
});

test("inbox state lives under its documented keys; the dismissed list is gone", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes("noticesDismissed"), "replaced by inboxRead / inboxDone");
  const m = await load();
  withLocalStorage((store) => {
    assert.equal(m.noticesCache.getStale(), null);
    assert.equal(m.noticesCheckedAt(), 0);
    assert.deepEqual(m.inboxState(), { read: [], done: [] });

    m.noticesCache.set({ notices: [] });
    m.markNoticesChecked(1790000000000);
    m.setInboxState({ read: ["n1", "rejected:c1"], done: ["n2"] });

    assert.deepEqual([...store.keys()].sort(), [
      "aurora.hub.inboxDone",
      "aurora.hub.inboxRead",
      "aurora.hub.notices",
      "aurora.hub.noticesChecked",
    ]);
    assert.deepEqual(m.noticesCache.getStale(), { notices: [] });
    assert.equal(m.noticesCheckedAt(), 1790000000000);
    assert.deepEqual(m.inboxState(), { read: ["n1", "rejected:c1"], done: ["n2"] });
  });
});

test("inbox state survives corrupt, hostile and unavailable storage", async () => {
  const m = await load();
  withLocalStorage((store) => {
    store.set("aurora.hub.noticesChecked", "{not json");
    store.set("aurora.hub.inboxRead", "{not json");
    store.set("aurora.hub.inboxDone", '{"length":1,"0":"n1"}');
    assert.equal(m.noticesCheckedAt(), 0);
    assert.deepEqual(m.inboxState(), { read: [], done: [] });

    store.set("aurora.hub.noticesChecked", '"1790000000000"');
    store.set("aurora.hub.inboxRead", '["n1",7,null,{"id":"x"},"n2"]');
    assert.equal(m.noticesCheckedAt(), 0);
    assert.deepEqual(m.inboxState().read, ["n1", "n2"]);
  });

  // Safari private mode, a full quota, storage disabled by policy: every
  // accessor throws. None of it may reach the page.
  const had = "localStorage" in globalThis;
  const prev = globalThis.localStorage;
  const boom = () => {
    throw new Error("SecurityError");
  };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  const prevError = console.error;
  console.error = () => {};
  try {
    assert.equal(m.noticesCheckedAt(), 0);
    assert.deepEqual(m.inboxState(), { read: [], done: [] });
    assert.equal(m.noticesCache.getStale(), null);
    assert.doesNotThrow(() => m.markNoticesChecked(1));
    assert.doesNotThrow(() => m.setInboxState({ read: ["n1"], done: [] }));
    assert.doesNotThrow(() => m.noticesCache.set({ notices: [] }));
    assert.doesNotThrow(() => m.noticesCache.clear());
    assert.doesNotThrow(() => m.setNoticesLocal(null));
  } finally {
    console.error = prevError;
    if (had) globalThis.localStorage = prev;
    else delete globalThis.localStorage;
  }

  // With no localStorage at all the reference itself throws.
  assert.equal(m.noticesCheckedAt(), 0);
  assert.doesNotThrow(() => m.markNoticesChecked(1));
});

const meReply = (...configs) => ({ result: 0, data: { id: "me", nickname: "eamon", configs } });
const ownShare = (over) => ({ id: "c1", name: "Nord Night", status: "active", ...over });

test("refreshNotices caches a sanitized feed, stamps the check and prunes read/done keys", async () => {
  const rpc = recordingRpc(null);
  const m = await load(rpc);
  await withLuci(() =>
    withFetch(
      () => ({
        status: 200,
        body: {
          notices: [
            feedNotice({ id: "keep" }),
            feedNotice({ id: "bad id" }),
            feedNotice({ id: "info1", level: "info", junk: "<script>" }),
          ],
        },
      }),
      () =>
        withStorage(async () => {
          m.setInboxState({ read: ["keep", "longGone"], done: ["info1", "alsoGone", "rejected:c9"] });
          const before = Date.now();
          const snapshot = await m.refreshNotices();

          assert.deepEqual(snapshot.notices.map((n) => n.id), ["keep", "info1"]);
          assert.equal("junk" in snapshot.notices[1], false);
          assert.equal("muted" in snapshot, false);
          assert.deepEqual(m.noticesCache.getStale(), snapshot);
          assert.ok(m.noticesCheckedAt() >= before);
          // hub_me was not asked, so nothing is known about derived items and
          // their keys stay put.
          assert.deepEqual(m.inboxState(), { read: ["keep"], done: ["info1", "rejected:c9"] });
          assert.deepEqual(rpc.calls, ["get_init_data"]);
        }),
    ),
  );
});

test("refreshNotices asks hub_me only for a creators notice or a router known to have shares", async () => {
  const creatorsFeed = { notices: [feedNotice({ id: "cr", audience: "creators" })] };
  const plainFeed = { notices: [feedNotice()] };
  const cases = [
    { feed: plainFeed, cachedMe: null, asked: false },
    { feed: plainFeed, cachedMe: { id: "me", configs: [] }, asked: false },
    { feed: creatorsFeed, cachedMe: null, asked: true },
    { feed: plainFeed, cachedMe: { id: "me", configs: [ownShare()] }, asked: true },
  ];
  for (const { feed, cachedMe, asked } of cases) {
    const fresh = meReply(ownShare({ id: "c2", status: "removed" }));
    const rpc = recordingRpc(fresh);
    const m = await load(rpc);
    await withLuci(() =>
      withFetch(
        () => ({ status: 200, body: feed }),
        () =>
          withStorage(async () => {
            if (cachedMe) m.meCache.set(cachedMe);
            await m.refreshNotices();
            assert.deepEqual(rpc.calls, asked ? ["get_init_data", "hub_me"] : ["get_init_data"]);
            // The reply lands in the cache the preload derives its items from.
            assert.deepEqual(m.meCache.getStale(), asked ? fresh.data : cachedMe);
          }),
      ),
    );
  }
});

test("a failed hub_me keeps the cached profile and every derived key", async () => {
  for (const reply of [null, { result: 1, error: "hub_unreachable" }, { result: 0 }]) {
    const rpc = recordingRpc(reply);
    const m = await load(rpc);
    await withLuci(() =>
      withFetch(
        () => ({ status: 200, body: { notices: [] } }),
        () =>
          withStorage(async () => {
            const cached = { id: "me", configs: [ownShare({ assets_status: "rejected" })] };
            m.meCache.set(cached);
            m.setInboxState({ read: ["gone"], done: ["rejected:c1", "removed:c7"] });
            await m.refreshNotices();
            assert.deepEqual(rpc.calls, ["get_init_data", "hub_me"]);
            assert.deepEqual(m.meCache.getStale(), cached);
            assert.deepEqual(m.inboxState(), { read: [], done: ["rejected:c1", "removed:c7"] });
          }),
      ),
    );
  }
});

test("a caller already running hub_me hands it over: no second call, and its answer prunes", async () => {
  // Thunks: a rejected promise built up front is reported as unhandled before
  // refreshNotices ever gets to adopt it.
  const cases = [
    [() => meReply(ownShare({ assets_status: "rejected" })).data, ["rejected:c1"]],
    [() => Promise.resolve(meReply().data), []],
    [() => null, ["rejected:c1", "removed:c7"]],
    [() => Promise.reject(new Error("hub_me failed")), ["rejected:c1", "removed:c7"]],
  ];
  for (const [makeMe, doneAfter] of cases) {
    const rpc = recordingRpc(meReply(ownShare()));
    const m = await load(rpc);
    await withLuci(() =>
      withFetch(
        () => ({ status: 200, body: { notices: [feedNotice({ id: "cr", audience: "creators" })] } }),
        () =>
          withStorage(async () => {
            m.setInboxState({ read: [], done: ["rejected:c1", "removed:c7"] });
            await m.refreshNotices({ me: makeMe() });
            assert.deepEqual(rpc.calls, ["get_init_data"]);
            assert.deepEqual(m.inboxState().done, doneAfter);
            // The view owns its own meCache write; this path must not clobber it.
            assert.equal(m.meCache.getStale(), null);
          }),
      ),
    );
  }
});

test("a failed refresh keeps the previous feed and state, and still counts as a check", async () => {
  const rpc = recordingRpc(meReply(ownShare()));
  const m = await load(rpc);
  await withLuci(() =>
    withFetch(
      () => {
        throw new TypeError("network down");
      },
      () =>
        withStorage(async () => {
          m.noticesCache.set({ notices: [feedNotice({ id: "old" })], muted: true });
          m.meCache.set({ id: "me", configs: [ownShare()] });
          m.setInboxState({ read: ["old", "gone"], done: ["removed:c7"] });
          const before = Date.now();
          // A 1.2.x opt-out flag in the cache is dropped, not carried forward.
          const kept = { notices: [feedNotice({ id: "old" })], local: null };
          assert.deepEqual(await m.refreshNotices(), kept);
          assert.deepEqual(m.noticesCache.getStale(), kept);
          assert.deepEqual(m.inboxState(), { read: ["old", "gone"], done: ["removed:c7"] });
          assert.deepEqual(rpc.calls, ["get_init_data"], "an unreachable hub is not asked a second question");
          // One attempt per interval whether or not the hub answers: a browser
          // that cannot reach it must not retry on every page.
          assert.ok(m.noticesCheckedAt() >= before);
        }),
    ),
  );
});

test("a malformed feed body degrades to an empty list", async () => {
  for (const body of [null, [], "notices", { notices: "x" }, { notices: { 0: feedNotice() } }]) {
    const m = await load();
    await withLuci(() =>
      withFetch(
        () => ({ status: 200, body }),
        () =>
          withStorage(async () => {
            assert.deepEqual(await m.refreshNotices(), { notices: [], local: null });
          }),
      ),
    );
  }
});

const initReply = (configured) => ({
  feed: { pm: "apk", configured, channel: configured ? "snapshots" : "" },
  versions: { theme: { installed_version: "1.3.8" }, config: { installed_version: "1.2.0" } },
});

test("refreshNotices probes the update source once and caches the verdict with the feed", async () => {
  const rpc = recordingRpc(null, initReply(false));
  const m = await load(rpc);
  await withLuci(() =>
    withFetch(
      () => ({ status: 200, body: { notices: [] } }),
      () =>
        withStorage(async () => {
          m.setInboxState({ read: ["feed:missing"], done: [] });
          const snapshot = await m.refreshNotices();
          assert.deepEqual(snapshot.local, { feedMissing: true, theme: "1.3.8", app: "1.2.0" });
          assert.deepEqual(m.noticesCache.getStale().local, snapshot.local);
          assert.deepEqual(m.inboxState().read, ["feed:missing"]);
          assert.deepEqual(rpc.calls, ["get_init_data"]);
        }),
    ),
  );
});

test("once the source is configured the item's keys are pruned; an unanswered probe keeps everything", async () => {
  for (const [init, local, read] of [
    [initReply(true), { feedMissing: false, theme: "1.3.8", app: "1.2.0" }, []],
    [null, { feedMissing: true, theme: "", app: "" }, ["feed:missing"]],
    [{ feed: { pm: "unknown" } }, { feedMissing: true, theme: "", app: "" }, ["feed:missing"]],
  ]) {
    const m = await load(recordingRpc(null, init));
    await withLuci(() =>
      withFetch(
        () => ({ status: 200, body: { notices: [] } }),
        () =>
          withStorage(async () => {
            m.noticesCache.set({ notices: [], local: { feedMissing: true, theme: "", app: "" } });
            m.setInboxState({ read: ["feed:missing"], done: [] });
            assert.deepEqual((await m.refreshNotices()).local, local);
            assert.deepEqual(m.inboxState().read, read);
          }),
      ),
    );
  }
});

test("the local verdict survives a dead hub, and can be set on its own", async () => {
  const m = await load(recordingRpc(null, initReply(false)));
  await withLuci(() =>
    withFetch(
      () => {
        throw new TypeError("network down");
      },
      () =>
        withStorage(async () => {
          // The router answers even when the hub does not.
          assert.equal((await m.refreshNotices()).local.feedMissing, true);
          const after = m.setNoticesLocal({ feedMissing: false, theme: "1.3.8", app: "1.2.0" });
          assert.deepEqual(after, {
            notices: [],
            local: { feedMissing: false, theme: "1.3.8", app: "1.2.0" },
          });
          assert.deepEqual(m.noticesCache.getStale(), after);
        }),
    ),
  );
});

test("hub-api declares the two local calls the inbox needs, and nothing new on the router", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /callGetInitData: rpc\.declare\(\{\s*object: "luci\.aurora",\s*method: "get_init_data",/);
  assert.match(src, /callAddFeed: rpc\.declare\(\{\s*object: "luci\.aurora",\s*method: "add_feed",/);
  const acl = JSON.parse(await readFile(repo("root/usr/share/rpcd/acl.d/luci-app-aurora.json"), "utf8"))[
    "luci-app-aurora"
  ];
  assert.ok(acl.read.ubus["luci.aurora"].includes("get_init_data"));
  assert.ok(acl.write.ubus["luci.aurora"].includes("add_feed"));
});

test("the opt-out is gone: no muting API, no muted flag written, a stale one dropped", async () => {
  const src = await readFile(SRC, "utf8");
  for (const gone of ["muted", "muteNotices", "setNoticesMuted", "hub_notices"]) assert.ok(!src.includes(gone), gone);
  const m = await load(recordingRpc(null, null));
  await withLuci(() =>
    withFetch(
      () => ({ status: 200, body: { notices: [feedNotice()] } }),
      () =>
        withStorage(async () => {
          m.noticesCache.set({ notices: [], muted: true, local: null });
          assert.equal("muted" in m.setNoticesLocal(null), false);
          m.noticesCache.set({ notices: [], muted: true, local: null });
          const snapshot = await m.refreshNotices();
          assert.deepEqual(Object.keys(snapshot).sort(), ["local", "notices"]);
          assert.equal("muted" in m.noticesCache.getStale(), false);
        }),
    ),
  );
});
