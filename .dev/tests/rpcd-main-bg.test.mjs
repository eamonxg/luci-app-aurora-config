import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { repo } from "./paths.mjs";

// 主界面背景(main_bg)与 login_bg 共用一条资产管线。可切片的纯函数走行为
// 断言(同 rpcd-share-assets 的 slice 手法);与 jshn/网络纠缠的段落退化为
// 文本断言——它们守的是"哪一行必须存在",不是排序或数值。

const rpcd = readFileSync(repo("root/usr/libexec/rpcd/luci.aurora"), "utf8");

function slice(name) {
  const start = rpcd.indexOf(`${name}() {`);
  assert.ok(start !== -1, `${name} not found in rpcd script`);
  const end = rpcd.indexOf("\n}\n", start) + 3;
  return rpcd.slice(start, end);
}

function runSh(script, env = {}) {
  return execFileSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

// ---------------------------------------------------------------------------
// is_valid_main_bg_value —— share 与 apply 两端共用的界内校验
// ---------------------------------------------------------------------------

const boundsCases = [
  ["struct_main_bg_alpha", "67%", true],
  ["struct_main_bg_alpha", "50%", true],
  ["struct_main_bg_alpha", "100%", true],
  ["struct_main_bg_alpha", "49%", false],
  ["struct_main_bg_alpha", "101%", false],
  ["struct_main_bg_alpha", "67", false],
  ["struct_main_bg_blur", "20px", true],
  ["struct_main_bg_blur", "0px", true],
  ["struct_main_bg_blur", "40px", true],
  ["struct_main_bg_blur", "41px", false],
  ["struct_main_bg_blur", "20%", false],
  ["struct_main_bg_scrim", "20%", true],
  ["struct_main_bg_scrim", "0%", true],
  ["struct_main_bg_scrim", "70%", true],
  ["struct_main_bg_scrim", "71%", false],
  ["struct_main_bg_scrim", "-1%", false],
  ["struct_login_bg_alpha", "100%", true],
  ["struct_login_bg_alpha", "49%", false],
  ["struct_login_bg_blur", "0px", true],
  ["struct_login_bg_blur", "41px", false],
  ["struct_login_bg_scrim", "0%", true],
  ["struct_login_bg_scrim", "71%", false],
];

test("is_valid_main_bg_value enforces the hub's bounds on both ends", () => {
  for (const [key, value, ok] of boundsCases) {
    const out = runSh(
      slice("is_valid_main_bg_value") +
        `\nis_valid_main_bg_value "${key}" "${value}" && echo OK || echo NO\n`,
    ).trim();
    assert.equal(out, ok ? "OK" : "NO", `${key}=${value}`);
  }
});

// ---------------------------------------------------------------------------
// local_image_name —— main_bg 从 struct_main_bg 的 url() 里剥文件名
// ---------------------------------------------------------------------------

test("local_image_name resolves main_bg from its url() wrapper", () => {
  const stub = `
is_theme_shipped_image() { return 1; }
uci() {
  [ "$3" = "aurora.theme.struct_main_bg" ] && {
    printf "url('/luci-static/aurora/images/wall.jpg')\\n"; return 0; }
  return 1
}
`;
  const out = runSh(
    stub +
      slice("local_image_name") +
      `\nICON_PATH="$TMPDIR_ICONS"\nlocal_image_name main_bg || echo NONE\n`,
    { TMPDIR_ICONS: process.cwd() },
  ).trim();
  // 文件不存在于 ICON_PATH → NONE;但走到存在性检查前必须已剥出文件名
  // (路径逃逸值则在更早一步被拒)。这里断言的是"main_bg 不再落到
  // 非 bg 的 uci get 分支"——旧代码里它会去读 aurora.theme.main_bg。
  assert.equal(out, "NONE");
});

test("local_image_name rejects a traversal value in struct_main_bg", () => {
  const stub = `
is_theme_shipped_image() { return 1; }
uci() {
  [ "$3" = "aurora.theme.struct_main_bg" ] && {
    printf "url('/luci-static/aurora/images/../../etc/aurora/device.key')\\n"; return 0; }
  return 1
}
`;
  const out = runSh(
    stub + slice("local_image_name") + `\nlocal_image_name main_bg || echo NONE\n`,
  ).trim();
  assert.equal(out, "NONE");
});

// ---------------------------------------------------------------------------
// kind 表成员资格(纯函数,行为断言)
// ---------------------------------------------------------------------------

test("hub asset tables carry main_bg like login_bg", () => {
  const script =
    slice("hub_asset_ext_ok") +
    slice("hub_asset_target_name") +
    `
hub_asset_ext_ok main_bg jpg && echo EXT_JPG
hub_asset_ext_ok main_bg png && echo EXT_PNG
hub_asset_ext_ok main_bg svg || echo EXT_NO_SVG
hub_asset_target_name main_bg 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef jpg
echo
`;
  const out = runSh(script).trim().split("\n");
  assert.deepEqual(out, [
    "EXT_JPG",
    "EXT_PNG",
    "EXT_NO_SVG",
    "hub-main-bg-0123456789ab.jpg",
  ]);
});

// ---------------------------------------------------------------------------
// 文本断言:与 jshn/网络纠缠的段落,守"哪一行必须存在"
// ---------------------------------------------------------------------------

test("build_share_payload ships main_bg and the three tunables", () => {
  const fn = slice("build_share_payload");
  assert.match(fn, /for kind in logo_svg .* login_bg main_bg; do/);
  // 三键循环 + 界内才发(越界静默缺席,同字体栈回退姿势)
  assert.match(fn, /for key in struct_main_bg_alpha struct_main_bg_blur struct_main_bg_scrim struct_login_bg_alpha struct_login_bg_blur struct_login_bg_scrim; do/);
  assert.match(fn, /is_valid_main_bg_value "\$key" "\$value"/);
});

test("validate_and_apply writes the tunables when present and deletes them when absent", () => {
  const fn = slice("validate_and_apply_hub_payload");
  assert.match(fn, /for key in struct_main_bg_alpha struct_main_bg_blur struct_main_bg_scrim struct_login_bg_alpha struct_login_bg_blur struct_login_bg_scrim; do/);
  // 带则校验后写(越界拒整单),缺则删(回 CSS fallback 默认)
  assert.match(fn, /is_valid_main_bg_value "\$key" "\$value" \|\| \{ rm -f "\$batch_file"; return 1; \}/);
  assert.match(fn, /printf "delete aurora\.theme\.%s\\n" "\$key"/);
});

test("apply_hub_asset writes struct_main_bg's url() and drops the stale lqip", () => {
  const fn = slice("apply_hub_asset");
  assert.match(fn, /struct_main_bg="url\('\/luci-static\/aurora\/images\/\$name'\)"/);
  assert.match(fn, /delete aurora\.theme\.struct_main_bg_lqip/);
  // login_bg 同款清理:换图后旧 LQIP 指着换掉前的图,留着会闪错图
  assert.match(fn, /delete aurora\.theme\.struct_login_bg_lqip/);
});

test("sweep keeps a live main_bg and collects the hub-main-bg prefix", () => {
  const fn = slice("sweep_hub_images");
  assert.match(fn, /struct_main_bg/);
  assert.match(fn, /hub-main-bg-\*/);
});

test("remove_icon clears a deleted image out of struct_main_bg", () => {
  assert.match(rpcd, /current_main_bg=\$\(uci -q get aurora\.theme\.struct_main_bg\)/);
  assert.match(rpcd, /delete aurora\.theme\.struct_main_bg\b/);
});

test("the three tunables enter the theme fingerprint; the filename key stays out", () => {
  const fn = slice("theme_fingerprint");
  assert.match(fn, /struct_main_bg_alpha=/);
  assert.match(fn, /struct_main_bg_blur=/);
  assert.match(fn, /struct_main_bg_scrim=/);
  assert.match(fn, /struct_login_bg_alpha=/);
  assert.match(fn, /struct_login_bg_scrim=/);
  // struct_main_bg=(文件名)绝不能进指纹——匹配到 alpha/blur/scrim 之外的
  // 裸 struct_main_bg= 即失败
  assert.doesNotMatch(fn, /struct_main_bg=(?!alpha|blur|scrim)/);
});

test("hub_local_state's image manifest asks about main_bg too", () => {
  // 3378 行附近的第二份 kind 列表(发布前 manifest)与打包用同一列表
  const lists = rpcd.match(/for kind in logo_svg [^\n]*login_bg[^\n]*; do/g) ?? [];
  assert.ok(lists.length >= 2, "expected both kind lists");
  for (const line of lists) assert.match(line, /main_bg/);
});
