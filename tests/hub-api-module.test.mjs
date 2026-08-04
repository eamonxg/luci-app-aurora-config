import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SRC = "htdocs/luci-static/resources/utils/hub-api.js";

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

test("hub-api module keeps the list cache TTL logic", () => {
  return readFile(SRC, "utf8").then((src) => {
    assert.match(src, /CACHE_TTL\s*=\s*300000/);
    assert.match(src, /localStorage\.getItem\(CACHE_KEY\)/);
    assert.match(src, /localStorage\.setItem\(/);
    assert.match(src, /localStorage\.removeItem\(CACHE_KEY\)/);
  });
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

test("hub-api module exposes the share/my-shares/update/delete declares (Task 8)", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubShare"), "missing callHubShare");
  assert.match(src, /method:\s*"hub_share"/);
  assert.match(src, /params:\s*\["name", "description"\]/);
  assert.ok(src.includes("callHubMe"), "missing callHubMe");
  assert.match(src, /method:\s*"hub_me"/);
  assert.ok(src.includes("callHubUpdate"), "missing callHubUpdate");
  assert.match(src, /method:\s*"hub_update"/);
  assert.match(
    src,
    /params:\s*\["id", "name", "description"\]/,
    "callHubUpdate must resend the existing name and description so the hub PUT's required-name validation doesn't reject an id-only update",
  );
  assert.ok(src.includes("callHubDelete"), "missing callHubDelete");
  assert.match(src, /method:\s*"hub_delete"/);
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

test("hub-api: share/update drop the author parameter, nickname gets its own call", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /method:\s*"hub_share",\s*\n\s*params:\s*\["name", "description"\]/);
  assert.match(src, /method:\s*"hub_update",\s*\n\s*params:\s*\["id", "name", "description"\]/);
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
