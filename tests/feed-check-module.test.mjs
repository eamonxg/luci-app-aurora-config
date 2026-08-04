import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SRC = "htdocs/luci-static/resources/utils/feed-check.js";

// These are pure functions, so the test actually runs them rather than
// pattern-matching the source: strip LuCI's "require" directives and hand the
// remaining function body a stub baseclass.
async function load() {
  const src = await readFile(SRC, "utf8");
  const body = src
    .replace(/^"use strict";$/m, "")
    .replace(/^"require [^"]+";$/gm, "");
  return new Function("baseclass", body)({ extend: (obj) => obj });
}

test("parseRevision pulls the rYYYYMMDD stamp", async () => {
  const m = await load();
  assert.equal(m.parseRevision("1.1.3-r20260803"), 20260803);
  assert.equal(m.parseRevision("1.1.13-r20260802"), 20260802);
});

test("parseRevision returns null for anything else", async () => {
  const m = await load();
  assert.equal(m.parseRevision("26.192.49224.6b21ba7"), null);
  assert.equal(m.parseRevision("1.1.3"), null);
  assert.equal(m.parseRevision(""), null);
  assert.equal(m.parseRevision(undefined), null);
  assert.equal(m.parseRevision(null), null);
});

test("isNewer never orders versions it cannot parse", async () => {
  const m = await load();
  assert.equal(m.isNewer("1.1.3-r20260803", "1.1.4-r20260901"), true);
  assert.equal(m.isNewer("1.1.3-r20260803", "1.1.3-r20260803"), false);
  // Measured on a live router: the installed config was newer than the feed's
  // snapshot build. Claiming an update there would be a lie.
  assert.equal(m.isNewer("1.1.3-r20260803", "1.1.2-r20260727"), false);
  // install.sh: opkg and apk version schemes are not comparable -- never order.
  assert.equal(m.isNewer("1.1.3", "1.1.4"), false);
  assert.equal(m.isNewer("1.1.3-r20260803", "1.1.4"), false);
});

test("findManifestVersion reads the live manifest shape", async () => {
  const m = await load();
  // Shape confirmed against https://openwrt.eamonxg.fun/manifest.json
  const manifest = {
    generated: "...",
    channels: {
      snapshots: {
        apk: [
          { pkg: "luci-theme-aurora", version: "1.1.13-r20260802" },
          { pkg: "luci-app-aurora-config", version: "1.1.2-r20260727" },
        ],
        opkg: [{ pkg: "luci-theme-aurora", version: "1.1.13-r20260802" }],
      },
    },
  };
  assert.equal(
    m.findManifestVersion(manifest, "snapshots", "apk", "luci-app-aurora-config"),
    "1.1.2-r20260727",
  );
  assert.equal(m.findManifestVersion(manifest, "releases", "apk", "x"), null);
  assert.equal(m.findManifestVersion(manifest, "snapshots", "apk", "nope"), null);
  assert.equal(m.findManifestVersion(null, "snapshots", "apk", "x"), null);
});

test("pickPackageManagerPath reads the live menu instead of guessing", async () => {
  const m = await load();
  const tree = (children) => ({
    children: { admin: { children: { system: { children } } } },
  });
  assert.equal(
    m.pickPackageManagerPath(tree({ "package-manager": {} })),
    "admin/system/package-manager",
  );
  assert.equal(m.pickPackageManagerPath(tree({ opkg: {} })), "admin/system/opkg");
});

test("pickPackageManagerPath skips nodes the user may not open", async () => {
  const m = await load();
  const tree = (children) => ({
    children: { admin: { children: { system: { children } } } },
  });
  // ui.menu keeps unauthorised nodes but flags them; linking there would 403.
  assert.equal(
    m.pickPackageManagerPath(tree({ "package-manager": { satisfied: false } })),
    null,
  );
  assert.equal(
    m.pickPackageManagerPath(
      tree({ "package-manager": { satisfied: false }, opkg: {} }),
    ),
    "admin/system/opkg",
  );
});

test("pickPackageManagerPath yields null when there is no software page", async () => {
  const m = await load();
  assert.equal(m.pickPackageManagerPath({ children: {} }), null);
  assert.equal(m.pickPackageManagerPath(null), null);
  assert.equal(
    m.pickPackageManagerPath({
      children: { admin: { children: { system: { children: { reboot: {} } } } } },
    }),
    null,
  );
});
