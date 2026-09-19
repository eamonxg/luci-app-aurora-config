import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

const SRC = srcPath("preload/aurora-notices.js");
const FEED_URL = "https://themes.eamonxg.fun/api/v1/notices?theme=aurora&schema=1";
const HOUR = 60 * 60 * 1000;

const strip = (src) =>
  src.replace(/^"use strict";$/m, "").replace(/^"require [^"]+";$/gm, "");

const notice = (over) => ({
  id: "n1",
  level: "warning",
  audience: "all",
  title: "Heads up",
  body: "Something changed.",
  url: "https://themes.eamonxg.fun/notices/n1",
  i18n: { "zh-cn": { title: "请注意", body: "有变化。" } },
  ...over,
});

// LuCI evaluates every resources/preload/*.js before initDOM, on every page.
// This builds the smallest world that lets the real preload, the real
// utils/notices.js and the real utils/hub-api.js run together, and records
// every way out of the page: fetch, ubus, L.require, localStorage.
async function boot(options) {
  const opts = options || {};
  const log = { requires: [], fetches: [], rpc: [], storageReads: 0, storageWrites: 0, hidden: [] };
  let moves;
  const store = new Map(Object.entries(opts.storage || {}));
  const listeners = [];
  const idle = [];
  const timeouts = [];
  const indicators = [];
  const styles = [];

  const document = {
    documentElement: { lang: "en" },
    head: { appendChild: (node) => styles.push(node) },
    addEventListener: (type, handler, flags) => listeners.push({ type, handler, flags }),
    getElementById: (id) => styles.find((node) => node.attrs.id === id) || null,
    querySelector: (selector) =>
      indicators.find((node) => selector === `span[data-indicator="${node.id}"]`) || null,
  };
  moves = log.moves = [];
  const window = {
    setTimeout: (cb, ms) => timeouts.push({ cb, ms }),
    location: { href: "" },
    getComputedStyle: () => ({ fontSize: opts.indicatorFontSize ?? "0px" }),
  };
  if (opts.idle !== false) window.requestIdleCallback = (cb) => idle.push(cb);

  const E = (tag, attrs) => ({ tag, attrs: attrs || {}, textContent: "" });
  const translate = (msgid) => msgid;

  // Same contract as luci-base's ui.showIndicator: one span per id, relabelled
  // in place on the second call.
  const ui = {
    showIndicator: (id, label, handler, style) => {
      let node = indicators.find((candidate) => candidate.id === id);
      if (!node) {
        const classes = new Set();
        node = {
          id,
          attrs: {},
          classes,
          classList: { add: (name) => classes.add(name) },
          setAttribute: (name, value) => (node.attrs[name] = String(value)),
          parentNode: { appendChild: (child) => moves.push(child.id) },
        };
        indicators.push(node);
      }
      Object.assign(node, { textContent: label, handler, style });
      return true;
    },
    hideIndicator: (id) => {
      log.hidden.push(id);
      const at = indicators.findIndex((candidate) => candidate.id === id);
      if (at !== -1) indicators.splice(at, 1);
    },
  };
  const uci = {
    load: (name) => {
      log.rpc.push("uci.load:" + name);
      return Promise.resolve();
    },
    get: (config, section, option) => {
      const theme = { hub_notices: "0" };
      return option === undefined ? theme : theme && theme[option];
    },
  };
  const rpc = {
    declare: (spec) => () => {
      log.rpc.push(spec.method);
      return Promise.resolve(
        spec.method === "hub_me"
          ? opts.me || null
          : spec.method === "get_init_data"
            ? opts.init || null
            : null,
      );
    },
  };

  const baseclass = { extend: (obj) => obj };
  const noticesModule = new Function(
    "baseclass",
    strip(await readFile(srcPath("utils/notices.js"), "utf8")),
  )(baseclass);
  const modules = { ui, uci, "utils.notices": noticesModule };

  const L = {
    env: { sessionid: "session" in opts ? opts.session : "0123456789abcdef" },
    url: (path) => "/cgi-bin/luci/" + path,
    resolveDefault: (promise, fallback) => Promise.resolve(promise).catch(() => fallback),
    require: (name) => {
      log.requires.push(name);
      if (opts.requireFails === name) return Promise.reject(new Error("HTTP error 404"));
      return Promise.resolve(modules[name]);
    },
  };

  const globals = {
    L,
    fetch: async (url) => {
      log.fetches.push(String(url));
      if (opts.fetchFails) throw new TypeError("network down");
      const status = opts.status || 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => ({ notices: opts.feed || [] }),
      };
    },
    localStorage: {
      getItem: (k) => {
        log.storageReads += 1;
        return store.has(k) ? store.get(k) : null;
      },
      setItem: (k, v) => {
        log.storageWrites += 1;
        store.set(k, String(v));
      },
      removeItem: (k) => store.delete(k),
    },
  };
  const saved = {};
  for (const key of Object.keys(globals)) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value: globals[key],
      configurable: true,
      writable: true,
    });
  }
  const restore = () => {
    for (const key of Object.keys(globals)) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };

  modules["utils.hub-api"] = new Function(
    "baseclass",
    "rpc",
    "notices",
    strip(await readFile(srcPath("utils/hub-api.js"), "utf8")),
  )(baseclass, rpc, noticesModule);

  // Same signature LuCI's own loader evals a class file into, plus the two
  // page globals (E, _) a browser would already have.
  const preload = new Function(
    "window",
    "document",
    "L",
    "baseclass",
    "E",
    "_",
    strip(await readFile(SRC, "utf8")),
  )(window, document, L, baseclass, E, translate);

  return {
    log,
    store,
    listeners,
    idle,
    timeouts,
    indicators,
    styles,
    window,
    preload,
    restore,
    init: () => preload.__init__(),
    // Fire luci-loaded, then run whatever was parked for idle time.
    async loaded() {
      for (const { handler } of listeners.splice(0)) handler();
      for (const cb of idle.splice(0)) await cb();
      for (const { cb } of timeouts.splice(0)) await cb();
    },
  };
}

