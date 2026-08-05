#!/usr/bin/env node
// The ONLY writer of htdocs/luci-static/resources. Sources live in
// .dev/src/resource and are never shipped; this turns them into the bytes the
// router serves. uhttpd has no gzip -- there is no Content-Encoding anywhere in
// its source -- so these bytes are the router's flash-read and socket-write cost
// one for one. Rationale and measurements:
// docs/specs/2026-08-05-asset-pipeline-and-color-shim.md
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { minify } from "terser";

const here = dirname(fileURLToPath(import.meta.url));
const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback;
};
const SRC = flag("--src", resolve(here, "../src/resource"));
const OUT = flag("--out", resolve(here, "../../htdocs/luci-static/resources"));
const check = process.argv.includes("--check");

// From luci-theme-aurora .dev/vite.config.ts. Every flag here is load-bearing:
//
//   bare_returns      a LuCI view's last statement is a top-level `return`
//   directives:false  its dependency declarations are string directives, which
//                     a directive-dropping compressor deletes
//
// And two options must stay at their DEFAULTS, which is why they are absent:
// mangle.toplevel and compress.toplevel. color.global.js and tokens.global.js
// publish themselves through a top-level `var Color` / `var AuroraTokens`;
// turning either on deletes the whole declaration -- measured, the output
// becomes an empty string -- and both pages white-screen with nothing logged.
//
// comments:false strips everything, so third-party licences are re-attached
// from .license sidecars below rather than preserved in place.
const TERSER = {
  parse: { bare_returns: true },
  compress: { directives: false, passes: 2 },
  mangle: true,
  format: { comments: false, beautify: false },
};

async function walk(dir, base = dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    // Hidden files are never sources and must never be shipped: .DS_Store rode
    // along the first time this ran and would have been installed onto every
    // router that upgraded.
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full, base)));
    else found.push(relative(base, full).split("\\").join("/"));
  }
  return found.sort();
}

// MIT and friends require the copyright and permission notice to travel with
// every copy. Vendored libraries carry theirs as plain // comments, which
// comments:false strips, so each such file gets a <name>.license sidecar whose
// contents are re-attached verbatim as a banner. The sidecar is not itself an
// artifact -- it only ever appears inside the file it belongs to.
async function banner(rel) {
  try {
    const text = await readFile(join(SRC, `${rel}.license`), "utf8");
    return `/*!\n${text.trimEnd()}\n*/\n`;
  } catch {
    return "";
  }
}

// `__ASSET_HASH(<path>)__` becomes the first 8 hex of that source file's
// sha256, so a resource we fetch by a URL we build ourselves can carry a
// version that changes if and only if its contents do.
//
// It has to happen here rather than being stamped into the source, because
// only this script reads every source file. The artifact stays a pure function
// of the sources, so --check is unaffected.
//
// Why it matters: uhttpd dates our installed files Last-Modified: epoch and
// sends no Cache-Control, so the heuristic freshness a browser computes runs to
// years -- it will not even revalidate. Resources LuCI `require`s get LuCI's
// own ?v=; the ones we fetch get this.
const ASSET_HASH = /__ASSET_HASH\(([^)]+)\)__/g;

async function resolveAssetHashes(code, rel) {
  const matches = [...code.matchAll(ASSET_HASH)];
  let out = code;
  for (const [token, target] of matches) {
    let contents;
    try {
      contents = await readFile(join(SRC, target), "utf8");
    } catch {
      throw new Error(`__ASSET_HASH names ${target}, which is not a source`);
    }
    const hash = createHash("sha256").update(contents).digest("hex").slice(0, 8);
    out = out.split(token).join(hash);
  }
  return out;
}

async function build(rel) {
  const source = await resolveAssetHashes(
    await readFile(join(SRC, rel), "utf8"),
    rel,
  );
  if (rel.endsWith(".js")) {
    // No sourceMap option at all: terser would otherwise be free to append a
    // sourceMappingURL comment, and the map is not installed on the device.
    const result = await minify(source, TERSER);
    if (typeof result.code !== "string" || result.code.length === 0)
      throw new Error(`${rel}: terser produced no output`);
    return (await banner(rel)) + result.code;
  }
  if (rel.endsWith(".json")) return JSON.stringify(JSON.parse(source));
  return source;
}

const sources = (await walk(SRC)).filter((rel) => !rel.endsWith(".license"));
if (sources.length === 0) {
  console.error(`build-js: no sources under ${SRC}`);
  process.exit(1);
}

const built = new Map();
for (const rel of sources) {
  try {
    built.set(rel, await build(rel));
  } catch (error) {
    console.error(`build-js: ${rel}: ${error.message}`);
    process.exit(1);
  }
}

if (check) {
  const stale = [];
  for (const [rel, content] of built) {
    let current = null;
    try {
      current = await readFile(join(OUT, rel), "utf8");
    } catch {}
    if (current !== content) stale.push(rel);
  }
  for (const rel of await walk(OUT))
    if (!built.has(rel)) stale.push(`${rel} (orphan: no source)`);
  if (stale.length) {
    console.error("build-js: artifacts are stale -- run `pnpm build` and commit:");
    for (const rel of stale) console.error(`  ${rel}`);
    process.exit(1);
  }
  console.log(`build-js: ${built.size} artifacts up to date`);
} else {
  // Wipe first so a deleted source cannot leave a shipped artifact behind.
  await rm(OUT, { recursive: true, force: true });
  let before = 0;
  let after = 0;
  for (const [rel, content] of built) {
    const target = join(OUT, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    before += (await readFile(join(SRC, rel), "utf8")).length;
    after += content.length;
  }
  console.log(
    `build-js: ${built.size} files, ${before} -> ${after} chars ` +
      `(${Math.round((after / before) * 100)}%)`,
  );
}
