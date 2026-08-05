import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const BUILD = fileURLToPath(new URL("../scripts/build-js.mjs", import.meta.url));

const VIEW = `"use strict";
"require view";
"require form";

const LABEL = _("A Translatable Label");

return view.extend({
  render() {
    const unusedButNamed = 1;
    return LABEL + unusedButNamed;
  },
});
`;

function scratch(files) {
  const root = mkdtempSync(join(tmpdir(), "aurora-build-"));
  const src = join(root, "src");
  for (const [rel, content] of Object.entries(files)) {
    const full = join(src, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return { root, src, out: join(root, "out") };
}

const run = (args) =>
  execFileSync(process.execPath, [BUILD, ...args], { encoding: "utf8" });

test("a LuCI view keeps its directive prologue, its top-level return and its _() calls", () => {
  const { root, src, out } = scratch({ "view/aurora/studio.js": VIEW });
  try {
    run(["--src", src, "--out", out]);
    const built = readFileSync(join(out, "view/aurora/studio.js"), "utf8");
    assert.ok(
      built.startsWith('"use strict";"require view";"require form";'),
      `directive prologue was dropped: ${built.slice(0, 80)}`,
    );
    assert.match(built, /return view\.extend/, "top-level return was dropped");
    assert.match(built, /_\("A Translatable Label"\)/, "_() msgid was rewritten");
    assert.ok(built.length < VIEW.length, "output is not smaller than the source");
    assert.ok(
      !built.includes("sourceMappingURL"),
      "a sourceMappingURL comment costs every visitor a 404",
    );
    assert.ok(!built.includes("unusedButNamed"), "locals were not mangled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("json is compacted and stays parseable", () => {
  const pretty =
    JSON.stringify({ presets: { a: { light: { bg: "#fff" } } } }, null, 2) + "\n";
  const { root, src, out } = scratch({ "aurora/presets.json": pretty });
  try {
    run(["--src", src, "--out", out]);
    const built = readFileSync(join(out, "aurora/presets.json"), "utf8");
    assert.ok(built.length < pretty.length, "json was not compacted");
    assert.deepEqual(JSON.parse(built), JSON.parse(pretty), "json content changed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--check exits non-zero and names the stale file", () => {
  const { root, src, out } = scratch({ "view/aurora/studio.js": VIEW });
  try {
    run(["--src", src, "--out", out]);
    run(["--check", "--src", src, "--out", out]); // fresh: must not throw
    writeFileSync(join(out, "view/aurora/studio.js"), "stale");
    assert.throws(
      () => run(["--check", "--src", src, "--out", out]),
      (error) => {
        assert.equal(error.status, 1, "--check must exit 1 when stale");
        assert.match(
          String(error.stdout) + String(error.stderr),
          /view\/aurora\/studio\.js/,
        );
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build removes artifacts whose source is gone", () => {
  const { root, src, out } = scratch({ "view/aurora/studio.js": VIEW });
  try {
    run(["--src", src, "--out", out]);
    mkdirSync(join(out, "utils"), { recursive: true });
    writeFileSync(join(out, "utils/orphan.js"), "// no source produces this");
    run(["--src", src, "--out", out]);
    assert.throws(
      () => readFileSync(join(out, "utils/orphan.js")),
      "a stale artifact would keep shipping after its source was deleted",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a top-level global survives, and its .license sidecar rides along", () => {
  const lib = `var Color = (function () {
  // The MIT License (MIT)
  // Copyright (c) 2024 Somebody
  var helperName = 1;
  return helperName;
})();
`;
  const { root, src, out } = scratch({
    "utils/color.global.js": lib,
    "utils/color.global.js.license":
      "colorjs.io -- MIT\nCopyright (c) 2024 Somebody",
  });
  try {
    run(["--src", src, "--out", out]);
    const built = readFileSync(join(out, "utils/color.global.js"), "utf8");
    // The whole point of this file is the global it publishes. mangle.toplevel
    // or compress.toplevel would delete the declaration outright, and terser
    // would report success.
    assert.match(built, /var Color=/, "the top-level global was mangled or dropped");
    assert.ok(!built.includes("helperName"), "inner locals should still mangle");
    assert.ok(
      built.startsWith("/*!"),
      "a vendored file must ship its licence: MIT requires the notice in every copy",
    );
    assert.match(built, /Copyright \(c\) 2024 Somebody/);
    assert.throws(
      () => readFileSync(join(out, "utils/color.global.js.license")),
      "the sidecar is a source, not an artifact",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a syntax error in a source file fails the build loudly", () => {
  const { root, src, out } = scratch({ "utils/broken.js": "const = ;" });
  try {
    assert.throws(
      () => run(["--src", src, "--out", out]),
      (error) => {
        assert.notEqual(error.status, 0, "a broken source must not build");
        assert.match(String(error.stderr), /broken\.js/);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