const cached = (value) => JSON.stringify({ timestamp: Date.now() - HOUR, value });

const fresh = (snapshot, extra) => ({
  "aurora.hub.noticesChecked": JSON.stringify(Date.now() - HOUR),
  "aurora.hub.notices": cached(snapshot),
  ...(extra || {}),
});

const creator = (...configs) => ({ id: "me", nickname: "eamon", configs });

const run = async (options, check) => {
  const world = await boot(options);
  try {
    world.init();
    await world.loaded();
    await check(world);
  } finally {
    world.restore();
  }
  return world;
};

test("the preload declares baseclass and nothing else", async () => {
  const src = await readFile(SRC, "utf8");
  const requires = [...src.matchAll(/^"require ([^"]+)";$/gm)].map((m) => m[1]);
  // Every declared dependency is fetched and evaluated before initDOM, on every
  // page of LuCI -- including the ones that have nothing to do with this app.
  assert.deepEqual(requires, ["baseclass"]);
  assert.match(src, /^return baseclass\.extend\(/m);
  assert.ok(!src.includes("innerHTML"), "nothing here may be parsed as markup");
  assert.ok(!src.includes("addNotification"), "the global entry point is an indicator, not a banner");
});

test("__init__ only parks a luci-loaded listener", async () => {
  const world = await boot({ storage: fresh({ notices: [notice()] }) });
  try {
    world.init();
    assert.equal(world.listeners.length, 1);
    assert.equal(world.listeners[0].type, "luci-loaded");
    assert.deepEqual(world.listeners[0].flags, { once: true });
    assert.deepEqual(world.log.requires, []);
    assert.deepEqual(world.log.fetches, []);
    assert.deepEqual(world.log.rpc, []);
    assert.equal(world.log.storageReads, 0);
    assert.equal(world.log.storageWrites, 0);
    assert.equal(world.idle.length, 0);
    assert.equal(world.indicators.length, 0);
    assert.equal(world.styles.length, 0);

    // The event itself still does no work: it hands over to idle time.
    for (const { handler } of world.listeners) handler();
    assert.equal(world.idle.length, 1);
    assert.deepEqual(world.log.requires, []);
    assert.equal(world.log.storageReads, 0);
  } finally {
    world.restore();
  }
});

test("without a session -- the login page -- nothing is scheduled at all", async () => {
  for (const session of [null, undefined, ""]) {
    const world = await boot({ session, storage: fresh({ notices: [notice()] }) });
    try {
      world.init();
      assert.equal(world.listeners.length, 0);
      await world.loaded();
      assert.deepEqual(world.log.requires, []);
      assert.equal(world.log.storageReads, 0);
      assert.equal(world.indicators.length, 0);
    } finally {
      world.restore();
    }
  }
});

test("browsers without requestIdleCallback fall back to a timeout", async () => {
  const world = await boot({ idle: false, storage: fresh({ notices: [notice()] }) });
  try {
    world.init();
    for (const { handler } of world.listeners) handler();
    assert.equal(world.timeouts.length, 1);
    await world.loaded();
    assert.equal(world.indicators.length, 1);
  } finally {
    world.restore();
  }
});

test("a check that is not due counts from the caches: no fetch, no ubus", async () => {
  await run(
    {
      storage: fresh(
        {
          notices: [
            notice(),
            notice({ id: "c1", level: "critical" }),
            notice({ id: "i1", level: "info" }),
            notice({ id: "w2" }),
            notice({ id: "w3" }),
          ],
        },
        {
          "aurora.hub.me": cached(creator({ id: "s1", name: "Warm Paper", status: "active", assets_status: "rejected" })),
          "aurora.hub.inboxRead": JSON.stringify(["w2"]),
          "aurora.hub.inboxDone": JSON.stringify(["w3"]),
        },
      ),
    },
    (world) => {
      assert.deepEqual(world.log.fetches, []);
      assert.deepEqual(world.log.rpc, []);
      assert.deepEqual(world.log.requires, ["utils.notices", "utils.hub-api", "utils.notices", "utils.hub-api", "ui"]);
      assert.equal(world.log.storageWrites, 0);
      // n1 + c1 + the rejected share; info never counts, read and done do not either.
      const [indicator] = world.indicators;
      assert.equal(indicator.id, "aurora-inbox");
      assert.equal(indicator.textContent, "Inbox 3");
      assert.equal(indicator.attrs["data-count"], "3");
      assert.equal(indicator.style, "active");
      assert.equal(indicator.title, "Inbox 3");
      assert.equal(typeof indicator.handler, "function");
    },
  );
});

test("nothing unread that matters: no indicator, no injected style", async () => {
  const quiet = [
    fresh({ notices: [] }),
    fresh({ notices: [notice({ level: "info" })] }),
    fresh({ notices: [notice()] }, { "aurora.hub.inboxRead": JSON.stringify(["n1"]) }),
    fresh({ notices: [notice()] }, { "aurora.hub.inboxDone": JSON.stringify(["n1"]) }),
    fresh({ notices: [notice({ audience: "creators" })] }),
    fresh("{corrupt"),
    { "aurora.hub.noticesChecked": JSON.stringify(Date.now() - HOUR) },
  ];
  for (const storage of quiet)
    await run({ storage }, (world) => {
      assert.deepEqual(world.log.fetches, []);
      assert.deepEqual(world.log.rpc, []);
      assert.equal(world.indicators.length, 0);
      assert.equal(world.styles.length, 0);
      assert.deepEqual(world.log.hidden, ["aurora-inbox"]);
    });
});

test("a creators broadcast counts once the cached profile shows an affected share", async () => {
  await run(
    {
      storage: fresh(
        { notices: [notice({ audience: "creators" })] },
        { "aurora.hub.me": cached(creator({ id: "s1", status: "active", compat: { state: "deprecated" } })) },
      ),
    },
    (world) => {
      // The broadcast plus the derived "needs an update" summary.
      assert.equal(world.indicators[0].attrs["data-count"], "2");
      assert.deepEqual(world.log.rpc, []);
    },
  );
});

test("one indicator and one style per document, however often it is refreshed", async () => {
  await run({ storage: fresh({ notices: [notice(), notice({ id: "n2" })] }) }, async (world) => {
    await world.preload.update();
    await world.preload.update();
    assert.equal(world.indicators.length, 1);
    assert.equal(world.styles.length, 1);
    assert.equal(world.indicators[0].attrs["data-count"], "2");

    // The Marketplace marks things read and pokes the same module.
    world.store.set("aurora.hub.inboxRead", JSON.stringify(["n1"]));
    await world.preload.update();
    assert.equal(world.indicators[0].textContent, "Inbox 1");
    assert.equal(world.indicators[0].attrs["data-count"], "1");

    world.store.set("aurora.hub.inboxRead", JSON.stringify(["n1", "n2"]));
    await world.preload.update();
    assert.equal(world.indicators.length, 0, "the indicator leaves as soon as the last item is read");
    assert.deepEqual(world.log.fetches, []);
    assert.deepEqual(world.log.rpc, []);
  });
});

test("clicking the indicator opens the Marketplace on its Inbox tab", async () => {
  await run({ storage: fresh({ notices: [notice()] }) }, (world) => {
    assert.equal(world.preload.INBOX_HASH, "#inbox");
    world.indicators[0].handler();
    assert.equal(world.window.location.href, "/cgi-bin/luci/admin/system/aurora/marketplace#inbox");
  });
});

test("the injected style draws the icon only where the theme hides indicator text", async () => {
  await run({ storage: fresh({ notices: [notice()] }) }, (world) => {
    const [style] = world.styles;
    assert.equal(style.tag, "style");
    const css = style.textContent;
    const rules = css.split("}").filter((rule) => rule.trim());
    assert.equal(rules.length, 3);
    for (const rule of rules)
      assert.ok(rule.startsWith('#indicators span[data-indicator="aurora-inbox"].aurora-inbox-icon'), rule.slice(0, 80));
    assert.doesNotMatch(css, /data-nav-type/);
    assert.match(rules[0], /\{position:relative;order:1;/);
    assert.match(css, /::before\{-webkit-mask:var\(--aurora-inbox-icon\) center\/cover no-repeat;mask:var\(--aurora-inbox-icon\) center\/cover no-repeat\}/);
    assert.match(css, /--aurora-inbox-icon:url\("data:image\/svg\+xml,/);
    const [indicator] = world.indicators;
    assert.deepEqual([...indicator.classes], ["aurora-inbox-icon"]);
    assert.deepEqual(world.log.moves, ["aurora-inbox"]);
    // The theme's uci-changes badge: -top-0.5 -right-0.5 min-h-3 min-w-3 px-0.5
    // text-[8px] font-bold leading-none rounded-full bg-danger text-on-brand.
    const badge = css.slice(css.indexOf("[data-count]::after{"));
    for (const declaration of [
      "content:attr(data-count)",
      "position:absolute",
      "top:-2px",
      "right:-2px",
      "z-index:10",
      "min-width:12px",
      "min-height:12px",
      "padding:0 2px",
      "border-radius:99px",
      "background:var(--danger)",
      "color:var(--on-brand)",
      "font-size:8px",
      "font-weight:700",
      "line-height:1",
    ])
      assert.ok(badge.includes(declaration), declaration);
  });
});

test("a theme that shows indicator text keeps LuCI's plain label", async () => {
  await run({ storage: fresh({ notices: [notice()] }), indicatorFontSize: "13px" }, (world) => {
    const [indicator] = world.indicators;
    assert.deepEqual([...indicator.classes], []);
    assert.match(indicator.textContent, /^Inbox \d+$/);
  });
});

test("a due check fetches the feed once, caches it and shows the count", async () => {
  const stale = { "aurora.hub.noticesChecked": JSON.stringify(Date.now() - 13 * HOUR) };
  for (const storage of [{}, stale]) {
    const before = Date.now();
    await run(
      {
        storage: { ...storage, "aurora.hub.inboxDone": JSON.stringify(["gone", "n9"]) },
        feed: [notice(), notice({ id: "n9" }), notice({ id: "bad id" })],
      },
      (world) => {
        assert.deepEqual(world.log.requires.slice(0, 2), ["utils.notices", "utils.hub-api"]);
        assert.deepEqual(world.log.rpc, ["get_init_data"]);
        assert.deepEqual(world.log.fetches, [FEED_URL]);
        assert.equal(world.indicators[0].attrs["data-count"], "1");

        const snapshot = JSON.parse(world.store.get("aurora.hub.notices")).value;
        assert.deepEqual(snapshot.notices.map((n) => n.id), ["n1", "n9"]);
        assert.equal("muted" in snapshot, false);
        assert.ok(JSON.parse(world.store.get("aurora.hub.noticesChecked")) >= before);
        assert.deepEqual(JSON.parse(world.store.get("aurora.hub.inboxDone")), ["n9"]);
      },
    );
  }
});

test("hub_me runs only when due, and then only for a creators notice or a router known to have shares", async () => {
  const rejected = { id: "s1", name: "Warm Paper", status: "active", assets_status: "rejected" };
  const reply = { result: 0, data: creator(rejected) };
  const cases = [
    { feed: [notice()], rpc: ["get_init_data"], count: "1" },
    { feed: [notice({ audience: "creators" })], rpc: ["get_init_data", "hub_me"], count: "1" },
    {
      feed: [notice()],
      storage: { "aurora.hub.me": cached(creator({ id: "s1", status: "active" })) },
      rpc: ["get_init_data", "hub_me"],
      count: "2",
    },
  ];
  for (const { feed, storage, rpc, count } of cases)
    await run({ feed, storage, me: reply }, (world) => {
      assert.deepEqual(world.log.rpc, rpc);
      assert.equal(world.indicators[0].attrs["data-count"], count);
    });

  // Not due: a creator's router still asks nothing.
  await run(
    { storage: fresh({ notices: [] }, { "aurora.hub.me": cached(creator(rejected)) }), me: reply },
    (world) => {
      assert.deepEqual(world.log.rpc, []);
      assert.equal(world.indicators[0].attrs["data-count"], "1");
    },
  );
});

test("the missing update source counts, from a probe made only when due and cached with the feed", async () => {
  const init = { feed: { pm: "apk", configured: false, channel: "" }, versions: {} };
  const world = await run({ init, feed: [] }, (w) => {
    assert.deepEqual(w.log.rpc, ["get_init_data"]);
    assert.equal(w.indicators[0].attrs["data-count"], "1");
    assert.equal(JSON.parse(w.store.get("aurora.hub.notices")).value.local.feedMissing, true);
  });

  // The pages of the next twelve hours count it from the cache: zero ubus.
  await run({ init, storage: Object.fromEntries(world.store) }, (next) => {
    assert.deepEqual(next.log.rpc, []);
    assert.deepEqual(next.log.fetches, []);
    assert.equal(next.indicators[0].attrs["data-count"], "1");
  });

  await run(
    { init: { feed: { pm: "apk", configured: true, channel: "snapshots" }, versions: {} }, feed: [] },
    (w) => assert.equal(w.indicators.length, 0),
  );
});

test("the preload never loads the Markdown renderer", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!/markdown/i.test(src));
  const hubApi = await readFile(srcPath("utils/hub-api.js"), "utf8");
  const noticesSrc = await readFile(srcPath("utils/notices.js"), "utf8");
  for (const dependency of [hubApi, noticesSrc]) assert.ok(!/require utils\.markdown/.test(dependency));
  await run({ feed: [notice({ body: "**bold** [x](https://a.b/)" })] }, (world) =>
    assert.ok(!world.log.requires.some((name) => name.includes("markdown"))),
  );
});

test("a hub without the endpoint, a dead network, a broken module: all silent", async () => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    for (const options of [
      { status: 404 },
      { status: 500 },
      { fetchFails: true },
      { requireFails: "utils.notices" },
      { requireFails: "utils.hub-api" },
      { requireFails: "ui", feed: [notice()] },
    ]) {
      const world = await boot(options);
      try {
        world.init();
        await assert.doesNotReject(world.loaded());
        await assert.doesNotReject(world.preload.update());
        assert.equal(world.indicators.length, 0);
      } finally {
        world.restore();
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rejections, []);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("a failed poll still shows what the caches already held", async () => {
  for (const options of [{ fetchFails: true }, { status: 500 }])
    await run(
      {
        ...options,
        storage: { "aurora.hub.notices": cached({ notices: [notice()] }) },
      },
      (world) => assert.equal(world.indicators[0].attrs["data-count"], "1"),
    );
});

test("the shipped preload stays small: it is parsed before every page's DOM init", async () => {
  // About 1 KB of this is the injected stylesheet -- the inbox glyph as a mask
  // data URI plus the badge -- which has to live here rather than in the theme,
  // or a new app on an old theme would show a black square.
  const BUDGET = 2560;
  const { size } = await stat(repo("htdocs/luci-static/resources/preload/aurora-notices.js"));
  assert.ok(size < BUDGET, `preload artifact is ${size} bytes; the budget is ${BUDGET}`);
});

test("the count is always on: the preload never reads uci, and a 1.2.x opt-out in the cache is ignored", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!/\buci\b|hub_notices|muted/.test(src), "no opt-out is read or honoured");

  // The world below would report hub_notices '0' if asked. Nobody asks.
  const stale = fresh({ notices: [notice()], muted: true });
  await run({ storage: stale }, (world) => {
    assert.equal(world.indicators[0].attrs["data-count"], "1");
    assert.ok(!world.log.requires.includes("uci"));
    assert.deepEqual(world.log.rpc, []);
  });

  // Due, with the same stale flag: fetched, shown, and the flag is gone from the cache.
  await run({ storage: { "aurora.hub.notices": cached({ notices: [], muted: true }) }, feed: [notice()] }, (world) => {
    assert.equal(world.indicators[0].attrs["data-count"], "1");
    assert.ok(!world.log.requires.includes("uci"));
    assert.ok(!world.log.rpc.some((call) => call.startsWith("uci")));
    assert.equal("muted" in JSON.parse(world.store.get("aurora.hub.notices")).value, false);
  });
});
