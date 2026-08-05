import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

// These assertions run against the bytes the router actually serves, not
// against the source they were made from. That is the whole point: the source
// is checked by every other test in here, and the interesting failures live in
// the gap between the two.
const OUT = repo("htdocs/luci-static/resources");

async function collect(dir, base = dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await collect(full, base)));
    else if (entry.name.endsWith(".js")) found.push(full.slice(base.length + 1));
  }
  return found;
}

const shipped = await collect(OUT);

test("every shipped view is parseable JavaScript", async () => {
  assert.ok(shipped.length > 0, "found no artifacts -- run `pnpm build`");
  for (const rel of shipped) {
    const code = await readFile(join(OUT, rel), "utf8");
    // A LuCI view is evaluated as a function body, so a top-level return is
    // legal there and only there -- new Function reproduces that context.
    assert.doesNotThrow(() => new Function(code), `${rel} does not parse`);
  }
});

test("every shipped file keeps the require directives its source declared", async () => {
  for (const rel of shipped) {
    const source = await readFile(srcPath(rel), "utf8");
    const built = await readFile(join(OUT, rel), "utf8");
    const declared = [...source.matchAll(/^"(require [^"]+)";$/gm)].map((m) => m[1]);
    for (const directive of declared)
      assert.ok(
        built.includes(`"${directive}"`),
        `${rel} lost its "${directive}" declaration -- LuCI will not load its dependency`,
      );
  }
});

test("every shipped view keeps the top-level return LuCI reads it for", async () => {
  for (const rel of shipped) {
    const source = await readFile(srcPath(rel), "utf8");
    const match = /^return (view|baseclass|L\.Class)\.extend\(/m.exec(source);
    if (!match) continue;
    const built = await readFile(join(OUT, rel), "utf8");
    assert.ok(
      built.includes(`return ${match[1]}.extend(`),
      `${rel} lost its module export -- LuCI would load an undefined view`,
    );
  }
});

test("the *.global.js artifacts still publish their globals", async () => {
  // These two exist only to define a global for the page. mangle.toplevel or
  // compress.toplevel would delete the declaration and terser would still
  // report success -- the failure is a white page with nothing in the console.
  for (const [rel, name] of [
    ["utils/color.global.js", "Color"],
    ["utils/tokens.global.js", "AuroraTokens"],
  ]) {
    const built = await readFile(join(OUT, rel), "utf8");
    assert.match(
      built,
      new RegExp(`var ${name}\\s*=`),
      `${rel} no longer declares the global ${name} -- is toplevel mangling on?`,
    );
  }
});

test("vendored code ships the licence it is distributed under", async () => {
  // MIT requires the notice to travel with every copy, and comments:false
  // strips the plain // blocks the vendored file carries. Sidecars re-attach it.
  let checked = 0;
  for (const rel of shipped) {
    let sidecar = null;
    try {
      sidecar = await readFile(`${srcPath(rel)}.license`, "utf8");
    } catch {
      continue;
    }
    checked += 1;
    const built = await readFile(join(OUT, rel), "utf8");
    assert.ok(built.startsWith("/*!"), `${rel} lost its licence banner`);
    for (const line of sidecar.trimEnd().split("\n"))
      assert.ok(built.includes(line), `${rel} banner is missing: ${line}`);
  }
  assert.ok(
    checked > 0,
    "no .license sidecar was found -- colorjs ships under MIT and must carry its notice",
  );
});

test("no shipped file points at a sourcemap that is not installed", async () => {
  for (const rel of shipped) {
    const built = await readFile(join(OUT, rel), "utf8");
    assert.ok(
      !built.includes("sourceMappingURL"),
      `${rel} would cost every visitor a 404 for a map the package does not ship`,
    );
  }
});

test("translatable strings survive minification byte-for-byte", async () => {
  // gen-pot reads the source; the runtime looks the string up in the artifact.
  // If the two ever disagree the translation silently falls back to English.
  const msgid = /\b_\(\s*"((?:[^"\\]|\\.)*)"/g;
  // Comment-only lines are dropped first: asset-upload.js documents its own
  // options with `// badgeHeader, // _("Slot") or _("Type")`, and a string the
  // compressor removes along with its comment was never looked up at runtime.
  // (gen-pot does record such lines as references -- harmless, since the msgid
  // is also used for real elsewhere -- but that is its business, not this
  // test's.)
  const code = (text) =>
    text
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
  for (const rel of shipped) {
    const source = code(await readFile(srcPath(rel), "utf8"));
    const built = await readFile(join(OUT, rel), "utf8");
    const fromSource = new Set([...source.matchAll(msgid)].map((m) => m[1]));
    const fromBuilt = new Set([...built.matchAll(msgid)].map((m) => m[1]));
    for (const id of fromSource)
      assert.ok(
        fromBuilt.has(id),
        `${rel}: msgid ${JSON.stringify(id)} was rewritten -- gen-pot reads the ` +
          `source, so the runtime would look up a key no .po file contains`,
      );
  }
});

test("no hidden file was shipped", async () => {
  // .DS_Store rode along the first time the build ran and would have been
  // installed onto every router that upgraded.
  const all = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else all.push(entry.name);
    }
  };
  await walk(OUT);
  const hidden = all.filter((name) => name.startsWith("."));
  assert.deepEqual(hidden, [], `hidden files must not be installed: ${hidden}`);
});

// Every resource this package fetches by a URL it builds itself must carry a
// version, or browsers keep the copy they have: uhttpd dates our installed
// files at the epoch and sends no Cache-Control, so the heuristic freshness a
// browser computes runs to years and it never revalidates. This is how the
// Marketplace spent months rendering built-in cards from a presets.json whose
// shape had changed underneath it.
//
// Resources LuCI itself `require`s are out of scope -- LuCI appends its own
// ?v=, taken from luci-base's version, which we cannot influence.
test("self-fetched resources carry a cache-busting version", async () => {
  const sentinel = /__ASSET_HASH\(/;
  for (const rel of shipped) {
    const built = await readFile(join(OUT, rel), "utf8");
    assert.ok(
      !sentinel.test(built),
      `${rel} still contains an unresolved __ASSET_HASH sentinel`,
    );
  }

  const theme = await readFile(join(OUT, "view/aurora/studio.js"), "utf8");
  // The version is the loader's second argument; the "?v=" concatenation lives
  // inside loadGlobalScript, so assert on both halves.
  assert.match(
    theme,
    /L\.resource\([^)]*\)\+\([^)]*\?"\?v="\+/,
    "loadGlobalScript no longer appends the version it is given",
  );
  for (const asset of ["color.global.js", "tokens.global.js"])
    assert.match(
      theme,
      new RegExp(`"utils/${asset.replace(/\./g, "\\.")}",\\s*"[^"]+"`),
      `theme.js loads ${asset} without a version argument -- a browser that ` +
        `already has it will never ask for it again`,
    );

  const gallery = await readFile(join(OUT, "view/aurora/marketplace.js"), "utf8");
  assert.match(
    gallery,
    /aurora\/presets\.json"\)\s*\+\s*"\?v=[^"]+"/,
    "marketplace.js fetches presets.json with no ?v=",
  );
});
