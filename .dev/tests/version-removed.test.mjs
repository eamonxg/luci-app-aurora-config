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
const menu = readFileSync(
  path.join(repoRoot, "root/usr/share/luci/menu.d/luci-app-aurora.json"),
  "utf8",
);
const themeJs = readFileSync(
  path.join(repoRoot, ".dev/src/resource/view/aurora/studio.js"),
  "utf8",
);

test("rpcd script: version-management call handlers removed", () => {
  assert.ok(!rpcd.includes('"check_updates")'), 'should not contain "check_updates")');
  assert.ok(
    !rpcd.includes('"download_package")'),
    'should not contain "download_package")',
  );
  assert.ok(
    !rpcd.includes('"install_package")'),
    'should not contain "install_package")',
  );
  assert.ok(
    !rpcd.includes('"get_installed_versions")'),
    'should not contain "get_installed_versions")',
  );
});

test("rpcd script: version-management list entries removed", () => {
  assert.ok(!rpcd.includes('json_add_object "check_updates"'));
  assert.ok(!rpcd.includes('json_add_object "download_package"'));
  assert.ok(!rpcd.includes('json_add_object "install_package"'));
  assert.ok(!rpcd.includes('json_add_object "get_installed_versions"'));
});

test("rpcd script: dead version-compare helpers removed", () => {
  assert.ok(!rpcd.includes("version_compare("), "version_compare( should be gone");
  assert.ok(
    !rpcd.includes("extract_detailed_version("),
    "extract_detailed_version( should be gone",
  );
});

test("rpcd script: shared helpers used by get_init_data are kept", () => {
  assert.match(rpcd, /json_add_installed_versions\s*\(\)/);
  assert.match(rpcd, /parse_installed_packages\s*\(\)/);
  assert.match(rpcd, /detect_package_manager\s*\(\)/);
  // get_init_data must still call the shared helper
  assert.ok(rpcd.includes("json_add_installed_versions"));
  assert.ok(rpcd.includes('"get_init_data")'));
  assert.ok(rpcd.includes('"get_system_info")'));
});

test("acl: version-management ubus methods and tmp paths removed", () => {
  assert.ok(!acl.includes("get_installed_versions"));
  assert.ok(!acl.includes("check_updates"));
  assert.ok(!acl.includes("download_package"));
  assert.ok(!acl.includes("install_package"));
  assert.ok(!acl.includes("aurora_downloads"));
});

test("acl: get_init_data and get_system_info are kept", () => {
  assert.ok(acl.includes("get_init_data"));
  assert.ok(acl.includes("get_system_info"));
});

test("menu: version management entry removed", () => {
  assert.ok(!menu.includes("aurora/version"));
});

test("theme.js: no reference to the version-api module or update-check UI", () => {
  assert.ok(!themeJs.includes("utils.version-api"));
  assert.ok(!themeJs.includes("callCheckUpdates"));
  assert.ok(!themeJs.includes("versionCache"));
  assert.ok(!themeJs.includes("updateVersionLabel"));
  assert.ok(!themeJs.includes("utils_version_api"));
  assert.ok(!themeJs.includes("aurora/version"));
});

test("theme.js: installed-version header labels still work", () => {
  assert.ok(themeJs.includes("installed_version"));
  assert.ok(themeJs.includes('id: "theme-version"'));
  assert.ok(themeJs.includes('id: "config-version"'));
});
