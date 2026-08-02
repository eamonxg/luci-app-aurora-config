// Vendor the color-token artifacts from the @eamonxg/luci-theme-tokens npm
// package (renamed from @eamonxg/aurora-tokens; published from the
// luci-theme-tokens repo). Everything here is a plain copy -- all derivation
// happens upstream at package build time:
//   - htdocs/luci-static/resources/utils/tokens.global.js
//   - root/usr/share/aurora/color-tokens.conf
//   - scripts/aurora-presets.json          (resolved preset hex values)
// then stamps TOKENS_ENGINE_VERSION into view/aurora/theme.js and reruns
// scripts/gen-presets.mjs. All vendored artifacts are committed; nothing
// downstream (CI, SDK build, device) needs npm or the package repo.
//
// Source resolution:
//   1. --local <path>   a local luci-theme-tokens checkout (run `npm install`
//                       + `node build.mjs` there first)
//   2. npm registry     the version pinned in package.json devDependencies
//   3. sibling checkout ../luci-theme-tokens, when the registry is unreachable
//
// Usage:  node scripts/sync-tokens.mjs [--local <path>]
//         node scripts/sync-tokens.mjs --check   exit 1 if outputs are stale
//
// Zero dependencies, same as gen-presets.mjs.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PACKAGE = "@eamonxg/luci-theme-tokens";
const check = process.argv.includes("--check");

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : null;
};

const pinnedVersion = () =>
  JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
    .devDependencies[PACKAGE];

const buildCheckout = (checkout) => {
  const built = spawnSync(process.execPath, [resolve(checkout, "build.mjs")], {
    stdio: "inherit",
  });
  if (built.status !== 0)
    throw new Error(`building ${checkout} failed -- run \`npm install\` there first`);
  return checkout;
};

const fetchFromRegistry = async (version) => {
  const tarballUrl = `https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE.split("/")[1]}-${version}.tgz`;
  const response = await fetch(tarballUrl);
  if (!response.ok) throw new Error(`fetch ${tarballUrl}: HTTP ${response.status}`);
  const dir = mkdtempSync(join(tmpdir(), "luci-theme-tokens-"));
  writeFileSync(join(dir, "package.tgz"), Buffer.from(await response.arrayBuffer()));
  const extracted = spawnSync("tar", ["-xzf", join(dir, "package.tgz"), "-C", dir], {
    stdio: "inherit",
  });
  if (extracted.status !== 0) throw new Error("tar extraction failed");
  return join(dir, "package");
};

async function loadPackage() {
  const explicit = argValue("--local");
  if (explicit) {
    console.log(`sync-tokens: source = local checkout ${explicit}`);
    return buildCheckout(explicit);
  }
  const version = pinnedVersion();
  try {
    const dir = await fetchFromRegistry(version);
    console.log(`sync-tokens: source = npm ${PACKAGE}@${version}`);
    return dir;
  } catch (error) {
    const sibling = resolve(root, "../luci-theme-tokens");
    if (existsSync(join(sibling, "build.mjs"))) {
      console.warn(
        `sync-tokens: WARNING registry unavailable (${error.message}); ` +
          `falling back to sibling checkout -- output may not match the pinned ${version}`,
      );
      return buildCheckout(sibling);
    }
    throw error;
  }
}

const pkgDir = await loadPackage();
const dist = (f) => readFileSync(join(pkgDir, "dist/aurora", f), "utf8");
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;

// Stamp the engine version into theme.js: it appends ?v= when loading
// tokens.global.js so a browser can never pair new theme.js with a cached engine.
const THEME_VIEW = resolve(root, "htdocs/luci-static/resources/view/aurora/theme.js");
const versionLine = `const TOKENS_ENGINE_VERSION = "${version}";`;
const themeSource = readFileSync(THEME_VIEW, "utf8").replace(
  /const TOKENS_ENGINE_VERSION = "[^"]*";/,
  versionLine,
);
if (!themeSource.includes(versionLine))
  throw new Error("TOKENS_ENGINE_VERSION marker not found in theme.js");

const outputs = [
  [resolve(root, "htdocs/luci-static/resources/utils/tokens.global.js"), dist("tokens.global.js")],
  [resolve(root, "root/usr/share/aurora/color-tokens.conf"), dist("color-tokens.conf")],
  [resolve(root, "scripts/aurora-presets.json"), dist("presets.json")],
  [THEME_VIEW, themeSource],
];

let stale = false;
for (const [path, content] of outputs) {
  const name = relative(root, path);
  let current = null;
  try {
    current = readFileSync(path, "utf8");
  } catch {}
  if (current === content) {
    console.log(`sync-tokens: ${name} up to date`);
    continue;
  }
  if (check) {
    console.error(`sync-tokens: ${name} is STALE -- run: node scripts/sync-tokens.mjs`);
    stale = true;
    continue;
  }
  writeFileSync(path, content, "utf8");
  console.log(`sync-tokens: wrote ${name}`);
}

if (check) process.exit(stale ? 1 : 0);

// Preset templates embed resolved preset values; refresh them from the JSON.
const presets = spawnSync(process.execPath, [resolve(here, "gen-presets.mjs")], {
  stdio: "inherit",
});
process.exit(presets.status ?? 1);
