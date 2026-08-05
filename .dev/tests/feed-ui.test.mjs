import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

const SRC = srcPath("view/aurora/studio.js");

test("feed ui: no manifest request when the feed is not configured", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(
    src,
    /if \(!feedStatus\.configured\) return Promise\.resolve\(null\)/,
    "an unconfigured router must not reach out to the network at all",
  );
});

test("feed ui: the manifest is fetched by the browser, never through rpcd", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const FEED_HOST = "openwrt\.eamonxg\.fun"/);
  assert.match(src, /const MANIFEST_URL = `https:\/\/\$\{FEED_HOST\}\/manifest\.json`/);
  assert.match(src, /fetch\(MANIFEST_URL/);
  assert.ok(
    !/callFetchManifest|hub_http|fetch_url/.test(src),
    "the router must not proxy the manifest",
  );
});

test("feed ui: the result is cached for the session", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /sessionStorage/);
});

test("feed ui: the dismissal is browser-side, not a uci change", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /localStorage\.setItem\(FEED_NOTICE_KEY/);
  assert.ok(
    !/uci\.set\("aurora", "theme", "feed_/.test(src),
    "writing uci would raise a phantom unsaved change just for closing a hint",
  );
});

test("feed ui: nothing is said when there is no update", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!/Up to date|已是最新/.test(src), "silence is the up-to-date state");
});

test("feed ui: only one new rpcd method exists", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /method: "add_feed"/, "add_feed must be declared");
  assert.ok(
    !/method: "get_feed_status"/.test(src),
    "feed status rides on get_init_data",
  );
});

test("feed ui: a network failure degrades in silence", async () => {
  const src = await readFile(SRC, "utf8");
  const block = src.slice(
    src.indexOf("const checkForUpdates ="),
    src.indexOf("const buildFeedNotice ="),
  );
  assert.match(block, /\.catch\(\(\) => null\)/, "no error toast, no console noise");
});
