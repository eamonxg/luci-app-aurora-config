import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { srcPath } from "./paths.mjs";

const SRC = srcPath("utils/notices.js");

// Same harness as feed-check-module.test.mjs: the module is pure, so the tests
// run it instead of pattern-matching its source.
async function load() {
  const src = await readFile(SRC, "utf8");
  const body = src
    .replace(/^"use strict";$/m, "")
    .replace(/^"require [^"]+";$/gm, "");
  return new Function("baseclass", body)({ extend: (obj) => obj });
}

const notice = (over) => ({
  id: "n1",
  level: "warning",
  audience: "all",
  title: "Schema 1 is going away",
  body: "Update your shares before the sunset date.",
  url: "https://themes.eamonxg.fun/notices/n1",
  i18n: {},
  ...over,
});

test("notices.js is pure: baseclass is its only dependency, no DOM, no network, no storage", async () => {
  const src = await readFile(SRC, "utf8");
  const requires = [...src.matchAll(/^"require ([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(requires, ["baseclass"]);
  for (const forbidden of ["document", "window", "localStorage", "fetch(", "rpc", "innerHTML"])
    assert.ok(!src.includes(forbidden), `notices.js must not touch ${forbidden}`);
});

test("localize prefers the exact language, then its base, then the English defaults", async () => {
  const m = await load();
  const n = notice({
    i18n: {
      "zh-cn": { title: "简体标题", body: "简体正文" },
      zh: { title: "中文标题", body: "中文正文" },
      de: { title: "Titel" },
    },
  });
  assert.deepEqual(m.localize(n, "zh-cn"), { title: "简体标题", body: "简体正文" });
  assert.deepEqual(m.localize(n, "zh-tw"), { title: "中文标题", body: "中文正文" });
  assert.deepEqual(m.localize(n, "en"), { title: n.title, body: n.body });
  assert.deepEqual(m.localize(n, "fr"), { title: n.title, body: n.body });
  // Per field: a locale that only translated the title keeps the English body.
  assert.deepEqual(m.localize(n, "de"), { title: "Titel", body: n.body });
});

test("localize accepts LuCI's own spelling of a language code", async () => {
  const m = await load();
  const n = notice({ i18n: { "zh-cn": { title: "简体标题", body: "简体正文" } } });
  // dispatcher.lang, and therefore <html lang>, is "zh_cn".
  assert.equal(m.localize(n, "zh_cn").title, "简体标题");
  assert.equal(m.localize(n, "ZH_CN").title, "简体标题");
  for (const lang of [undefined, null, "", 42, {}])
    assert.deepEqual(m.localize(n, lang), { title: n.title, body: n.body });
});

test("localize ignores values that are not strings", async () => {
  const m = await load();
  const n = notice({
    i18n: {
      "zh-cn": { title: { toString: () => "<b>x</b>" }, body: 7 },
      zh: { title: "", body: ["x"] },
    },
  });
  assert.deepEqual(m.localize(n, "zh-cn"), { title: n.title, body: n.body });
  assert.deepEqual(m.localize(notice({ i18n: "zh-cn" }), "zh-cn"), {
    title: n.title,
    body: n.body,
  });
  assert.deepEqual(m.localize(notice({ i18n: null }), "zh-cn"), { title: n.title, body: n.body });
  assert.deepEqual(m.localize(null, "en"), { title: "", body: "" });
  assert.deepEqual(m.localize({ title: 1, body: {} }, "en"), { title: "", body: "" });
  // A language code that names an Object.prototype member must not resolve to it.
  assert.deepEqual(m.localize(n, "constructor"), { title: n.title, body: n.body });
  assert.deepEqual(m.localize(n, "__proto__"), { title: n.title, body: n.body });
});

test("safeUrl lets through https URLs and LuCI-relative admin/ paths", async () => {
  const m = await load();
  assert.equal(m.safeUrl("https://example.com/a?b=1#c"), "https://example.com/a?b=1#c");
  assert.equal(m.safeUrl("https://example.com"), "https://example.com");
  assert.equal(m.safeUrl("admin/system/aurora/marketplace"), "admin/system/aurora/marketplace");
  assert.equal(
    m.safeUrl("admin/system/aurora/marketplace?share=1"),
    "admin/system/aurora/marketplace?share=1",
  );
  assert.equal(m.isExternalUrl("https://example.com"), true);
  assert.equal(m.isExternalUrl("admin/system"), false);
  assert.equal(m.isExternalUrl(""), false);
  assert.equal(m.isExternalUrl(null), false);
});

test("safeUrl rejects everything else", async () => {
  const m = await load();
  const hostile = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "http://example.com/",
    "HTTPS://example.com/",
    "//evil.example/x",
    "/admin/system",
    "\\\\evil.example\\x",
    "https:/example.com",
    "https:example.com",
    "https://",
    "https://user:pass@example.com/",
    "https://user@example.com/",
    "https://:pass@example.com/",
    "https://exa mple.com/",
    "https://example.com/\u0000",
    "https://example.com/\n",
    "https://example.com\\@evil.example/",
    "admin/../../etc/passwd",
    "admin//evil.example",
    "admin/x\\y",
    "admin/<script>",
    'admin/"onclick="x',
    "admin/system aurora",
    "admin",
    "administrator/x",
    "ftp://example.com/",
    "",
  ];
  for (const url of hostile) assert.equal(m.safeUrl(url), "", JSON.stringify(url));
  for (const url of [null, undefined, 1, {}, [], { toString: () => "https://example.com" }])
    assert.equal(m.safeUrl(url), "", String(url));
});

test("sanitize keeps well-formed notices and only the fields the client reads", async () => {
  const m = await load();
  const out = m.sanitize([
    notice({
      i18n: { "zh-cn": { title: "标题", body: "正文", html: "<b>x</b>" } },
      starts_at: null,
      expires_at: "2026-12-01 00:00:00",
      __proto__: { polluted: true },
      extra: { nested: "junk" },
    }),
  ]);
  assert.deepEqual(out, [
    {
      id: "n1",
      level: "warning",
      audience: "all",
      title: "Schema 1 is going away",
      body: "Update your shares before the sunset date.",
      url: "https://themes.eamonxg.fun/notices/n1",
      i18n: { "zh-cn": { title: "标题", body: "正文" } },
      at: "",
    },
  ]);
});

test("sanitize keeps one timestamp: when the notice went live", async () => {
  const m = await load();
  const at = (over) => m.sanitize([notice(over)])[0].at;
  assert.equal(at({ created_at: "2026-09-19 08:00:00" }), "2026-09-19 08:00:00");
  assert.equal(
    at({ created_at: "2026-09-01 00:00:00", starts_at: "2026-09-19 08:00:00" }),
    "2026-09-19 08:00:00",
    "a scheduled notice is as old as its start, not as its draft",
  );
  assert.equal(at({ created_at: "2026-09-19T08:00:00Z" }), "2026-09-19T08:00:00");
  // Round trip: what the cache hands back sanitizes to the same thing.
  assert.equal(at({ at: "2026-09-19 08:00:00" }), "2026-09-19 08:00:00");
  for (const junk of [null, 5, "yesterday", "<b>2026</b>", {}, ["2026-09-19 08:00:00"]])
    assert.equal(at({ created_at: junk }), "", String(junk));
  assert.equal(at({ created_at: "2026-09-19 08:00:00<script>" }), "2026-09-19 08:00:00");
});

test("sanitize drops malformed entries", async () => {
  const m = await load();
  const bad = [
    null,
    undefined,
    "n1",
    7,
    [],
    notice({ id: "" }),
    notice({ id: "has-dash" }),
    notice({ id: 'x"]<img src=x>' }),
    notice({ id: "a".repeat(33) }),
    notice({ id: 12345 }),
    notice({ id: ["n1"] }),
    notice({ level: "fatal" }),
    notice({ level: undefined }),
    notice({ level: ["warning"] }),
    notice({ audience: "everyone" }),
    notice({ audience: null }),
    notice({ title: "" }),
    notice({ title: "   " }),
    notice({ title: "x".repeat(121) }),
    notice({ title: 5 }),
    notice({ title: { toString: () => "title" } }),
    notice({ body: "x".repeat(4001) }),
    notice({ body: null }),
    notice({ body: ["x"] }),
  ];
  assert.deepEqual(m.sanitize(bad), []);
  for (const notList of [null, undefined, {}, "[]", 3, { length: 1, 0: notice() }])
    assert.deepEqual(m.sanitize(notList), []);
});

test("sanitize measures length in characters, not UTF-16 units", async () => {
  const m = await load();
  assert.equal(m.sanitize([notice({ title: "😀".repeat(120) })]).length, 1);
  assert.equal(m.sanitize([notice({ title: "😀".repeat(121) })]).length, 0);
  assert.equal(m.sanitize([notice({ body: "" })]).length, 1);
  assert.equal(m.sanitize([notice({ body: "x".repeat(4000) })]).length, 1);
  assert.equal(m.sanitize([notice({ body: "😀".repeat(4000) })]).length, 1);
});

test("sanitize keeps markup as the plain string it is, and tolerates a junk url", async () => {
  const m = await load();
  const title = '<img src=x onerror="alert(1)">';
  const [kept] = m.sanitize([notice({ title, body: "<script>alert(1)</script>", url: 42 })]);
  assert.equal(kept.title, title);
  assert.equal(kept.body, "<script>alert(1)</script>");
  assert.equal(kept.url, "");
  // The url is judged where it is rendered, so a hostile one survives sanitize
  // and dies in safeUrl.
  const [hostile] = m.sanitize([notice({ url: "javascript:alert(1)" })]);
  assert.equal(m.safeUrl(hostile.url), "");
});

test("sanitize filters i18n down to valid language keys and string fields", async () => {
  const m = await load();
  const [kept] = m.sanitize([
    notice({
      i18n: {
        "zh-cn": { title: "标题" },
        ZH: { title: "大写键" },
        "zh_cn": { title: "下划线键" },
        constructor: { title: "x" },
        fr: { title: 5, body: { a: 1 } },
        de: "Titel",
        ja: { title: "x".repeat(121), body: "本文" },
        ko: null,
      },
    }),
  ]);
  assert.deepEqual(kept.i18n, { "zh-cn": { title: "标题" }, ja: { body: "本文" } });
  assert.deepEqual(m.sanitize([notice({ i18n: [] })])[0].i18n, {});
  assert.deepEqual(m.sanitize([notice({ i18n: "x" })])[0].i18n, {});
  assert.deepEqual(m.sanitize([notice({ i18n: undefined })])[0].i18n, {});
});

test("sanitize caps the list and drops repeated ids", async () => {
  const m = await load();
  const many = Array.from({ length: 500 }, (_, i) => notice({ id: "n" + i }));
  const out = m.sanitize(many);
  assert.equal(out.length, m.MAX_NOTICES);
  assert.equal(m.MAX_NOTICES, 20);
  // Newest first on the wire, so the cap keeps the head.
  assert.equal(out[0].id, "n0");
  assert.equal(out[19].id, "n19");

  const dupes = m.sanitize([notice({ title: "first" }), notice({ title: "second" })]);
  assert.deepEqual(dupes.map((n) => n.title), ["first"]);
  // An id that names an Object.prototype member is still just an id.
  assert.equal(m.sanitize([notice({ id: "constructor" })]).length, 1);

  // Malformed entries do not count towards the cap.
  const padded = [...Array.from({ length: 100 }, () => null), ...many];
  assert.equal(m.sanitize(padded).length, 20);
});

test("isDue throttles to one check per twelve hours", async () => {
  const m = await load();
  const HOUR = 60 * 60 * 1000;
  assert.equal(m.POLL_INTERVAL_MS, 12 * HOUR);
  const now = Date.UTC(2026, 8, 19, 12);
  assert.equal(m.isDue(now - 1, now), false);
  assert.equal(m.isDue(now - 11 * HOUR, now), false);
  assert.equal(m.isDue(now - 12 * HOUR + 1, now), false);
  assert.equal(m.isDue(now - 12 * HOUR, now), true);
  assert.equal(m.isDue(now - 48 * HOUR, now), true);
});

test("isDue treats a missing, corrupt or future timestamp as due", async () => {
  const m = await load();
  const now = Date.UTC(2026, 8, 19, 12);
  for (const last of [0, -5, NaN, Infinity, null, undefined, "1700000000000", {}])
    assert.equal(m.isDue(last, now), true, String(last));
  // A clock that was set back must not silence the check forever.
  assert.equal(m.isDue(now + 1000, now), true);
  assert.equal(m.isDue(now - 1000, NaN), true);
});

test("creatorAffected reads compat_summary", async () => {
  const m = await load();
  const summary = (deprecated, unsupported) => ({
    compat_summary: { current_schema: 2, deprecated, unsupported },
    configs: [],
  });
  assert.equal(m.creatorAffected(summary(0, 0)), false);
  assert.equal(m.creatorAffected(summary(1, 0)), true);
  assert.equal(m.creatorAffected(summary(0, 3)), true);
  assert.equal(m.creatorAffected(summary("1", "x")), false);
  assert.equal(m.creatorAffected(summary(NaN, null)), false);
  assert.equal(m.creatorAffected(summary(-1, 0)), false);
});

test("creatorAffected falls back to the per-config compat state", async () => {
  const m = await load();
  const me = (...states) => ({
    configs: states.map((state, i) => ({ id: "c" + i, status: "active", compat: { state } })),
  });
  assert.equal(m.creatorAffected(me("ok", "ok")), false);
  assert.equal(m.creatorAffected(me("ok", "deprecated")), true);
  assert.equal(m.creatorAffected(me("unsupported")), true);
  // Anything the hub may call it later still means "not fine".
  assert.equal(m.creatorAffected(me("retired")), true);
  // A share that was taken down has no update button to send its author to.
  assert.equal(
    m.creatorAffected({ configs: [{ status: "removed", compat: { state: "deprecated" } }] }),
    false,
  );
});

test("creatorAffected tolerates an old hub that sends none of the new fields", async () => {
  const m = await load();
  assert.equal(m.creatorAffected({ id: "abc", nickname: "eamon", configs: [{ id: "x" }] }), false);
  assert.equal(m.creatorAffected({ id: "abc", nickname: null, configs: [] }), false);
  assert.equal(m.creatorAffected({}), false);
  for (const junk of [null, undefined, "me", 1, [], { configs: "x" }, { compat_summary: [] }])
    assert.equal(m.creatorAffected(junk), false, String(junk));
  assert.equal(
    m.creatorAffected({ configs: [null, 1, { compat: null }, { compat: "deprecated" }, { compat: { state: 1 } }] }),
    false,
  );
});

test("compatBadge names the two states a share card has to mention", async () => {
  const m = await load();
  assert.equal(m.compatBadge({ compat: { state: "deprecated", sunset_at: "2026-12-01 00:00:00" } }), "deprecated");
  assert.equal(m.compatBadge({ compat: { state: "unsupported" } }), "unsupported");
  assert.equal(m.compatBadge({ compat: { state: "ok" } }), null);
  assert.equal(m.compatBadge({ compat: { state: "retired" } }), null);
  assert.equal(m.compatBadge({ compat: { state: ["deprecated"] } }), null);
  assert.equal(m.compatBadge({ compat: "deprecated" }), null);
  assert.equal(m.compatBadge({ id: "x" }), null);
  assert.equal(m.compatBadge({}), null);
  assert.equal(m.compatBadge(null), null);
  assert.equal(m.compatBadge(undefined), null);
});

test("sunsetDate shows the day and nothing else the hub may have put there", async () => {
  const m = await load();
  const at = (sunset_at) => ({ compat: { state: "deprecated", sunset_at } });
  assert.equal(m.sunsetDate(at("2026-12-01 00:00:00")), "2026-12-01");
  assert.equal(m.sunsetDate(at("2026-12-01T00:00:00Z")), "2026-12-01");
  assert.equal(m.sunsetDate(at("2026-12-01")), "2026-12-01");
  for (const junk of [
    null,
    undefined,
    "",
    "soon",
    "2026-12-01<script>",
    "2026-12-011",
    " 2026-12-01",
    "12/01/2026",
    20261201,
    { toString: () => "2026-12-01" },
  ])
    assert.equal(m.sunsetDate(at(junk)), "", String(junk));
  assert.equal(m.sunsetDate({}), "");
  assert.equal(m.sunsetDate(null), "");
});

// ---------------------------------------------------------------------------
// Inbox: derivation, keys, read/done bookkeeping, pruning, counts

const share = (over) => ({
  id: "c1",
  name: "Nord Night",
  downloads: 3,
  status: "active",
  assets_status: "none",
  compat: { state: "ok", sunset_at: null },
  ...over,
});

const profile = (...configs) => ({ id: "me", nickname: "eamon", configs });

test("present localizes, keeps the body as the Markdown it is, and vets the link", async () => {
  const m = await load();
  assert.deepEqual(
    m.present(notice({ body: "One.\n\n- **two**", i18n: { zh: { title: "标题" } } }), "zh_cn"),
    {
      title: "标题",
      body: "One.\n\n- **two**",
      url: "https://themes.eamonxg.fun/notices/n1",
      external: true,
    },
  );
  assert.equal(m.present(notice({ i18n: { zh: { body: "**正文**" } } }), "zh-cn").body, "**正文**");
  assert.equal(m.present(notice({ url: "javascript:alert(1)" }), "en").url, "");
  assert.equal(m.present(notice({ url: "admin/system" }), "en").external, false);
  assert.deepEqual(m.present(null, "en"), { title: "", body: "", url: "", external: false });
});

test("compatCounts trusts the hub's summary, counts for itself without one, and finds the first deadline", async () => {
  const m = await load();
  const me = profile(
    share({ id: "a", compat: { state: "deprecated", sunset_at: "2027-01-15 00:00:00" } }),
    share({ id: "b", compat: { state: "deprecated", sunset_at: "2026-12-01 00:00:00" } }),
    share({ id: "c", compat: { state: "unsupported", sunset_at: "2026-01-01 00:00:00" } }),
    share({ id: "d", status: "removed", compat: { state: "unsupported" } }),
    share({ id: "e" }),
    null,
  );
  assert.deepEqual(m.compatCounts(me), { deprecated: 2, unsupported: 1, sunset: "2026-12-01" });
  assert.deepEqual(
    m.compatCounts({ ...me, compat_summary: { current_schema: 2, deprecated: 5, unsupported: 0 } }),
    { deprecated: 5, unsupported: 0, sunset: "2026-12-01" },
  );
  for (const junk of [
    null,
    undefined,
    "me",
    [],
    {},
    { configs: "x" },
    { compat_summary: { deprecated: "3", unsupported: -1 } },
    { compat_summary: { deprecated: 1.5, unsupported: NaN } },
  ])
    assert.deepEqual(m.compatCounts(junk), { deprecated: 0, unsupported: 0, sunset: "" });
});

test("hasShares is what tells the preload this router belongs to a creator", async () => {
  const m = await load();
  assert.equal(m.hasShares(profile(share())), true);
  assert.equal(m.hasShares(profile(share({ status: "removed" }))), true);
  assert.equal(m.hasShares(profile()), false);
  assert.equal(m.hasShares(profile({ id: "bad id" }, null, "x")), false);
  for (const junk of [null, undefined, {}, { configs: {} }, "me"]) assert.equal(m.hasShares(junk), false);
});

test("derive: one summary item per compat state, keyed by the set of affected shares", async () => {
  const m = await load();
  const me = profile(
    share({ id: "b2", name: "Warm Paper", compat: { state: "deprecated", sunset_at: "2027-01-01 00:00:00" } }),
    share({ id: "a1", name: "Nord Night", compat: { state: "deprecated", sunset_at: "2026-12-01 00:00:00" } }),
    share({ id: "u9", name: "Old One", compat: { state: "unsupported" } }),
    share({ id: "ok" }),
  );
  const items = m.derive(me);
  assert.deepEqual(items, [
    {
      key: "compat:unsupported:" + m.shortHash("u9"),
      group: "action",
      source: "shares",
      kind: "compat",
      state: "unsupported",
      level: "critical",
      names: ["Old One"],
      sunset: "",
    },
    {
      key: "compat:deprecated:" + m.shortHash("a1,b2"),
      group: "action",
      source: "shares",
      kind: "compat",
      state: "deprecated",
      level: "critical",
      names: ["Warm Paper", "Nord Night"],
      sunset: "2026-12-01",
    },
  ]);
  assert.match(items[0].key, /^compat:unsupported:[0-9a-z]{1,7}$/);

  // Same set in another order: same key. A share fixed, or a new one affected:
  // a new key, so a Done'd summary comes back.
  const reordered = profile(me.configs[1], me.configs[0], me.configs[2]);
  assert.equal(m.derive(reordered)[1].key, items[1].key);
  const oneFixed = profile(me.configs[0], me.configs[2]);
  assert.notEqual(m.derive(oneFixed)[1].key, items[1].key);
  assert.equal(m.derive(oneFixed)[0].key, items[0].key);
});

test("derive: rejected assets carry the reviewer's words, takedowns stand alone", async () => {
  const m = await load();
  const reason = 'login background is 640×360 <img src=x onerror="alert(1)">';
  const items = m.derive(
    profile(
      share({ id: "r1", name: "Warm Paper", assets_status: "rejected", assets_reject_reason: reason }),
      share({ id: "r2", name: "No Note", assets_status: "rejected" }),
      share({ id: "p1", assets_status: "pending" }),
      share({ id: "t1", name: "Taken", status: "removed", assets_status: "rejected", compat: { state: "unsupported" } }),
    ),
  );
  assert.deepEqual(items, [
    { key: "rejected:r1", group: "action", source: "shares", kind: "rejected", level: "warning", name: "Warm Paper", reason },
    { key: "rejected:r2", group: "action", source: "shares", kind: "rejected", level: "warning", name: "No Note", reason: "" },
    { key: "removed:t1", group: "action", source: "shares", kind: "removed", level: "warning", name: "Taken" },
  ]);
});

test("derive treats the hub_me reply as untrusted", async () => {
  const m = await load();
  for (const junk of [null, undefined, "me", 7, [], {}, { configs: "x" }, { configs: [null, 1, "c"] }])
    assert.deepEqual(m.derive(junk), []);
  const items = m.derive(
    profile(
      share({ id: 'x"]<b>', status: "removed" }),
      share({ id: "a".repeat(33), assets_status: "rejected" }),
      share({ id: "ok1", name: { toString: () => "<b>" }, status: "removed" }),
      share({ id: "ok2", assets_status: "rejected", assets_reject_reason: "x".repeat(1001) }),
      share({ id: "ok3", assets_status: "rejected", assets_reject_reason: ["nope"] }),
    ),
  );
  assert.deepEqual(items.map((item) => item.key), ["rejected:ok2", "rejected:ok3", "removed:ok1"]);
  assert.equal(items[2].name, "");
  assert.equal(items[0].reason, "");
  assert.equal(items[1].reason, "");
});

test("inbox: Needs action first, Updates after, creators broadcasts only for affected routers", async () => {
  const m = await load();
  const snapshot = {
    notices: [
      notice({ id: "w1" }),
      notice({ id: "cr1", audience: "creators" }),
      notice({ id: "i1", level: "info", created_at: "2026-09-19 08:00:00" }),
      notice({ id: "bad id" }),
    ],
  };
  const affected = profile(share({ id: "a1", compat: { state: "deprecated" } }));
  const keys = (items) => items.map((item) => item.group + "/" + item.key);

  assert.deepEqual(keys(m.inbox(snapshot, affected, null)), [
    "action/compat:deprecated:" + m.shortHash("a1"),
    "updates/w1",
    "updates/cr1",
    "updates/i1",
  ]);
  assert.deepEqual(keys(m.inbox(snapshot, profile(share()), null)), ["updates/w1", "updates/i1"]);
  assert.deepEqual(keys(m.inbox(snapshot, null, null)), ["updates/w1", "updates/i1"]);

  const info = m.inbox(snapshot, null, null)[1];
  assert.equal(info.kind, "notice");
  assert.equal(info.level, "info");
  assert.equal(info.at, "2026-09-19 08:00:00");
  assert.equal(info.notice.id, "i1");

  for (const junk of [null, undefined, "x", [], {}, { notices: "x" }])
    assert.deepEqual(m.inbox(junk, null, null), []);
});

test("inbox: read and done are per key; done hides, and a changed key brings the item back", async () => {
  const m = await load();
  const snapshot = { notices: [notice({ id: "w1" }), notice({ id: "w2" })] };
  const before = profile(share({ id: "a1", compat: { state: "unsupported" } }));
  const compatKey = "compat:unsupported:" + m.shortHash("a1");

  const items = m.inbox(snapshot, before, { read: ["w1"], done: ["w2", compatKey] });
  assert.deepEqual(items.map((item) => [item.key, item.unread]), [["w1", false]]);
  assert.equal(m.unreadCount(items), 0);

  const after = profile(before.configs[0], share({ id: "b2", compat: { state: "unsupported" } }));
  const again = m.inbox(snapshot, after, { read: ["w1"], done: ["w2", compatKey] });
  assert.deepEqual(again.map((item) => [item.key, item.unread]), [
    ["compat:unsupported:" + m.shortHash("a1,b2"), true],
    ["w1", false],
  ]);
  assert.equal(m.unreadCount(again), 1);

  // A corrupt store is an empty store.
  const loose = m.inbox(snapshot, null, { read: "w1", done: { 0: "w2" } });
  assert.deepEqual(loose.map((item) => [item.key, item.unread]), [
    ["w1", true],
    ["w2", true],
  ]);
  assert.equal(m.unreadCount(null), 0);
  assert.equal(m.unreadCount([null, { unread: true }, { unread: false }]), 1);
});

test("badgeCount: unread Needs-action plus unread warning/critical broadcasts, never info", async () => {
  const m = await load();
  const snapshot = {
    notices: [
      notice({ id: "w1" }),
      notice({ id: "c1", level: "critical" }),
      notice({ id: "i1", level: "info" }),
      notice({ id: "i2", level: "info" }),
    ],
  };
  const me = profile(
    share({ id: "r1", assets_status: "rejected" }),
    share({ id: "t1", status: "removed" }),
  );
  const none = { read: [], done: [] };
  assert.equal(m.badgeCount(snapshot, me, none), 4);
  assert.equal(m.badgeCount(snapshot, null, none), 2);
  assert.equal(m.badgeCount(snapshot, me, { read: ["w1", "rejected:r1"], done: [] }), 2);
  assert.equal(m.badgeCount(snapshot, me, { read: [], done: ["c1", "removed:t1"] }), 2);
  // 1.2.x could cache an opt-out; there is none any more, so it counts.
  assert.equal(m.badgeCount({ ...snapshot, muted: true }, me, none), 4);
  assert.equal(m.badgeCount({ notices: [notice({ level: "info" })] }, null, none), 0);
  for (const junk of [null, undefined, "x", []]) assert.equal(m.badgeCount(junk, me, none), 0);
  // No feed yet, but a creator's own items still count.
  assert.equal(m.badgeCount({}, me, none), 2);
});

test("key lists: add once, remove, mark everything", async () => {
  const m = await load();
  assert.deepEqual(m.withKey(["a"], "b"), ["a", "b"]);
  assert.deepEqual(m.withKey(["a", "b"], "b"), ["a", "b"]);
  assert.deepEqual(m.withKey(null, "a"), ["a"]);
  assert.deepEqual(m.withKey(["a", 1, null], { toString: () => "x" }), ["a"]);
  assert.deepEqual(m.withoutKey(["a", "b", "a"], "a"), ["b"]);
  assert.deepEqual(m.withoutKey("a", "a"), []);
  assert.deepEqual(m.withKeys(["a"], [{ key: "b" }, { key: "a" }, null, { key: 5 }, { key: "c" }]), ["a", "b", "c"]);
  assert.deepEqual(m.withKeys(["a"], null), ["a"]);
  const input = ["a"];
  m.withKey(input, "b");
  assert.deepEqual(input, ["a"], "the stored list is never mutated in place");
});

test("pruneKeys forgets keys whose item is gone -- but only for a source that actually answered", async () => {
  const m = await load();
  const keys = ["w1", "gone", "rejected:r1", "rejected:old", "compat:deprecated:abc", "w1"];
  const active = ["w1", "rejected:r1"];
  assert.deepEqual(m.pruneKeys(keys, active, { feed: true, me: true }), ["w1", "rejected:r1"]);
  // hub_me failed or was not asked: every derived key is kept, or one offline
  // page load would hand back everything the author had marked Done.
  assert.deepEqual(m.pruneKeys(keys, active, { feed: true, me: false }), [
    "w1",
    "rejected:r1",
    "rejected:old",
    "compat:deprecated:abc",
  ]);
  assert.deepEqual(m.pruneKeys(keys, active, { feed: false, me: true }), ["w1", "gone", "rejected:r1"]);
  assert.deepEqual(m.pruneKeys(keys, active, null), ["w1", "gone", "rejected:r1", "rejected:old", "compat:deprecated:abc"]);
  assert.deepEqual(m.pruneKeys(["a", 1, null, {}], ["a"], { feed: true, me: true }), ["a"]);
  assert.deepEqual(m.pruneKeys(null, null, { feed: true, me: true }), []);
  // The router's own item has a source of its own: a failed hub_me says
  // nothing about it, and a failed local probe keeps it.
  const all = { feed: true, me: true, local: true };
  assert.deepEqual(m.pruneKeys(["feed:missing"], [], all), []);
  assert.deepEqual(m.pruneKeys(["feed:missing"], [], { ...all, local: false }), ["feed:missing"]);
  assert.deepEqual(m.pruneKeys(["feed:missing"], [], { ...all, me: false }), []);
  assert.deepEqual(m.pruneKeys(["feed:missing"], ["feed:missing"], all), ["feed:missing"]);
});

test("stampMs reads the hub's UTC timestamps; ageOf picks the coarsest unit that fits", async () => {
  const m = await load();
  assert.equal(m.stampMs("2026-09-19 08:00:00"), Date.UTC(2026, 8, 19, 8, 0, 0));
  assert.equal(m.stampMs("2026-09-19T08:00:00Z"), Date.UTC(2026, 8, 19, 8, 0, 0));
  assert.equal(m.stampMs("2026-09-19"), Date.UTC(2026, 8, 19));
  for (const junk of ["", "soon", null, undefined, 5, {}, "19/09/2026"]) assert.equal(m.stampMs(junk), null);

  const now = Date.UTC(2026, 8, 19, 12);
  const MIN = 60 * 1000;
  assert.deepEqual(m.ageOf(now - 30 * 1000, now), { value: 0, unit: "minute" });
  assert.deepEqual(m.ageOf(now - 5 * MIN, now), { value: -5, unit: "minute" });
  assert.deepEqual(m.ageOf(now - 125 * MIN, now), { value: -2, unit: "hour" });
  assert.deepEqual(m.ageOf(now - 26 * 60 * MIN, now), { value: -1, unit: "day" });
  assert.deepEqual(m.ageOf(now - 15 * 24 * 60 * MIN, now), { value: -2, unit: "week" });
  // A notice dated ahead of this browser's clock is "now", not "in 3 hours".
  assert.deepEqual(m.ageOf(now + 3 * 60 * MIN, now), { value: 0, unit: "minute" });
  assert.equal(m.ageOf(null, now), null);
  assert.equal(m.ageOf(now, NaN), null);
});

test("shortHash is stable and short", async () => {
  const m = await load();
  assert.equal(m.shortHash("a1,b2"), m.shortHash("a1,b2"));
  assert.notEqual(m.shortHash("a1,b2"), m.shortHash("a1,b3"));
  assert.match(m.shortHash(""), /^[0-9a-z]{1,7}$/);
  assert.match(m.shortHash("x".repeat(5000)), /^[0-9a-z]{1,7}$/);
});

test("localState: the feed verdict comes from get_init_data, and not knowing is not 'missing'", async () => {
  const m = await load();
  const reply = (feed, versions) => ({ active_preset: "default", feed, versions });
  const versions = {
    theme: { installed_version: "1.3.8-r20260901" },
    config: { installed_version: "1.2.0-r20260902", i18n_packages: "zh-cn" },
  };
  assert.deepEqual(m.localState(reply({ pm: "apk", configured: false, channel: "" }, versions)), {
    feedMissing: true,
    theme: "1.3.8-r20260901",
    app: "1.2.0-r20260902",
  });
  assert.equal(m.localState(reply({ pm: "opkg", configured: true, channel: "releases" }, versions)).feedMissing, false);
  // Studio's banner used the same rule: an unknown package manager says nothing.
  for (const unknown of [
    null,
    undefined,
    {},
    { result: 1 },
    reply(null, versions),
    reply({ pm: "unknown", configured: false }, versions),
    reply({ pm: "", configured: false }, versions),
    reply({ configured: false }, versions),
    reply("apk", versions),
  ])
    assert.equal(m.localState(unknown), null);
  assert.deepEqual(m.localState(reply({ pm: "apk", configured: "no" }, { theme: { installed_version: 7 }, config: "x" })), {
    feedMissing: true,
    theme: "",
    app: "",
  });
  assert.equal(m.localState(reply({ pm: "apk" }, { theme: { installed_version: "v".repeat(65) } })).theme, "");
});

test("the feed item: one Needs-action entry from this router, first in the list, gone once the source exists", async () => {
  const m = await load();
  const local = { feedMissing: true, theme: "1.3.8", app: "1.2.0" };
  assert.deepEqual(m.deriveLocal(local), [
    { key: "feed:missing", group: "action", source: "router", kind: "feed", level: "warning", theme: "1.3.8", app: "1.2.0" },
  ]);
  assert.equal(m.FEED_KEY, "feed:missing");
  for (const none of [null, undefined, {}, "x", [], { feedMissing: false }, { feedMissing: "true" }, { feedMissing: 1 }])
    assert.deepEqual(m.deriveLocal(none), []);
  assert.deepEqual(m.deriveLocal({ feedMissing: true, theme: 5 })[0].theme, "");

  const snapshot = { local, notices: [notice({ id: "w1" })] };
  const me = profile(share({ id: "r1", assets_status: "rejected" }));
  assert.deepEqual(
    m.inbox(snapshot, me, null).map((item) => item.source + "/" + item.key),
    ["router/feed:missing", "shares/rejected:r1", "store/w1"],
  );
  assert.equal(m.badgeCount(snapshot, null, { read: [], done: [] }), 2);
  assert.equal(m.badgeCount(snapshot, null, { read: ["feed:missing"], done: [] }), 1);
  assert.equal(m.badgeCount(snapshot, null, { read: [], done: ["feed:missing"] }), 1);
  assert.equal(m.badgeCount({ ...snapshot, local: { ...local, feedMissing: false } }, null, null), 1);
});

test("the reviewer's note keeps its own, smaller cap", async () => {
  const m = await load();
  const reasonOf = (text) =>
    m.derive(profile(share({ id: "r1", assets_status: "rejected", assets_reject_reason: text })))[0].reason;
  assert.equal(reasonOf("x".repeat(1000)).length, 1000);
  assert.equal(reasonOf("x".repeat(1001)), "");
});
