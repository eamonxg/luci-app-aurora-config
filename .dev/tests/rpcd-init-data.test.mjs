import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

const RPCD = repo("root/usr/libexec/rpcd/luci.aurora");

// jshn 只存在于 OpenWrt 上，所以这里不 source 整个脚本，而是把待测函数切出来配桩跑。
// 桩把每次调用打成一行，断言比对的是「发出了什么」，不是「源码长什么样」—— 这样才能
// 抓住管道子 shell 那类陷阱：源码看着对，jshn 的写入却全丢在退出的子进程里。
const STUBS = `
json_add_array()   { echo "ARRAY $1"; }
json_add_string()  { echo "NAME $2"; }
json_close_array() { echo "/ARRAY"; }
json_add_object()  { echo "OBJ $1"; }
json_add_int()     { echo "SIZE $1=$2"; }
json_close_object(){ echo "/OBJ"; }
`;

async function runJsonAddIcons(iconPath) {
  const src = await readFile(RPCD, "utf8");
  const start = src.indexOf("json_add_icons() {");
  assert.ok(start !== -1, "json_add_icons not found");
  const end = src.indexOf("\n}\n", start) + 3;
  const script = `ICON_PATH="${iconPath}"\n${STUBS}\n${src.slice(start, end)}\njson_add_icons\n`;
  return execFileSync("sh", ["-c", script], { encoding: "utf8" });
}

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-icons-"));
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(join(dir, name), "x".repeat(bytes));
  return dir;
}

test("json_add_icons emits every file's name and byte size", async () => {
  // 文件名里可以有空格：receive_upload 只拒绝空串、含 / 和含 .. 的名字。
  const dir = fixture({ "favicon.ico": 3, "app icon.png": 7, "empty.svg": 0 });
  try {
    const out = await runJsonAddIcons(dir);
    const names = [...out.matchAll(/^NAME (.+)$/gm)].map((m) => m[1]).sort();
    assert.deepEqual(names, ["app icon.png", "empty.svg", "favicon.ico"]);
    const sizes = Object.fromEntries(
      [...out.matchAll(/^SIZE (.+)=\s*(\d+)$/gm)].map((m) => [m[1], Number(m[2])]),
    );
    assert.deepEqual(sizes, { "favicon.ico": 3, "app icon.png": 7, "empty.svg": 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("json_add_icons survives an empty directory, a missing one, and a lone file", async () => {
  const empty = mkdtempSync(join(tmpdir(), "aurora-icons-"));
  const one = fixture({ "a.png": 2 });
  const sub = fixture({ "b.png": 4 });
  mkdirSync(join(sub, "nested"));
  try {
    for (const dir of [empty, join(empty, "does-not-exist")]) {
      const out = await runJsonAddIcons(dir);
      assert.ok(!out.includes("NAME "), `${dir} should list nothing`);
      assert.ok(!out.includes("SIZE "), `${dir} should size nothing`);
    }
    // 单文件时 wc 不打印 total 行 —— 解析必须两种情况都对。
    assert.match(await runJsonAddIcons(one), /^SIZE a\.png=\s*2$/m);
    // 子目录既不进 icons 数组，也不进 icon_sizes。
    const out = await runJsonAddIcons(sub);
    assert.ok(!out.includes("nested"), "directories must not be listed as icons");
  } finally {
    for (const d of [empty, one, sub]) rmSync(d, { recursive: true, force: true });
  }
});

test("json_add_icons calls wc once for the whole directory, not once per file", async () => {
  const src = await readFile(RPCD, "utf8");
  const start = src.indexOf("json_add_icons() {");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(
    !/wc -c < /.test(body),
    "per-file `wc -c < file` is one fork per icon on a device where forks are the cost",
  );
  assert.ok(
    !/\|\s*while /.test(body),
    "piping into while runs the loop in a subshell and every json_add_* write is lost",
  );
});

test("the package manager is detected once per rpcd invocation", async () => {
  const src = await readFile(RPCD, "utf8");
  assert.ok(
    !/\$\(detect_package_manager\)/.test(src),
    "command substitution is a fork; callers must read $_pkg_manager instead",
  );
  assert.match(src, /_pkg_manager=""/, "the memo variable must exist at script scope");
  assert.match(
    src,
    /detect_package_manager\(\) \{\s*\n\s*\[ -n "\$_pkg_manager" \] && return/,
    "detect_package_manager must short-circuit on the memo",
  );
});
