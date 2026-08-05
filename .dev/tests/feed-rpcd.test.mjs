import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

const RPCD = repo("root/usr/libexec/rpcd/luci.aurora");

test("rpcd: the package manager is detected from its database, like install.sh", async () => {
  const src = await readFile(RPCD, "utf8");
  const block = src.slice(
    src.indexOf("detect_package_manager()"),
    src.indexOf("get_system_lang()"),
  );
  assert.match(block, /\/lib\/apk\/db\/installed/);
  assert.match(block, /\/usr\/lib\/opkg\/status/);
  assert.ok(
    !/command -v (opkg|apk)/.test(block),
    "binary probing can disagree with install.sh on the same machine",
  );
});

test("rpcd: apk versions are read from the database, not by spawning apk", async () => {
  const src = await readFile(RPCD, "utf8");
  // Match a command substitution, not the words: the comment above the awk
  // block names the call it replaced, and that is worth keeping.
  assert.ok(
    !/\$\(apk list -I/.test(src),
    "spawning apk parses the whole installed db on every page load",
  );
  // Verified on a live snapshot router: records are P:<name> then V:<version>.
  assert.match(src, /\^P:/, "records are keyed by the P: field");
  assert.match(src, /\^V:/, "versions come from the V: field");
});

test("rpcd: feed status rides along on get_init_data", async () => {
  const src = await readFile(RPCD, "utf8");
  assert.match(src, /json_add_feed_status\(\)/, "missing the status helper");
  assert.match(
    src,
    /json_add_installed_versions[\s\S]{0,200}json_add_feed_status/,
    "feed status must be emitted inside the existing init-data call",
  );
  assert.ok(
    !/"get_feed_status"/.test(src),
    "a separate method would add a round trip on every page load",
  );
});

test("rpcd: feed constants match the spec", async () => {
  const src = await readFile(RPCD, "utf8");
  assert.match(src, /AURORA_FEED_HOST=["']?openwrt\.eamonxg\.fun/);
  assert.match(src, /AURORA_FEED_FPR=["']?82d72f5ededb6163/);
  assert.match(src, /AURORA_FEED_CHANNEL=["']?snapshots/);
});

test("rpcd: add_feed drops its own lines before appending", async () => {
  const src = await readFile(RPCD, "utf8");
  const block = src.slice(src.indexOf("aurora_add_feed()"));
  assert.match(block, /aurora_drop_feed_lines/, "old lines must be removed first");
  assert.match(
    block,
    /https:\/\/\$AURORA_FEED_HOST\//,
    "apk lines are matched by the host prefix",
  );
  assert.match(block, /src\/gz eamonxg /, "opkg lines are matched by the feed name");
});

test("rpcd: add_feed distinguishes a write failure from an index failure", async () => {
  const src = await readFile(RPCD, "utf8");
  assert.match(src, /json_add_boolean "index_refreshed"/);
});

test("rpcd: add_feed installs the keys where each manager looks for them", async () => {
  const src = await readFile(RPCD, "utf8");
  assert.match(src, /\/etc\/opkg\/keys\/\$AURORA_FEED_FPR/);
  assert.match(src, /\/etc\/apk\/keys\/eamonxg\.pem/);
});

test("rpcd: add_feed is registered on the ubus object", async () => {
  const src = await readFile(RPCD, "utf8");
  assert.match(src, /"add_feed"/);
});
