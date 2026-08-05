import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
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
  path.join(repoRoot, ".dev/src/resource/utils/hub-api.js"),
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

// ⚠️ 陷阱:被删的 hub_get 与仍在的 hub_apply_worker 使用的是逐字相同的一行
// —— hub_http_get "/api/v1/themes/aurora/configs/$id"。所以「详情 URL 是否
// 消失」不能作为删除判据,上面那条测试只认 case 标签 '"hub_get")'。反过来,
// 这行的存在正好证明 apply 路径没被误删。
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
